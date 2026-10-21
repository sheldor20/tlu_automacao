import assert from "node:assert/strict";
import test from "node:test";
import { consolidateCompanyCash } from "../lib/company-cash.ts";
import type { QlikMetricSnapshot } from "../lib/qlik-cloud.ts";

const row = (account: string, value: number) => ({ dimensions: ["104 - Caixa", account, "Conta"], value });
function snapshot(rows: ReturnType<typeof row>[], date = "2026-09-30"): QlikMetricSnapshot {
  const total = rows.reduce((sum, account) => sum + account.value, 0);
  return { metricKey: "valor_caixa", mode: "monthly", referenceMonth: "2026-09-01", value: total,
    appId: "finance", sheetId: "dfc", objectId: "accounts", objectTitle: "Contas", targetLabel: "Saldo",
    selections: { reference_date: date, account_balances: JSON.stringify(rows), qlik_total: String(total) } };
}

test("inclui contas de aluguéis fora do grupo sem duplicar as já presentes", () => {
  const group = snapshot([row("grupo", 100), row("aluguel-1", 70)]);
  const rentals = snapshot([row("aluguel-1", 70), row("aluguel-2", 20)]);
  const total = consolidateCompanyCash(group, rentals);
  assert.equal(total.value, 190);
  assert.equal(total.selections.saldo_alugueis_adicional, "20");
  assert.equal(total.selections.qlik_total, "170");
  assert.equal(group.value, 170);
  assert.equal(JSON.parse(total.selections.consolidated_account_balances).length, 3);
});

test("preserva valores negativos e zero na união", () => {
  assert.equal(consolidateCompanyCash(snapshot([row("grupo", 0)]), snapshot([row("aluguel", -20)])).value, -20);
  assert.equal(consolidateCompanyCash(snapshot([row("mesma", 0)]), snapshot([row("mesma", 0)])).value, 0);
});

test("recusa saldos conflitantes e posições de datas diferentes", () => {
  assert.throws(() => consolidateCompanyCash(snapshot([row("mesma", 10)]), snapshot([row("mesma", 20)])), /saldos diferentes/);
  assert.throws(() => consolidateCompanyCash(snapshot([row("grupo", 10)]), snapshot([row("aluguel", 20)], "2026-09-29")), /mesma data/);
});

test("recusa composição duplicada, ausente ou divergente do total da fonte", () => {
  const rental = snapshot([row("aluguel", 20)]);
  assert.throws(() => consolidateCompanyCash(snapshot([row("grupo", 10), row("grupo", 10)]), rental), /composição.*inconsistente/);
  assert.throws(() => consolidateCompanyCash({ ...snapshot([row("grupo", 10)]), value: 999 }, rental), /composição.*inconsistente/);
  const missing = snapshot([row("grupo", 10)]);
  delete missing.selections.account_balances;
  assert.throws(() => consolidateCompanyCash(missing, rental), /composição.*inconsistente/);
});
