import assert from "node:assert/strict";
import test from "node:test";
import { bankBalanceApp, bankBalanceForSelection, verifiedBankBalance, WEEKLY_BANK_METRIC } from "../lib/cash-bank-balance.ts";
import type { QlikCloudMetricApp, QlikMetricSnapshot } from "../lib/qlik-cloud";

const source: QlikCloudMetricApp = {
  entryUrl: "https://tenant.qlikcloud.com/sense/app/finance/sheet/dfc",
  metrics: [{ metricKey: "saldo_conta_alugueis", sheetId: "dfc", objectId: "validated-account-composition",
    targetLabel: "Composição Saldo Inicial | Contas", mode: "monthly", aggregation: "sum-rows",
    stateName: "<estado alternativo 01>", periodStrategy: "month-end-variables",
    periodVariables: ["vPosicaoInicialDFC", "vPosicaoFinalDFC"],
    filters: [{ label: "Aluguéis", fieldCandidates: ["Conta Banco"], values: ["rental-only"] }] }],
};
const snapshot = (value = 123.45): QlikMetricSnapshot => ({
  metricKey: WEEKLY_BANK_METRIC, mode: "snapshot", referenceMonth: "2026-09-01", value,
  appId: "finance", sheetId: "dfc", objectId: "validated-account-composition", objectTitle: "Saldo", targetLabel: "Saldo",
  selections: { account_count: "2", qlik_total: String(value), vPosicaoInicialDFC: "2026-09-17", vPosicaoFinalDFC: "2026-09-17" },
});
const balance = () => verifiedBankBalance(snapshot(), "2026-09-17", "", "2026-09-17T15:00:00Z");

test("reuses the DFC object and alternate state, without monthly or rental filters", () => {
  const app = bankBalanceApp(source, "2026-09-17", ["2", "1", "2"]);
  const metric = app.metrics[0];
  assert.equal(app.isolatedSession, true);
  assert.equal(metric.objectId, source.metrics[0].objectId);
  assert.equal(metric.aggregation, "sum-rows");
  assert.equal(metric.stateName, source.metrics[0].stateName);
  assert.equal(metric.mode, "snapshot");
  assert.equal(metric.periodStrategy, undefined);
  assert.deepEqual(metric.filters?.[0].values, ["1", "2"]);
  assert.deepEqual(metric.filters?.[0].fieldCandidates, ["%IdEmpresa"]);
  assert.equal(metric.filters?.[0].requireAllValues, true);
  assert.equal(metric.filters?.length, 1);
  assert.equal(source.metrics[0].filters?.[0].values?.[0], "rental-only");
});
test("sets both DFC dates to the exact selected day, not month end", () => {
  const variables = bankBalanceApp(source, "2026-09-17", ["1"]).metrics[0].variables!;
  assert.equal(variables.length, 2);
  for (const variable of variables) {
    assert.equal(new Date(Date.UTC(1899, 11, 30) + Number(variable.value) * 86_400_000).toISOString().slice(0, 10), "2026-09-17");
    assert.equal(variable.label, "2026-09-17");
  }
});
test("rejects invalid dates and empty company scopes", () => {
  for (const date of ["2026-02-30", "invalid", "2026-9-1"]) assert.throws(() => bankBalanceApp(source, date, ["1"]));
  assert.throws(() => bankBalanceApp(source, "2026-09-17", []));
  assert.throws(() => bankBalanceApp(source, "2026-09-17", [" "]));
});
test("fails closed when the validated DFC reference is missing", () => {
  assert.throws(() => bankBalanceApp({ ...source, metrics: [] }, "2026-09-17", ["1"]));
});
test("accepts positive, negative and zero bank balances without manufacturing missing data", () => {
  for (const value of [123.45, 0, -42.56]) {
    assert.equal(verifiedBankBalance(snapshot(value), "2026-09-17", "1", "2026-09-17T15:00:00Z").amount, value);
  }
});
test("rejects an unbalanced composition or a different date", () => {
  const s = snapshot();
  assert.throws(() => verifiedBankBalance({ ...s, value: 999 }, "2026-09-17", "", "now"));
  assert.throws(() => verifiedBankBalance(s, "2026-09-18", "", "now"));
  assert.throws(() => verifiedBankBalance({ ...s, value: NaN }, "2026-09-17", "", "now"));
  assert.throws(() => verifiedBankBalance({ ...s, selections: { ...s.selections, account_count: "0" } }, "2026-09-17", "", "now"));
  assert.throws(() => verifiedBankBalance({ ...snapshot(0), selections: { ...s.selections, qlik_total: "" } }, "2026-09-17", "", "now"));
});
test("does not reuse consolidated cash for an individual company", () => {
  assert.equal(bankBalanceForSelection(balance(), "2026-09-17", "1"), null);
  assert.equal(bankBalanceForSelection(balance(), "2026-09-17", "")?.amount, 123.45);
});
test("does not reuse a response for a different date or filter", () => {
  assert.equal(bankBalanceForSelection(balance(), "2026-09-18", ""), null);
  assert.equal(bankBalanceForSelection({ ...balance(), company_id: "2" }, "2026-09-17", "1"), null);
  assert.equal(bankBalanceForSelection(undefined, "2026-09-17", ""), null);
});
test("preserves zero and negative values in the selected view", () => {
  for (const amount of [0, -10]) assert.equal(bankBalanceForSelection({ ...balance(), amount }, "2026-09-17", "")?.amount, amount);
});
