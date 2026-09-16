import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { vgvAppsForDate } from '../lib/qlik-vgv.ts';

const source = readFileSync(new URL('../lib/qlik-cloud.ts', import.meta.url), 'utf8');
const collector = ts.transpileModule(source.slice(source.indexOf('async function readQlikEngineMetrics('), source.indexOf('async function launchBrowser(')), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

async function collect({ missingTotal = false, rejectPeriod = false } = {}) {
  const fields = ['Grupo Empresa', 'Agrupador Geral Fluxo Financeiro', 'Período'];
  const variables = new Map<number, { qNum?: number; qText?: string }>();
  const names = new Map<string, number>();
  const lists = new Map<number, string>();
  let nextHandle = 10;
  let dateReads = 0;
  class Engine {
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    constructor() { queueMicrotask(() => this.onopen?.()); }
    close() {}
    send(json: string) {
      const { id, handle, method, params } = JSON.parse(json);
      let result;
      if (method === 'OpenDoc') result = { qReturn: { qHandle: 1 } };
      else if (method === 'GetObject') result = { qReturn: { qHandle: 2 } };
      else if (method === 'GetVariableByName') {
        if (!names.has(params.qName)) names.set(params.qName, nextHandle++);
        result = { qReturn: { qHandle: names.get(params.qName) } };
      } else if (method === 'SetDualValue') {
        assert.match(params.qText, /^\d{2}\/\d{2}\/\d{4}$/);
        variables.set(handle, { qNum: rejectPeriod ? 0 : params.qNum, qText: params.qText }); result = {};
      } else if (method === 'SetStringValue') {
        variables.set(handle, { qText: params.qVal }); result = {};
      } else if (method === 'CreateSessionObject') {
        if (params.qProp.qFieldListDef) result = { qReturn: { qHandle: 3 } };
        else if (params.qProp.qListObjectDef) {
          const h = nextHandle++; lists.set(h, params.qProp.qListObjectDef.qDef.qFieldDefs[0]); result = { qReturn: { qHandle: h } };
        } else {
          assert.equal(params.qProp.qHyperCubeDef.qDimensions[0].qDef.qFieldDefs[0], 'Período');
          assert.equal(params.qProp.qHyperCubeDef.qMeasures[0].qLibraryId, 'blue-entry-measure');
          result = { qReturn: { qHandle: 4 } };
        }
      } else if (method === 'GetField') result = { qReturn: { qHandle: 5 } };
      else if (method === 'ClearAll') result = {};
      else if (method === 'SelectValues') result = { qReturn: true };
      else if (method === 'GetEffectiveProperties') result = { qProp: { qHyperCubeDef: { qMeasures: [{ qLibraryId: 'blue-entry-measure' }] } } };
      else if (method === 'GetLayout') {
        if (variables.has(handle)) result = { qLayout: variables.get(handle) };
        else if (handle === 3) result = { qLayout: { qFieldList: { qItems: fields.map(qName => ({ qName })) } } };
        else if (lists.has(handle)) {
          const qText = lists.get(handle) === 'Grupo Empresa' ? 'Terra Lótus' : '06 - Dividendos';
          result = { qLayout: { qListObject: { qSize: { qcy: 1 }, qDataPages: [{ qMatrix: [[{ qText }]] }] } } };
        } else result = { qLayout: { qHyperCube: { qDimensionInfo: [{}], qMeasureInfo: [{}], qSize: { qcx: handle === 4 ? 2 : 17, qcy: 3 }, qGrandTotalRow: missingTotal ? [] : [{ qNum: 1000, qText: '1.000,00' }] } } };
      } else if (method === 'GetHyperCubeData') {
        assert.equal(handle, 4, 'O total deve vir do rodapé da coluna, nunca da primeira parcela.');
        dateReads++;
        result = { qDataPages: [{ qMatrix: [
          [{ qText: '01/09/2026' }, { qNum: 100 }],
          [{ qText: '01/12/2026' }, { qNum: 400 }],
          [{ qText: '01/01/2028' }, { qNum: 500 }],
        ] }] };
      } else throw new Error(`Unexpected call ${method}`);
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id, result }) }));
    }
  }
  const run = runInNewContext(`${collector}\nreadQlikEngineMetrics`, { WebSocket: Engine, setTimeout, clearTimeout, window: { setTimeout, clearTimeout } });
  const rows = await run({ evaluate: (fn: (args: unknown) => unknown, args: unknown) => fn(args) }, 'wss://test', 'app', vgvAppsForDate('2026-09-16')[0].metrics, 2026, 9, [], []);
  return { rows, dateReads };
}

test('lê o total da coluna azul e datas do DFC com período dual confirmado', async () => {
  const { rows, dateReads } = await collect();
  assert.equal(rows.find((r: { metricKey: string }) => r.metricKey === 'vgv_total_receber').value, 1000);
  assert.equal(dateReads, 1);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r: { selections: Record<string, string> }) => r.selections.vPosicaoInicialDFC === '2026-09-01' && r.selections.vPosicaoFinalDFC === '2200-12-31'));
});

test('interrompe a carga se o Qlik não confirmar o período ou omitir o total', async () => {
  await assert.rejects(collect({ rejectPeriod: true }), /não confirmou/);
  await assert.rejects(collect({ missingTotal: true }), /total da coluna/);
});
