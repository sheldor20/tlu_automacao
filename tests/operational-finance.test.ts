import test from "node:test";
import assert from "node:assert/strict";
import {
  constructionBudget,
  forecast13Weeks,
  buildForecastMovements,
  classifyCollection,
  type ForecastMovement,
  type CashEntry,
  type CollectionCase,
} from "../lib/operational-finance.ts";
const move = (
  id: string,
  date: string | null,
  amount: number,
  direction: "in" | "out" = "in",
  pending = false,
): ForecastMovement => ({
  id,
  date,
  amount,
  direction,
  pending,
  company_id: "1",
  source: "qlik",
  description: id,
  work_key: null,
});
test("projeção usa 13 semanas de sete dias, centavos e saldo acumulado; vencidos não viram caixa hoje", () => {
  const p = forecast13Weeks(
    "2026-12-28",
    [
      move("in", "2026-12-28", 0.1),
      move("in2", "2027-01-03", 0.2),
      move("out", "2027-01-04", 100, "out"),
      move("pending", "2026-12-30", 1000, "out", true),
      move("late", "2026-12-27", 200),
      move("missing", null, 300),
      move("outside", "2027-03-29", 99999),
    ],
    10,
  );
  assert.equal(p.weeks.length, 13);
  assert.equal(p.weeks[0].incoming, 0.3);
  assert.equal(p.weeks[0].closing, 10.3);
  assert.equal(p.weeks[1].closing, -89.7);
  assert.equal(p.firstShortfall?.index, 1);
  assert.equal(p.weeks[0].pending, 1000);
  assert.equal(p.overdue.length, 1);
  assert.equal(p.undated.length, 1);
  assert.equal(p.weeks[12].end, "2027-03-28");
});
test("sem saldo inicial não conclui falta ou sobra de caixa", () => {
  const p = forecast13Weeks(
    "2026-09-17",
    [move("a", "2026-09-18", 100, "out")],
    null,
  );
  assert.equal(p.weeks[0].net, -100);
  assert.equal(p.weeks[0].closing, null);
  assert.equal(p.firstShortfall, null);
});
const entry = (
  id: string,
  kind: CashEntry["kind"],
  date: string,
  amount = 100,
): CashEntry => ({
  id,
  kind,
  cash_date: date,
  amount,
  company_id: "1",
  work_key: "w1",
  contract_id: "c1",
  title_key: id,
  original_due_date: date,
  description: id,
  counterparty: null,
  stage_name: null,
  synchronized_at: "2026-09-17",
});
const record: CollectionCase = {
  contract_id: "c1",
  responsible_user_id: null,
  legal_status: "extrajudicial",
  next_action: "",
  next_action_date: null,
  last_contact_at: null,
  promise_date: null,
  promise_amount: null,
  promise_status: "none",
  receipt_entry_id: null,
  notes: "",
  version: 1,
};
test("parcelas esquecidas usa pagamentos posteriores e respeita situação jurídica registrada", () => {
  const rows = [
    entry("late", "receivable", "2026-07-01"),
    entry("payment", "received", "2026-08-01"),
  ];
  assert.equal(classifyCollection(rows, record, "2026-09-17").group, "easy");
  assert.equal(classifyCollection(rows, null, "2026-09-17").group, "easy");
  assert.equal(
    classifyCollection(
      rows,
      { ...record, legal_status: "judicial" },
      "2026-09-17",
    ).group,
    "judicial",
  );
  assert.equal(
    classifyCollection(rows.slice(0, 1), record, "2026-09-17").group,
    "difficult",
  );
  assert.equal(
    classifyCollection(
      rows,
      { ...record, promise_status: "broken" },
      "2026-09-17",
    ).group,
    "difficult",
  );
});
test("conciliação exclui vínculos já registrados, preserva pendentes e compromissos adicionais", () => {
  const p = {
    id: "p",
    company_key: "Empresa",
    qlik_work_key: "w1",
    amount: 100,
    due_date: "2026-09-18",
    scheduled_date: null,
    title: "Compra",
    status: "approved",
  };
  const c = {
    id: "1",
    company_key: "Empresa",
    name: "Empresa",
    synchronized_at: "",
  };
  const commitment = {
    id: "k",
    company_id: "1",
    work_key: "w1",
    amount: 200,
    due_date: "2026-09-19",
    description: "Contrato",
    status: "committed",
    payment_request_id: null,
    cash_entry_id: null,
  };
  const rows = [entry("bill", "payable", "2026-09-18")];
  const pending = buildForecastMovements(rows, [p], [c], [], [commitment]);
  assert.equal(pending.moves.length, 3);
  assert.equal(pending.moves.find((m) => m.id === "p")?.pending, true);
  const linked = buildForecastMovements(
    rows,
    [p],
    [c],
    [{ request_id: "p", state: "linked" }],
    [{ ...commitment, payment_request_id: "p" }],
  );
  assert.equal(linked.moves.length, 1);
  const additional = buildForecastMovements(
    rows,
    [p],
    [c],
    [{ request_id: "p", state: "additional" }],
    [],
  );
  assert.equal(additional.moves.find((m) => m.id === "p")?.pending, false);
});

test("promessa vencida não permanece em recuperação fácil", () => {
  const base = {
    ...record,
    promise_status: "open" as const,
    promise_date: "2026-09-01",
    promise_amount: 100,
  };
  const got = classifyCollection(
    [
      entry("late", "receivable", "2026-08-01", 100),
      entry("paid", "received", "2026-09-01", 100),
    ],
    base,
    "2026-09-17",
  );
  assert.equal(got.group, "difficult");
  assert.equal(got.promiseOverdue, true);
});

test("custo final considera pagamentos informados e não repete compromisso conciliado", () => {
  const paid = entry("paid", "paid", "2026-09-01", 200),
    payable = entry("bill", "payable", "2026-10-01", 300);
  const commitments = [
    {
      id: "same",
      amount: 300,
      status: "committed",
      payment_request_id: "r",
      cash_entry_id: null,
    },
    {
      id: "extra",
      amount: 100,
      status: "committed",
      payment_request_id: null,
      cash_entry_id: null,
    },
    {
      id: "manual",
      amount: 50,
      status: "paid",
      payment_request_id: null,
      cash_entry_id: null,
    },
  ];
  const result = constructionBudget(
    [paid, payable],
    commitments,
    [{ request_id: "r", state: "linked", cash_entry_id: "bill" }],
    400,
  );
  assert.equal(result.paid, 250);
  assert.equal(result.committed, 400);
  assert.equal(result.total, 1050);
  assert.equal(result.independent.length, 2);
});
