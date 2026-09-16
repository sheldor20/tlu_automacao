import assert from "node:assert/strict";
import test from "node:test";
import {
  applyFinanceMetricOverrides,
  QLIK_FINANCE_APPS,
  QLIK_FINANCE_BASE_METRIC_KEYS,
  financeAppsForSettings,
  rentalBankAccountsFromSettings,
  QLIK_RENTAL_BALANCE_OBJECT,
  toFinanceIndicatorRows,
  validateFinanceSnapshots,
  validateRentalBalanceSnapshot,
} from "../lib/qlik-finance.ts";
import type { QlikMetricSnapshot } from "../lib/qlik-cloud.ts";

const QLIK_RENTAL_BANK_ACCOUNTS = ["100-1A", "200-1", "300-2", "300-2A", "100-1", "400-4", "500-0", "400-4A", "600-7"];
const settings = { rental_bank_accounts: QLIK_RENTAL_BANK_ACCOUNTS };

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
    objectId: metricKey === "saldo_conta_alugueis" ? QLIK_RENTAL_BALANCE_OBJECT : `object-${metricKey}`,
    objectTitle: metricKey,
    targetLabel: metricKey,
    selections: metricKey === "saldo_conta_alugueis" ? {
      "Conta Banco": QLIK_RENTAL_BANK_ACCOUNTS.join(" | "),
      account_balances: JSON.stringify([{ dimensions: ["104 - BCO CX EC FEDERAL SA", `${QLIK_RENTAL_BANK_ACCOUNTS[0]} - APLICAÇÃO - ALUGUEL GUIMARÃES`, "Conta Aplicação"], value }]),
      qlik_total: String(value),
    } : { Grupo: "Terra Lotus" },
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
  const metrics = financeAppsForSettings(settings).flatMap((app) => app.metrics);
  const balance = metrics.find((metric) => metric.metricKey === "saldo_conta_alugueis");
  const cash = metrics.find((metric) => metric.metricKey === "valor_caixa");
  const revenue = metrics.find((metric) => metric.metricKey === "receita_alugueis_mes");
  const expense = metrics.find((metric) => metric.metricKey === "despesa_alugueis_mes");
  assert.equal(balance?.objectId, QLIK_RENTAL_BALANCE_OBJECT);
  assert.equal(balance?.aggregation, "sum-rows");
  assert.equal(balance?.stateName, "<estado alternativo 01>");
  assert.equal(balance?.periodStrategy, "month-end-variables");
  assert.deepEqual(balance?.periodVariables, ["vPosicaoInicialDFC", "vPosicaoFinalDFC"]);
  assert.equal(cash?.periodStrategy, "date-last-day");
  const accounts = balance?.filters?.find((filter) => filter.fieldCandidates.includes("Conta Banco"));
  assert.deepEqual(accounts?.values, QLIK_RENTAL_BANK_ACCOUNTS);
  assert.equal(accounts?.requireAllValues, true);
  assert.equal(accounts?.contains, undefined);
  assert.ok(revenue?.filters?.some((filter) => filter.contains?.includes("aluguel de imóveis")));
  assert.ok(expense?.filters?.some((filter) => filter.label.includes("fluxo financeiro")));
  assert.equal(expense?.targetLabel, "Pagamentos 💰");
  assert.ok(expense?.aliases?.includes("IN: Desembolso Financeiro"));
  const expenseBreakdown = metrics.find((metric) => metric.metricKey === "despesa_plano_contas");
  assert.ok(expenseBreakdown?.aliases?.includes("Fluxo Financeiro"));
  assert.equal(expenseBreakdown?.objectId, "HgngyL");
});

