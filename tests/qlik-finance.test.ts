import assert from "node:assert/strict";
import test from "node:test";
import {
  QLIK_FINANCE_APPS,
  QLIK_FINANCE_BASE_METRIC_KEYS,
  toFinanceIndicatorRows,
  validateFinanceSnapshots,
} from "../lib/qlik-finance.ts";
import type { QlikMetricSnapshot } from "../lib/qlik-cloud.ts";

const now = new Date("2026-08-13T12:00:00-03:00");
const months = Array.from({ length: 8 }, (_, index) => `2026-${String(index + 1).padStart(2, "0")}-01`);

function snapshot(metricKey: string, referenceMonth: string, value: number, dimension?: string): QlikMetricSnapshot {
  return {
    metricKey,
    mode: dimension ? "breakdown" : "monthly",
    referenceMonth,
    value,
    appId: "finance-app",
    sheetId: "finance-sheet",
    objectId: `object-${metricKey}`,
    objectTitle: metricKey,
    targetLabel: metricKey,
    selections: { Grupo: "Terra Lotus" },
    ...(dimension ? { dimensionKey: dimension, dimensionLabel: "Conta teste" } : {}),
  };
}

function createSnapshots() {
  const definitions = QLIK_FINANCE_APPS.flatMap((app) => app.metrics);
  return definitions.flatMap((definition, metricIndex) => {
    if (definition.mode === "breakdown") return [snapshot(definition.metricKey, "2026-07-01", 100 + metricIndex, `conta-${metricIndex}`)];
    return months.map((month, monthIndex) => snapshot(definition.metricKey, month, metricIndex * 1_000 + monthIndex));
  });
}

test("configura os três recortes de aluguel e o grupo Terra Lotus", () => {
  const metrics = QLIK_FINANCE_APPS.flatMap((app) => app.metrics);
  const balance = metrics.find((metric) => metric.metricKey === "saldo_conta_alugueis");
  const cash = metrics.find((metric) => metric.metricKey === "valor_caixa");
  const revenue = metrics.find((metric) => metric.metricKey === "receita_alugueis_mes");
  const expense = metrics.find((metric) => metric.metricKey === "despesa_alugueis_mes");
  assert.ok(balance?.filters?.some((filter) => filter.contains?.includes("alguel")));
  assert.equal(balance?.periodStrategy, "date-last-day");
  assert.equal(cash?.periodStrategy, "date-last-day");
  assert.ok(balance?.filters?.some((filter) => filter.fieldCandidates.includes("Descrição Conta Banco")));
  assert.ok(revenue?.filters?.some((filter) => filter.contains?.includes("aluguel de imóveis")));
  assert.ok(expense?.filters?.some((filter) => filter.label.includes("fluxo financeiro")));
  assert.equal(expense?.targetLabel, "Pagamentos 💰");
  assert.ok(expense?.aliases?.includes("IN: Desembolso Financeiro"));
  const expenseBreakdown = metrics.find((metric) => metric.metricKey === "despesa_plano_contas");
  assert.ok(expenseBreakdown?.aliases?.includes("Fluxo Financeiro"));
  assert.equal(expenseBreakdown?.objectId, "HgngyL");
});

test("calcula o caixa atual descontando o saldo de aluguéis do último mês fechado", () => {
  const result = validateFinanceSnapshots(createSnapshots(), now);
  assert.equal(result.length, 66);
  const august = result.find((item) => item.metricKey === "resultado_gerencial" && item.referenceMonth === "2026-08-01");
  const revenue = result.find((item) => item.metricKey === "receita_consolidada" && item.referenceMonth === "2026-08-01")!;
  const expense = result.find((item) => item.metricKey === "despesa_consolidada" && item.referenceMonth === "2026-08-01")!;
  assert.equal(august?.value, revenue.value - expense.value);
  const availableCash = result.find((item) => item.metricKey === "caixa_disponivel" && item.referenceMonth === "2026-08-01");
  const cash = result.find((item) => item.metricKey === "valor_caixa" && item.referenceMonth === "2026-08-01")!;
  const rentalCash = result.find((item) => item.metricKey === "saldo_conta_alugueis" && item.referenceMonth === "2026-07-01")!;
  assert.equal(availableCash?.value, cash.value - rentalCash.value);
  assert.equal(availableCash?.selections.cálculo, "valor em caixa atual - saldo da conta de aluguéis do último mês fechado");
  assert.equal(availableCash?.selections.saldo_conta_alugueis_competência, "2026-07-01");
  const julyAvailableCash = result.find((item) => item.metricKey === "caixa_disponivel" && item.referenceMonth === "2026-07-01")!;
  const julyCash = result.find((item) => item.metricKey === "valor_caixa" && item.referenceMonth === "2026-07-01")!;
  assert.equal(julyAvailableCash.value, julyCash.value - rentalCash.value);
});

test("recusa a carga inteira quando falta uma competência financeira", () => {
  const incomplete = createSnapshots().filter((item) => !(
    item.metricKey === "valor_caixa" && item.referenceMonth === "2026-04-01"
  ));
  assert.throws(() => validateFinanceSnapshots(incomplete, now), /valor_caixa.*2026-04-01.*nenhum dado foi gravado/i);
});

test("mapeia aluguéis para Finanças e Compras e consolidados para Empresa", () => {
  assert.deepEqual(new Set(QLIK_FINANCE_BASE_METRIC_KEYS), new Set(createSnapshots().map((item) => item.metricKey)));
  const rows = toFinanceIndicatorRows(validateFinanceSnapshots(createSnapshots(), now), "2026-08-13T15:00:00.000Z");
  assert.equal(rows.find((row) => row.metric_key === "saldo_conta_alugueis")?.area, "financas-compras");
  assert.equal(rows.find((row) => row.metric_key === "receita_consolidada")?.area, "empresa");
  assert.equal(rows.find((row) => row.metric_key === "caixa_disponivel")?.area, "empresa");
  assert.equal(rows.find((row) => row.metric_key === "receita_plano_contas")?.dimension_label, "Conta teste");
});
