import assert from "node:assert/strict";
import test from "node:test";
import type { QlikMetricSnapshot } from "../lib/qlik-cloud.ts";
import { QLIK_VGV_DFC_OBJECT, QLIK_VGV_DFC_SHEET, qlikPercentage, vgvAppsForDate, vgvIndicatorRows, vgvPeriod } from "../lib/qlik-vgv.ts";

const row = (metricKey: string, value: number, extra: Partial<QlikMetricSnapshot> = {}): QlikMetricSnapshot => ({
  metricKey, value, mode: "snapshot", referenceMonth: "2026-09-01", appId: "app", sheetId: QLIK_VGV_DFC_SHEET, objectId: QLIK_VGV_DFC_OBJECT, objectTitle: "KPI", targetLabel: "KPI", selections: { "Grupo Empresa": "Terra Lótus", vPosicaoInicialDFC: "2026-09-01", vPosicaoFinalDFC: "2200-12-31", vApresentaPrevisoes: "Sim", vFiltroInterCompany: "*" }, ...extra,
});
const source = () => [row("vgv_total_receber", 1000), row("vgv_inadimplencia_atual", 0.0247, { valueText: "2,47%" }),
  row("vgv_recebimentos_por_data", 100, { dimensionKey: "2026-09-01" }),
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
  assert.equal(projection.overdue, 0);
  assert.deepEqual(projection.points.map((point) => point.closingBalance), [500, 500, 0]);
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


test("usa a coluna azul do DFC e o mesmo período e filtros no total e no cronograma", () => {
  const apps = vgvAppsForDate("2026-09-16");
  const [total, dates] = apps[0].metrics;
  assert.equal(apps[0].isolatedSession, true);
  assert.equal(total.objectId, QLIK_VGV_DFC_OBJECT);
  assert.equal(total.aggregation, "grand-total");
  assert.equal(dates.breakdownDateField, "Período");
  assert.deepEqual(total.filters, dates.filters);
  assert.equal(total.filters?.length, 1, "Agrupadores detalham o total, sem excluir outras entradas previstas.");
  assert.deepEqual(total.variables, dates.variables);
  assert.deepEqual(total.variables?.slice(0, 2).map(v => [v.name, v.label]), [["vPosicaoInicialDFC", "2026-09-01"], ["vPosicaoFinalDFC", "2200-12-31"]]);
  assert.deepEqual(vgvPeriod("2027-01-01"), {start: "2027-01-01", end: "2200-12-31"});
  assert.throws(() => vgvPeriod("2026-02-30"));
  assert.equal(apps[1].metrics[0].objectId, "sUJvzf");
  assert.equal(apps[1].metrics[0].measureIndex, 1);
  assert.equal(apps[1].metrics[0].filters, undefined);
});

test("não aceita origem antiga, período incorreto ou datas fora do DFC", () => {
  for (const change of [
    (r: QlikMetricSnapshot) => { r.objectId = "old-receivables"; },
    (r: QlikMetricSnapshot) => { r.selections.vPosicaoInicialDFC = "2026-09-16"; },
    (r: QlikMetricSnapshot) => { r.dimensionKey = "2026-08-31"; },
  ]) {
    const rows = source(); change(rows[2]);
    assert.throws(() => vgvIndicatorRows(rows, "2026-09-16T15:00:00Z", "2026-09-16"));
  }
});