test("calcula o caixa atual descontando o saldo de aluguéis do último mês fechado", () => {
  const snapshots = applyFinanceMetricOverrides(createSnapshots(), {
    saldo_conta_alugueis: { "2026-07-01": 999 },
  });
  const overriddenRentalCash = snapshots.find((item) => item.metricKey === "saldo_conta_alugueis" && item.referenceMonth === "2026-07-01")!;
  assert.equal(overriddenRentalCash.value, 6);
  assert.equal(overriddenRentalCash.selections.valor_qlik_original, undefined);
  const result = validateFinanceSnapshots(snapshots, now, QLIK_RENTAL_BANK_ACCOUNTS);
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

test("reconcilia todas as contas, rejeitando subtotal, duplicidade e filtro incorreto", () => {
  const values = [400.45, 70.67, 60.77, 60.88, 40.28, 10.60, 6.52, 5.36, 5.16];
  const balance = snapshot("saldo_conta_alugueis", "2026-08-01", 660.69);
  balance.selections.account_balances = JSON.stringify(QLIK_RENTAL_BANK_ACCOUNTS.map((account, index) => ({
    dimensions: ["104 - BCO CX EC FEDERAL SA", `${account} - CONTA ALUGUEIS`, "Conta"], value: values[index],
  })));
  balance.selections.qlik_total = "660.6900000001";
  assert.doesNotThrow(() => validateRentalBalanceSnapshot(balance, QLIK_RENTAL_BANK_ACCOUNTS));
  assert.throws(() => validateRentalBalanceSnapshot({ ...balance, value: 400.45 }, QLIK_RENTAL_BANK_ACCOUNTS), /composição.*inválida/);
  assert.throws(() => validateRentalBalanceSnapshot({ ...balance, objectId: "a28ab59d-72cb-445d-870f-58e2df5516f5" }, QLIK_RENTAL_BANK_ACCOUNTS), /composição.*inválida/);
  const rows = JSON.parse(balance.selections.account_balances);
  rows[8] = rows[0];
  assert.throws(() => validateRentalBalanceSnapshot({ ...balance, selections: { ...balance.selections, account_balances: JSON.stringify(rows) } }, QLIK_RENTAL_BANK_ACCOUNTS), /composição.*inválida/);
  assert.throws(() => validateRentalBalanceSnapshot({ ...balance, selections: { ...balance.selections, "Conta Banco": "ALUGUEIS" } }, QLIK_RENTAL_BANK_ACCOUNTS), /composição.*inválida/);
});

test("recusa a carga inteira quando falta uma competência financeira", () => {
  const incomplete = createSnapshots().filter((item) => !(
    item.metricKey === "valor_caixa" && item.referenceMonth === "2026-04-01"
  ));
  assert.throws(() => validateFinanceSnapshots(incomplete, now, QLIK_RENTAL_BANK_ACCOUNTS), /valor_caixa.*2026-04-01.*nenhum dado foi gravado/i);
});

test("mapeia aluguéis para Finanças e Compras e consolidados para Empresa", () => {
  assert.deepEqual(new Set(QLIK_FINANCE_BASE_METRIC_KEYS), new Set(createSnapshots().map((item) => item.metricKey)));
  const rows = toFinanceIndicatorRows(validateFinanceSnapshots(createSnapshots(), now, QLIK_RENTAL_BANK_ACCOUNTS), "2026-08-13T15:00:00.000Z");
  assert.equal(rows.find((row) => row.metric_key === "saldo_conta_alugueis")?.area, "financas-compras");
  assert.equal(rows.find((row) => row.metric_key === "receita_consolidada")?.area, "empresa");
  assert.equal(rows.find((row) => row.metric_key === "caixa_disponivel")?.area, "empresa");
  assert.equal(rows.find((row) => row.metric_key === "receita_plano_contas")?.dimension_label, "Conta teste");
});

test("exige a configuração protegida completa e sem contas duplicadas", () => {
  assert.deepEqual(rentalBankAccountsFromSettings(settings), QLIK_RENTAL_BANK_ACCOUNTS);
  assert.throws(() => financeAppsForSettings({}), /configure as nove contas/);
  assert.throws(() => financeAppsForSettings({rental_bank_accounts:Array(9).fill("100-1")}), /configure as nove contas/);
});
