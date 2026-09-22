import assert from "node:assert/strict";
import test from "node:test";
import { companyMonthSnapshot, latestCompanyCashSnapshot, sumMetricSeries } from "../lib/management-metrics.ts";
import { previousClosedMonth } from "../lib/management-period.ts";
import type { ManagementIndicatorValue } from "../lib/types.ts";

test("soma somente competências disponíveis e preserva ausência total", () => {
  assert.equal(sumMetricSeries([64288.22, 0, 156840, 76400.64, 258249.39, 7246, 0]), 563024.25);
  assert.equal(sumMetricSeries([null, null]), null);
});

test("o histórico mensal mantém o fechamento de agosto mesmo com setembro carregado", () => {
  const rows: Record<string, Record<string, number>> = {
    "2026-08-01": { receita_consolidada: 1700, despesa_consolidada: 1200, resultado_gerencial: 500, valor_caixa: 1460, caixa_disponivel: 760 },
    "2026-09-01": { receita_consolidada: 1120, despesa_consolidada: 840, resultado_gerencial: 280, valor_caixa: 990, caixa_disponivel: 290 },
  };
  const month = previousClosedMonth([
    { key: "2026-08-01", label: "ago", isCurrent: false },
    { key: "2026-09-01", label: "set", isCurrent: true },
  ], 2026);
  assert.deepEqual(companyMonthSnapshot(month.key, (key, reference) => rows[reference]?.[key] ?? null), {
    revenue: 1700, expense: 1200, reportedResult: 500, result: 500, cash: 1460, availableCash: 760, rentalCash: 700,
  });
});

function cashRow(metric: string, month: string, value: number, sync = "2026-09-22T12:00:00Z"): ManagementIndicatorValue {
  const [year, monthNumber] = month.split("-").map(Number);
  const rentalMonth = new Date(Date.UTC(year, monthNumber - 2, 1)).toISOString().slice(0, 10);
  return {
    id: `${metric}-${month}`, area: "empresa", metric_key: metric, reference_month: month,
    dimension_key: "total", dimension_label: null, value, source: "Qlik", notes: null,
    metadata: { synchronized_at: sync, selections: { reference_date: `${month.slice(0, 7)}-22`, saldo_conta_alugueis_competência: rentalMonth } }, updated_at: sync,
  };
}

test("o card de caixa usa setembro e a data da fonte mesmo com agosto fechado", () => {
  const rows = [cashRow("valor_caixa", "2026-08-01", 1460), cashRow("caixa_disponivel", "2026-09-01", 290),
    cashRow("valor_caixa", "2026-09-01", 990), cashRow("caixa_disponivel", "2026-08-01", 760)];
  assert.deepEqual(latestCompanyCashSnapshot(rows, "2026-09-01"), {
    cash: 990, availableCash: 290, rentalCash: 700, referenceMonth: "2026-09-01",
    referenceDate: "2026-09-22", synchronizedAt: "2026-09-22T12:00:00Z",
  });
  // A new database event changes the card without changing its reference month.
  rows[2] = cashRow("valor_caixa", "2026-09-01", 1100, "2026-09-22T12:30:00Z");
  rows[1] = cashRow("caixa_disponivel", "2026-09-01", 400, "2026-09-22T12:30:00Z");
  assert.equal(latestCompanyCashSnapshot(rows, "2026-09-01").cash, 1100);
  assert.equal(latestCompanyCashSnapshot(rows, "2026-09-01").availableCash, 400);
});

test("não mistura o caixa recente com disponível de outro mês ou sincronização", () => {
  const cash = cashRow("valor_caixa", "2026-09-01", 990);
  for (const available of [cashRow("caixa_disponivel", "2026-08-01", 760), cashRow("caixa_disponivel", "2026-09-01", 300, "2026-09-21T12:00:00Z")]) {
    const snapshot = latestCompanyCashSnapshot([cash, available], "2026-09-01");
    assert.equal(snapshot.cash, 990);
    assert.equal(snapshot.availableCash, null);
    assert.equal(snapshot.rentalCash, null);
  }
});

