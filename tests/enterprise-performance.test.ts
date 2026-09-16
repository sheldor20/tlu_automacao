import assert from "node:assert/strict";
import test from "node:test";
import { annualPerformance, capitalPerformance, datedIrr, datedNpv, datedPerformance, emptyAmounts, performanceAmounts, schedulePerformance, totalPerformance, validCashDate, type PerformanceRow } from "../lib/enterprise-performance.ts";
import { PERFORMANCE_APP, PERFORMANCE_SHEETS, performanceMetricApps, validatedPerformanceSnapshot } from "../lib/qlik-enterprise-performance.ts";
import type { QlikMetricSnapshot } from "../lib/qlik-cloud.ts";

test("XTIR reproduz o exemplo oficial da Microsoft e zera o XVPL", () => {
  const flows = [{ date: "2008-01-01", value: -10000 }, { date: "2008-03-01", value: 2750 }, { date: "2008-10-30", value: 4250 }, { date: "2009-02-15", value: 3250 }, { date: "2009-04-01", value: 2750 }];
  const irr = datedIrr(flows).rate!;
  assert.ok(Math.abs(irr - .3733625335) < 1e-9);
  assert.ok(Math.abs(datedNpv(flows, irr)!) < 1e-7);
});

test("retorno consolidado recalcula os fluxos, sem fazer média das taxas", () => {
  const rows: PerformanceRow[] = [
    { ...emptyAmounts(), date: "2025-01-01", paid: 100 }, { ...emptyAmounts(), date: "2026-01-01", received: 200 },
    { ...emptyAmounts(), date: "2025-01-01", paid: 900 }, { ...emptyAmounts(), date: "2026-01-01", received: 990 },
  ];
  assert.ok(Math.abs(datedIrr(datedPerformance(rows)).rate! - .19) < 1e-10);
  assert.equal(performanceAmounts(totalPerformance(rows), "total").net, 190);
});

test("TIR negativa, prazo longo, fluxos sem sinal e múltiplas raízes", () => {
  const negative = [{ date: "2025-01-01", value: -100 }, { date: "2026-01-01", value: 90 }];
  assert.ok(Math.abs(datedIrr(negative).rate! + .1) < 1e-10);
  const long = [{ date: "2025-01-01", value: -100 }, { date: "2200-01-01", value: 1000 }];
  assert.ok(Math.abs(datedNpv(long, datedIrr(long).rate!)!) < 1e-6);
  assert.equal(datedIrr([{ date: "2026-01-01", value: 100 }]).rate, null);
  assert.match(datedIrr([...negative, { date: "2027-01-01", value: -20 }]).reason!, /não convencional/);
  assert.equal(datedNpv(negative, -1), null);
});

test("vencidos exigem premissa; a reprogramação preserva todos os totais e não modifica baixas", () => {
  const rows = [{ ...emptyAmounts(), date: "2025-06-01", received: 120, paid: 20, receivable: 80, payable: 30 }];
  assert.match(schedulePerformance(rows, "2026-09-16").blockedReason!, /data esperada/);
  assert.match(schedulePerformance(rows, "2026-09-16", "2026-01-01").blockedReason!, /data esperada/);
  const scheduled = schedulePerformance(rows, "2026-09-16", "2026-12-31");
  assert.equal(scheduled.blockedReason, null);
  assert.deepEqual(totalPerformance(rows), totalPerformance(scheduled.rows));
  const years = annualPerformance(scheduled.rows, "total");
  assert.deepEqual(years.map(row => [row.year, row.net]), [["2025", 100], ["2026", 50]]);
  assert.equal(rows[0].date, "2025-06-01");
});

