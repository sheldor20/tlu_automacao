import test from "node:test";
import assert from "node:assert/strict";
import {
  clientFinancialStatus,
  CLIENT_FINANCIAL_LABELS,
  CLIENT_FINANCIAL_DESCRIPTIONS,
  type ClientFinancialStatus,
} from "../lib/client-workspace.ts";
const rows = (...statuses: ClientFinancialStatus[]) => statuses.map((financial_status) => ({ financial_status }));
const scenarios: [string, ClientFinancialStatus[], ClientFinancialStatus][] = [
  ["cadastro sem contrato", [], "no_contract"],
  ["somente cancelados confirmados", ["cancelled", "cancelled"], "cancelled"],
  ["sem saldo não é quitado", ["no_balance"], "no_balance"],
  ["contrato quitado mais contrato sem evidência", ["paid", "no_balance"], "no_balance"],
  ["contrato em dia não é ocultado por histórico sem saldo", ["current", "no_balance"], "current"],
  ["atraso prevalece sobre saldo zero", ["no_balance", "overdue"], "overdue"],
  ["atraso prevalece sobre revisão", ["review", "overdue"], "overdue"],
  ["atraso prevalece sobre cancelado com saldo", ["cancelled_balance", "overdue"], "overdue"],
  ["cancelado com saldo não desaparece", ["paid", "cancelled_balance"], "cancelled_balance"],
  ["parcela sem vencimento exige revisão", ["review", "current"], "review"],
  ["falha de dados não vira adimplência", ["unknown", "current"], "unknown"],
  ["falha de dados não vira quitação", ["unknown", "paid"], "unknown"],
  ["todos os ativos quitados", ["paid", "paid", "cancelled"], "paid"],
  ["cancelados não contaminam adimplência", ["current", "cancelled"], "current"],
];
for (const [name, input, expected] of scenarios) {
  test(name, () => {
    assert.equal(clientFinancialStatus(rows(...input)), expected);
    assert.equal(clientFinancialStatus(rows(...input.toReversed())), expected);
  });
}
test("não oculta atraso em venda cancelada", () => {
  assert.equal(clientFinancialStatus([{ sale_status: "Cancelado", financial_status: "overdue" }]), "overdue");
});
test("sem publicação financeira não assume saldo zero para cancelados", () => {
  assert.equal(clientFinancialStatus([{ sale_status: "Cancelado", financial_status: "unknown" }]), "unknown");
});
test("status ausente ou inválido nunca vira quitado", () => {
  assert.equal(clientFinancialStatus([{}]), "unknown");
  assert.equal(clientFinancialStatus([{ financial_status: "new_source_value" as ClientFinancialStatus }]), "unknown");
});
test("todos os estados têm rótulo e explicação", () => {
  for (const status of Object.keys(CLIENT_FINANCIAL_LABELS) as ClientFinancialStatus[]) {
    assert.ok(CLIENT_FINANCIAL_LABELS[status].trim());
    assert.ok(CLIENT_FINANCIAL_DESCRIPTIONS[status].trim());
    assert.notEqual(CLIENT_FINANCIAL_LABELS[status], "A confirmar");
  }
});
