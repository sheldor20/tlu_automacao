import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { PERFORMANCE_APP, PERFORMANCE_SHEETS, performanceMetricApps, validatedPerformanceSnapshot } from "../lib/qlik-enterprise-performance.ts";

const source = readFileSync(new URL("../lib/qlik-cloud.ts", import.meta.url), "utf8");
const collector = ts.transpileModule(source.slice(source.indexOf("async function readQlikEngineMetrics("), source.indexOf("async function launchBrowser(")), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

async function collect(options: { truncated?: boolean; date?: string; missingCompany?: boolean; totalMissing?: boolean; empty?: boolean } = {}) {
  const kinds = Object.keys(PERFORMANCE_SHEETS);
  const fields = ["Empresa", "Data do fluxo"];
  const cubes = new Map<number, number>();
  let nextHandle = 200, reads = 0, clears = 0, destroyed = 0;
  const total = options.empty ? 0 : 1001;
  class Engine {
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    constructor() { queueMicrotask(() => this.onopen?.()); }
    close() {}
    send(json: string) {
      const { id, handle, method, params } = JSON.parse(json);
      let result;
      if (method === "OpenDoc") result = { qReturn: { qHandle: 1 } };
      else if (method === "GetObject") result = { qReturn: { qHandle: 100 + kinds.indexOf(params.qId) } };
      else if (method === "ClearAll") { clears++; result = {}; }
      else if (method === "GetEffectiveProperties") result = { qProp: { qHyperCubeDef: { qMeasures: [{ qLibraryId: kinds[handle - 100] }] } } };
      else if (method === "CreateSessionObject") {
        if (params.qProp.qFieldListDef) result = { qReturn: { qHandle: 2 } };
        else if (params.qProp.qListObjectDef) { assert.equal(params.qProp.qListObjectDef.qDef.qFieldDefs[0], "Empresa"); result = { qReturn: { qHandle: 3 } }; }
        else {
          const definition = params.qProp.qHyperCubeDef;
          assert.ok(kinds.includes(definition.qMeasures[0].qLibraryId));
          assert.equal(definition.qStateName, "$");
          const dimensions = definition.qDimensions.map((value: { qDef: { qFieldDefs: string[] } }) => value.qDef.qFieldDefs[0]);
          assert.deepEqual(dimensions, dimensions.length ? fields : []);
          const h = nextHandle++; cubes.set(h, dimensions.length); result = { qReturn: { qHandle: h } };
        }
      } else if (method === "DestroySessionObject") { destroyed++; result = {}; }
      else if (method === "GetLayout") {
        if (handle === 2) result = { qLayout: { qFieldList: { qItems: fields.map(qName => ({ qName })) } } };
        else if (handle === 3) result = { qLayout: { qListObject: { qSize: { qcy: 2 }, qDataPages: [{ qMatrix: [[{ qText: "Empresa A" }], [{ qText: "Empresa sem fluxo" }]] }] } } };
        else if (cubes.has(handle)) result = { qLayout: { qInfo: { qId: `cube-${handle}` }, qHyperCube: { qSize: { qcx: cubes.get(handle)! + 1, qcy: total }, qGrandTotalRow: options.totalMissing ? [] : [{ qNum: total }], qMeasureInfo: [{}] } } };
        else result = { qLayout: { qHyperCube: { qMeasureInfo: [{}], qDimensionInfo: [], qSize: { qcx: 1, qcy: 1 } } } };
      } else if (method === "GetHyperCubeData") {
        reads++;
        const page = params.qPages[0];
        assert.equal(page.qWidth, 3);
        const length = options.truncated && page.qTop > 0 ? 0 : page.qHeight;
        result = { qDataPages: [{ qMatrix: Array.from({ length }, (_, i) => [
          { qText: options.missingCompany ? "-" : "Empresa A" },
          { qText: options.date || new Date(Date.UTC(2021, 0, 1 + page.qTop + i)).toISOString().slice(0, 10) },
          { qNum: 1 },
        ]) }] };
      } else throw new Error(`Unexpected ${method}`);
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id, result }) }));
    }
  }
  const run = runInNewContext(`${collector}\nreadQlikEngineMetrics`, { WebSocket: Engine, setTimeout, clearTimeout, window: { setTimeout, clearTimeout } });
  const sources = Object.fromEntries(kinds.map(kind => [kind, { object_id: kind, date_field: "Data do fluxo" }]));
  const apps = performanceMetricApps({ mapping_verified: true, company_field: "Empresa", sources });
  const rows = await run({ evaluate: (fn: (args: unknown) => unknown, args: unknown) => fn(args) }, "wss://fixture.test", PERFORMANCE_APP, apps[0].metrics, 2026, 9, [], []);
  return { rows, reads, clears, destroyed };
}

test("coletor pagina os fluxos e mantém empresas sem movimentos no filtro", async () => {
  const { rows, reads, clears, destroyed } = await collect();
  const snapshot = validatedPerformanceSnapshot(rows);
  assert.equal(snapshot.flows.length, 4004);
  assert.equal(snapshot.companies.length, 2);
  assert.equal(reads, 8);
  assert.equal(clears, 4);
  assert.equal(destroyed, 8);
  assert.equal(snapshot.metadata.sources.received.total, 1001);
});

test("coletor aceita fonte zerada e rejeita páginas truncadas, datas inválidas e valores sem empresa", async () => {
  const empty = validatedPerformanceSnapshot((await collect({ empty: true })).rows);
  assert.equal(empty.flows.length, 0);
  assert.equal(empty.companies.length, 2);
  await assert.rejects(collect({ truncated: true }), /incompleta/);
  await assert.rejects(collect({ date: "31/02/2026" }), /data financeira inválida/);
  await assert.rejects(collect({ missingCompany: true }), /sem empresa/);
  await assert.rejects(collect({ totalMissing: true }), /total financeiro indisponível/);
});