test("datas ausentes não somem dos totais e baixas futuras impedem métricas por data", () => {
  const rows = [{ ...emptyAmounts(), date: null, receivable: 42 }];
  const model = schedulePerformance(rows, "2026-09-16");
  assert.equal(model.undated, 42);
  assert.equal(annualPerformance(model.rows, "total")[0].year, "Sem data");
  assert.equal(annualPerformance(model.rows, "total")[0].accumulated, null);
  assert.equal(totalPerformance(model.rows).receivable, 42);
  assert.match(schedulePerformance([{ ...emptyAmounts(), date: "2027-01-01", paid: 1 }], "2026-09-16").blockedReason!, /posteriores/);
  assert.equal(validCashDate("2026-02-31"), false);
});

test("payback é recuperação definitiva e capital considera o déficit máximo", () => {
  const flows = [
    { date: "2025-01-01", value: -100 }, { date: "2026-01-01", value: 150 },
    { date: "2027-01-01", value: -200 }, { date: "2028-01-01", value: 200 },
  ];
  const capital = capitalPerformance(flows);
  assert.equal(capital.peak, 150);
  assert.equal(capital.peakDate, "2027-01-01");
  assert.equal(capital.recovery, "2028-01-01");
  assert.equal(capitalPerformance(flows, .5).recovery, null);
  assert.equal(capitalPerformance([{ date: "2025-01-01", value: 0 }]).hasDeficit, false);
});

function sourceRows(): QlikMetricSnapshot[] {
  const base = { mode: "snapshot" as const, referenceMonth: "2026-09-01", appId: PERFORMANCE_APP, sheetId: PERFORMANCE_SHEETS.received, objectId: "validated-source", objectTitle: "Fonte validada", targetLabel: "Fonte", selections: {} };
  return [
    { ...base, metricKey: "performance_company", value: 0, companyName: "Empresa A" },
    ...(["received", "paid", "receivable", "payable"] as const).flatMap((kind, index) => [
      { ...base, metricKey: `${kind}:total`, sheetId: PERFORMANCE_SHEETS[kind], value: 100 + index },
      { ...base, metricKey: kind, sheetId: PERFORMANCE_SHEETS[kind], value: 100 + index, companyName: "Empresa A", cashDate: index < 2 ? "2025-12-01" : "2027-01-01" },
    ]),
  ];
}

test("carga concilia as quatro fontes e mantém datas ausentes para correção", () => {
  const rows = sourceRows();
  assert.equal(validatedPerformanceSnapshot(rows).flows.length, 4);
  rows[2].cashDate = null;
  assert.equal(validatedPerformanceSnapshot(rows).flows[0].cash_date, null);
  rows[2].cashDate = "2026-02-31";
  assert.throws(() => validatedPerformanceSnapshot(rows), /Data inválida/);
});

test("carga parcial, duplicada, de outra fonte ou sem empresa não é publicada", () => {
  assert.throws(() => validatedPerformanceSnapshot(sourceRows().slice(0, -1)), /não confere/);
  assert.throws(() => validatedPerformanceSnapshot([...sourceRows(), sourceRows()[2]]), /duplicada/);
  const company = sourceRows(); company[2].companyName = "Fora do catálogo";
  assert.throws(() => validatedPerformanceSnapshot(company), /catálogo/);
  const wrong = sourceRows(); wrong[2].appId = "another-app";
  assert.throws(() => validatedPerformanceSnapshot(wrong), /Origem/);
  const missing = sourceRows().filter(row => row.metricKey !== "paid:total");
  assert.throws(() => validatedPerformanceSnapshot(missing), /falta o total/);
});

test("configuração só permite fontes com objetos e campos explicitamente validados", () => {
  assert.throws(() => performanceMetricApps({}), /validação/);
  assert.throws(() => performanceMetricApps({ mapping_verified: true, company_field: "Empresa" }), /objeto/);
  const sources = Object.fromEntries(Object.keys(PERFORMANCE_SHEETS).map(kind => [kind, { object_id: kind, date_field: "Data validada" }]));
  const apps = performanceMetricApps({ mapping_verified: true, company_field: "Empresa", sources });
  assert.equal(apps[0].isolatedSession, true);
  assert.equal(apps[0].metrics.length, 4);
});