test("seleciona janeiro em vez de dezembro, preservando zero e saldo negativo", () => {
  for (const value of [0, -100]) {
    const snapshot = latestCompanyCashSnapshot([cashRow("valor_caixa", "2025-12-01", 2000),
      cashRow("valor_caixa", "2026-01-01", value), cashRow("caixa_disponivel", "2026-01-01", value - 700)], "2026-01-01");
    assert.equal(snapshot.cash, value);
    assert.equal(snapshot.availableCash, value - 700);
    assert.equal(snapshot.rentalCash, 700);
    assert.equal(snapshot.referenceMonth, "2026-01-01");
  }
});

test("preserva ausência de saldo e ignora dimensões e áreas diferentes", () => {
  const snapshot = latestCompanyCashSnapshot([
    { ...cashRow("valor_caixa", "2026-09-01", 990), dimension_key: "conta-1" },
    { ...cashRow("valor_caixa", "2026-09-01", 990), area: "financas-compras" },
    cashRow("caixa_disponivel", "2026-09-01", 290),
  ], "2026-09-01");
  assert.deepEqual(snapshot, { cash: null, availableCash: null, rentalCash: null,
    referenceMonth: null, referenceDate: null, synchronizedAt: null });
});

test("sem data da fonte mantém a competência original e a atualização registrada", () => {
  const row = cashRow("valor_caixa", "2026-08-01", 990);
  row.metadata = {};
  const snapshot = latestCompanyCashSnapshot([row], "2026-09-01");
  assert.equal(snapshot.referenceDate, null);
  assert.equal(snapshot.referenceMonth, "2026-08-01");
  assert.equal(snapshot.synchronizedAt, row.updated_at);
});

test("não substitui um fechamento ausente por valores de outro mês", () => {
  const current: Record<string, number> = { resultado_gerencial: 280, valor_caixa: 990, caixa_disponivel: 290 };
  const snapshot = companyMonthSnapshot("2026-08-01", (key, reference) => reference === "2026-09-01" ? current[key] ?? null : null);
  assert.deepEqual(snapshot, { revenue: null, expense: null, reportedResult: null, result: null, cash: null, availableCash: null, rentalCash: null });
});

test("calcula resultado com receita e despesa do mesmo mês e preserva zero", () => {
  const rows: Record<string, number> = { receita_consolidada: 1200, despesa_consolidada: 1200, valor_caixa: 700, caixa_disponivel: 0 };
  const snapshot = companyMonthSnapshot("2026-08-01", (key) => rows[key] ?? null);
  assert.equal(snapshot.result, 0);
  assert.equal(snapshot.availableCash, 0);
  assert.equal(snapshot.rentalCash, 700);
  assert.equal(companyMonthSnapshot("2026-08-01", (key) => key === "resultado_gerencial" ? 0 : rows[key] ?? null).reportedResult, 0);
});

test("janeiro consulta o fechamento de dezembro do ano anterior", () => {
  const month = previousClosedMonth([{ key: "2026-01-01", label: "jan", isCurrent: true }], 2026);
  const readMonths = new Set<string>();
  companyMonthSnapshot(month.key, (_, reference) => { readMonths.add(reference); return null; });
  assert.deepEqual([...readMonths], ["2025-12-01"]);
});

test("em janeiro não exibe disponível calculado com aluguel do próprio mês", () => {
  const cash = cashRow("valor_caixa", "2026-01-01", 1000);
  const available = cashRow("caixa_disponivel", "2026-01-01", 500);
  available.metadata.selections = { saldo_conta_alugueis_competência: "2026-01-01" };
  const snapshot = latestCompanyCashSnapshot([cash, available], "2026-01-01");
  assert.equal(snapshot.cash, 1000);
  assert.equal(snapshot.availableCash, null);
  assert.equal(snapshot.rentalCash, null);
  assert.equal(latestCompanyCashSnapshot([cash, available], "2026-02-01").availableCash, 500);
});

test("não apresenta uma competência futura como saldo atual", () => {
  const snapshot = latestCompanyCashSnapshot([cashRow("valor_caixa", "2026-09-01", 1000),
    cashRow("valor_caixa", "2026-10-01", 2000)], "2026-09-01");
  assert.equal(snapshot.cash, 1000);
});
