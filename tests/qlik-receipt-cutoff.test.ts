import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { QLIK_LEGAL_SALES_APPS } from "../lib/qlik-legal-sales.ts";

// Execute the actual browser-side collector against a deterministic Engine,
// including object selection, receipt selection, and monthly accumulation.
const source = readFileSync(new URL("../lib/qlik-cloud.ts", import.meta.url), "utf8");
const collector = ts.transpileModule(source.slice(
  source.indexOf("async function readQlikEngineMetrics("),
  source.indexOf("async function launchBrowser("),
), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

async function collect({ total = 3344, field = "Último Recebimento", onlyChart = false } = {}) {
  let selected: string[] = [];
  const receipts = ["Não Informado", "31/12/2025", "31/01/2026", "31/05/2026", "31/07/2026", "10/08/2026", "31/08/2026", "01/09/2026", "02/09/2026", "04/09/2026", "10/09/2026"];
  const counts: Record<string, number> = { "Não Informado": 4, "31/12/2025": total - 15, "31/01/2026": 1, "31/05/2026": 1, "31/07/2026": 1, "10/08/2026": 3, "31/08/2026": 1, "01/09/2026": 1, "02/09/2026": 1, "04/09/2026": 1, "10/09/2026": 1 };
  const metric = QLIK_LEGAL_SALES_APPS.flatMap(app => app.metrics).find(m => m.metricKey === "unidades_quitadas")!;
  class Engine {
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    constructor() { queueMicrotask(() => this.onopen?.()); }
    close() {}
    send(json: string) {
      const { id, handle, method, params } = JSON.parse(json);
      let result;
      if (method === "OpenDoc") result = { qReturn: { qHandle: 1 } };
      else if (method === "GetObject") result = { qReturn: { qHandle: params.qId === metric.sheetId ? 2 : params.qId === "kpi" ? 3 : 4 } };
      else if (method === "GetChildInfos") result = { qInfos: handle === 2 ? [ ...(!onlyChart ? [{ qId: "kpi", qType: "kpi" }] : []), { qId: "chart", qType: "barchart" }] : [] };
      else if (method === "CreateSessionObject") result = { qReturn: { qHandle: params.qProp.qFieldListDef ? 5 : 6 } };
      else if (method === "GetField") { assert.equal(params.qFieldName, field); result = { qReturn: { qHandle: 7 } }; }
      else if (method === "ClearAll") { selected = []; result = {}; }
      else if (method === "SelectValues") { selected = params.qFieldValues.map((v: { qText: string }) => v.qText); result = { qReturn: true }; }
      else if (method === "GetLayout") {
        if (handle === 5) result = { qLayout: { qFieldList: { qItems: [{ qName: field }] } } };
        else if (handle === 6) result = { qLayout: { qListObject: { qSize: { qcy: receipts.length }, qDataPages: [{ qMatrix: receipts.map(qText => [{ qText }]) }] } } };
        else result = { qLayout: { title: handle === 3 ? "Vendas Quitadas Total" : "Vendas Quitadas", qHyperCube: { qDimensionInfo: handle === 4 ? [{}] : [], qMeasureInfo: [{}], qSize: { qcx: handle === 4 ? 2 : 1, qcy: handle === 4 ? 10 : 1 } } } };
      } else if (method === "GetHyperCubeData") {
        assert.equal(handle, 3, "Must read the total KPI, never the first row of a chart");
        result = { qDataPages: [{ qMatrix: [[{ qNum: selected.length ? selected.reduce((sum, value) => sum + counts[value], 0) : total }]] }] };
      } else throw new Error(`Unexpected call ${method}`);
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id, result }) }));
    }
  }
  const run = runInNewContext(`${collector}\nreadQlikEngineMetrics`, { WebSocket: Engine, setTimeout, clearTimeout, window: { setTimeout, clearTimeout } });
  return run({ evaluate: (fn: (args: unknown) => unknown, args: unknown) => fn(args) }, "wss://test", "app", [metric], 2026, 8, [], []);
}

test("agosto subtrai 4 recebimentos de setembro e preserva 4 sem data", async () => {
  const rows = await collect();
  assert.equal(rows.length, 8);
  assert.equal(rows[7].value, 3340);
  assert.equal(rows[7].selections.excluded_after_cutoff, "4");
  assert.equal(rows[7].selections.reference_date, "2026-08-31");
  assert.equal(rows[6].value, 3336, "julho também exclui os 4 recebimentos de agosto");
});

test("fechamento inclui sábado e domingo e mantém os anos anteriores", async () => {
  const rows = await collect();
  assert.equal(rows[0].value, 3334, "31 de janeiro é sábado e entra no fechamento");
  assert.equal(rows[4].value, 3335, "31 de maio é domingo e entra no fechamento");
});

test("campo genérico Data não substitui Último Recebimento", async () => {
  await assert.rejects(collect({ field: "Data" }), /campo exato/);
});

test("não aceita gráfico por empreendimento como total", async () => {
  await assert.rejects(collect({ onlyChart: true }), /não encontrado/);
});
