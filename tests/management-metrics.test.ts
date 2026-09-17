import assert from "node:assert/strict";
import test from "node:test";
import { companyMonthSnapshot, sumMetricSeries } from "../lib/management-metrics.ts";
import { previousClosedMonth } from "../lib/management-period.ts";

test("soma somente competências disponíveis e preserva ausência total", () => {
  assert.equal(sumMetricSeries([64288.22, 0, 156840, 76400.64, 258249.39, 7246, 0]), 563024.25);
  assert.equal(sumMetricSeries([null, null]), null);
});

test("resultado, caixa e disponível usam agosto mesmo com setembro carregado", () => {
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
