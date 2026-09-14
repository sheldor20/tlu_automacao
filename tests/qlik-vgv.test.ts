import assert from "node:assert/strict";
import test from "node:test";
import type { QlikMetricSnapshot } from "../lib/qlik-cloud.ts";
import { qlikPercentage, vgvIndicatorRows } from "../lib/qlik-vgv.ts";

const row = (metricKey: string, value: number, extra: Partial<QlikMetricSnapshot> = {}): QlikMetricSnapshot => ({
  metricKey, value, mode: "snapshot", referenceMonth: "2026-09-01", appId: "app", sheetId: "sheet", objectId: "object", objectTitle: "KPI", targetLabel: "KPI", selections: { "Grupo Empresa": "Terra Lótus" }, ...extra,
});
const source = () => [row("vgv_total_receber", 1000), row("vgv_inadimplencia_atual", 0.0247, { valueText: "2,47%" }),
  row("vgv_recebimentos_por_data", 100, { dimensionKey: "2025-01-01" }),
  row("vgv_recebimentos_por_data", 400, { dimensionKey: "2026-12-01" }),
  row("vgv_recebimentos_por_data", 500, { dimensionKey: "2028-01-01" }),
];

test("identifica percentuais fracionários e percentuais já escalados pela apresentação do Qlik", () => {
  assert.equal(qlikPercentage({ value: 0.0247, valueText: "2,47%" }), 2.4699999999999998);
  assert.equal(qlikPercentage({ value: 2.47, valueText: "2,47%" }), 2.47);
  assert.equal(qlikPercentage({ value: 0, valueText: "0,00%" }), 0);
  assert.throws(() => qlikPercentage({ value: 13_000_000, valueText: "13,00M" }));
  assert.throws(() => qlikPercentage({ value: 0.20, valueText: "2,47%" }));
});

test("grava o mesmo snapshot nos três cartões e nos anos futuros", () => {
  const { rows, projection } = vgvIndicatorRows(source(), "2026-09-14T18:00:00Z", "2026-09-14");
  assert.equal(projection.adjustedTotal, 975.3);
  assert.equal(projection.overdue, 100);
  assert.deepEqual(projection.points.map((point) => point.closingBalance), [600, 600, 100]);
  assert.ok(rows.every((row) => row.reference_month === "2026-09-01" && row.metadata.synchronized_at === "2026-09-14T18:00:00Z"));
  assert.equal(rows.length, 6);
});

test("não grava uma carga parcial, sem o filtro obrigatório ou sem conciliação", () => {
  assert.throws(() => vgvIndicatorRows(source().slice(0, 2), "2026-09-14T18:00:00Z", "2026-09-14"));
  const unfiltered = source();
  unfiltered[2].selections = {};
  assert.throws(() => vgvIndicatorRows(unfiltered, "2026-09-14T18:00:00Z", "2026-09-14"), /filtro/);
  const incomplete = source();
  incomplete.pop();
  assert.throws(() => vgvIndicatorRows(incomplete, "2026-09-14T18:00:00Z", "2026-09-14"), /concilia/);
});
