export type QlikCompany = {
  id: string;
  name: string;
  company_key: string;
  synchronized_at: string;
};
export type QlikWork = {
  key: string;
  company_id: string;
  work_id: string;
  name: string;
  active: boolean;
};
export type CashEntry = {
  id: string;
  company_id: string;
  work_key: string | null;
  contract_id: string | null;
  kind: "receivable" | "received" | "payable" | "paid";
  title_key: string | null;
  cash_date: string | null;
  original_due_date: string | null;
  amount: number;
  description: string;
  counterparty: string | null;
  stage_name: string | null;
  source_category?: string | null;
  synchronized_at: string;
};
export type ForecastMovement = {
  id: string;
  company_id: string;
  date: string | null;
  amount: number;
  direction: "in" | "out";
  source: "qlik" | "payment" | "commitment";
  description: string;
  work_key: string | null;
  pending?: boolean;
  href?: string;
};
export type ForecastWeek = {
  index: number;
  start: string;
  end: string;
  incoming: number;
  outgoing: number;
  net: number;
  pending: number;
  closing: number | null;
  closingWithPending: number | null;
  movements: ForecastMovement[];
};
export function localToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function addDays(date: string, days: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const cents = (value: number) => Math.round(Number(value) * 100);
export function forecast13Weeks(
  asOf: string,
  movements: ForecastMovement[],
  opening: number | null,
) {
  let balance = opening === null ? null : cents(opening);
  const weeks: ForecastWeek[] = Array.from({ length: 13 }, (_, index) => ({
    index,
    start: addDays(asOf, index * 7),
    end: addDays(asOf, index * 7 + 6),
    incoming: 0,
    outgoing: 0,
    net: 0,
    pending: 0,
    closing: null,
    closingWithPending: null,
    movements: [],
  }));
  const overdue: ForecastMovement[] = [],
    undated: ForecastMovement[] = [];
  for (const m of movements) {
    if (!m.date) {
      undated.push(m);
      continue;
    }
    if (m.date < asOf) {
      overdue.push(m);
      continue;
    }
    const week = weeks.find((w) => m.date! >= w.start && m.date! <= w.end);
    if (!week) continue;
    week.movements.push(m);
    if (m.pending) week.pending += cents(m.amount);
    else if (m.direction === "in") week.incoming += cents(m.amount);
    else week.outgoing += cents(m.amount);
  }
  let cumulativePending = 0;
  for (const w of weeks) {
    w.net = w.incoming - w.outgoing;
    if (balance !== null) balance += w.net;
    w.closing = balance === null ? null : balance / 100;
    cumulativePending += w.pending;
    w.closingWithPending =
      balance === null ? null : (balance - cumulativePending) / 100;
    w.incoming /= 100;
    w.outgoing /= 100;
    w.net /= 100;
    w.pending /= 100;
  }
  return {
    weeks,
    overdue,
    undated,
    firstShortfall:
      weeks.find((w) => w.closing !== null && w.closing < 0) || null,
  };
}
export type CollectionGroup =
  "easy" | "negotiation" | "difficult" | "review" | "judicial" | "current";
export const COLLECTION_GROUPS: Record<CollectionGroup, string> = {
  easy: "Parcelas esquecidas",
  negotiation: "Negociação",
  difficult: "Recuperação difícil",
  review: "Sem classificação",
  judicial: "Fora da cobrança extrajudicial",
  current: "Sem atraso",
};
export type CollectionCase = {
  contract_id: string;
  responsible_user_id: string | null;
  legal_status: "unknown" | "extrajudicial" | "judicial" | "suspended";
  next_action: string;
  next_action_date: string | null;
  last_contact_at: string | null;
  promise_date: string | null;
  promise_amount: number | null;
  promise_status: "none" | "open" | "fulfilled" | "broken" | "cancelled";
  receipt_entry_id: string | null;
  notes: string;
  version: number;
};
export function classifyCollection(
  entries: CashEntry[],
  record: CollectionCase | null,
  asOf: string,
) {
  const overdue = entries.filter(
    (e) =>
      e.kind === "receivable" &&
      e.cash_date &&
      e.cash_date < asOf &&
      Number(e.amount) > 0,
  );
  const paid = entries.filter(
    (e) => e.kind === "received" && Number(e.amount) > 0,
  );
  const amount = overdue.reduce((s, e) => s + cents(e.amount), 0) / 100;
  const oldest =
    overdue.map((e) => e.original_due_date || e.cash_date!).sort()[0] || null;
  const days = oldest
    ? Math.floor(
        (Date.parse(asOf + "T12:00:00Z") - Date.parse(oldest + "T12:00:00Z")) /
          86400000,
      )
    : 0;
  let group: CollectionGroup = "current",
    reason = "Nenhum título vencido na última carga.";
  if (overdue.length) {
    if (
      record?.legal_status === "judicial" ||
      record?.legal_status === "suspended"
    ) {
      group = "judicial";
      reason = "Acompanhamento reservado à tratativa jurídica ou suspensa.";
    } else if (
      overdue.length <= 2 &&
      paid.some(
        (p) =>
          p.cash_date &&
          p.cash_date >
            overdue
              .map((e) => e.cash_date!)
              .sort()
              .at(-1)!,
      ) &&
      record?.promise_status !== "broken" &&
      !(
        record?.promise_status === "open" &&
        record.promise_date &&
        record.promise_date < asOf
      )
    ) {
      group = "easy";
      reason = "Até duas parcelas vencidas, com recebimentos posteriores.";
    } else if (
      days <= 90 &&
      paid.length &&
      record?.promise_status !== "broken" &&
      !(
        record?.promise_status === "open" &&
        record.promise_date &&
        record.promise_date < asOf
      )
    ) {
      group = "negotiation";
      reason = "Atraso de até 90 dias e histórico de recebimentos.";
    } else {
      group = "difficult";
      reason =
        record?.promise_status === "broken"
          ? "Há promessa descumprida."
          : "Atraso persistente ou continuidade de pagamento não demonstrada.";
    }
  }
  return {
    group,
    reason,
    amount,
    count: overdue.length,
    oldest,
    days,
    lastReceipt:
      paid
        .map((e) => e.cash_date)
        .filter((d): d is string => !!d)
        .sort()
        .at(-1) || null,
    promiseOverdue:
      record?.promise_status === "open" &&
      !!record.promise_date &&
      record.promise_date < asOf,
  };
}
export function buildForecastMovements(
  entries: CashEntry[],
  payments: Array<{
    id: string;
    company_key: string;
    qlik_work_key: string | null;
    amount: number | null;
    due_date: string;
    scheduled_date: string | null;
    title: string;
    status: string;
  }>,
  companies: QlikCompany[],
  reconciliations: Array<{ request_id: string; state: string }>,
  commitments: Array<{
    id: string;
    company_id: string;
    work_key: string | null;
    amount: number;
    due_date: string;
    description: string;
    status: string;
    payment_request_id: string | null;
    cash_entry_id: string | null;
  }>,
) {
  const moves: ForecastMovement[] = entries
    .filter((e) => e.kind === "receivable" || e.kind === "payable")
    .map((e) => ({
      id: e.id,
      company_id: e.company_id,
      date: e.cash_date,
      amount: Number(e.amount),
      direction: e.kind === "receivable" ? "in" : "out",
      source: "qlik",
      description: e.description || e.counterparty || e.title_key || e.id,
      work_key: e.work_key,
    }));
  const unmatchedPayments: string[] = [];
  for (const p of payments) {
    if (!["approved", "scheduled"].includes(p.status)) continue;
    const company = companies.find((c) => c.company_key === p.company_key);
    if (!company) {
      unmatchedPayments.push(p.id);
      continue;
    }
    const r = reconciliations.find((r) => r.request_id === p.id);
    if (r?.state === "linked") continue;
    if (p.amount === null) {
      unmatchedPayments.push(p.id);
      continue;
    }
    moves.push({
      id: p.id,
      company_id: company.id,
      date: p.scheduled_date || p.due_date,
      amount: Number(p.amount),
      direction: "out",
      source: "payment",
      description: p.title,
      work_key: p.qlik_work_key,
      pending: !r,
      href: `/pagamentos/${p.id}`,
    });
  }
  for (const c of commitments) {
    if (
      c.status !== "committed" ||
      c.cash_entry_id ||
      (c.payment_request_id &&
        payments.some(
          (p) =>
            p.id === c.payment_request_id &&
            ["approved", "scheduled"].includes(p.status),
        ))
    )
      continue;
    moves.push({
      id: c.id,
      company_id: c.company_id,
      date: c.due_date,
      amount: Number(c.amount),
      direction: "out",
      source: "commitment",
      description: c.description,
      work_key: c.work_key,
    });
  }
  return { moves, unmatchedPayments };
}

export type BudgetCommitment = {
  id: string;
  amount: number;
  status: string;
  payment_request_id: string | null;
  cash_entry_id: string | null;
};
export function constructionBudget(
  entries: CashEntry[],
  commitments: BudgetCommitment[],
  reconciliations: Array<{
    request_id: string;
    state: string;
    cash_entry_id: string | null;
  }>,
  remaining: number | null,
) {
  const activeIds = new Set(entries.map((e) => e.id));
  const independent = commitments.filter(
    (c) =>
      c.status !== "cancelled" &&
      !activeIds.has(c.cash_entry_id || "") &&
      !reconciliations.some(
        (r) =>
          r.request_id === c.payment_request_id &&
          r.state === "linked" &&
          activeIds.has(r.cash_entry_id || ""),
      ),
  );
  const paid =
    entries
      .filter((e) => e.kind === "paid")
      .reduce((s, e) => s + Number(e.amount), 0) +
    independent
      .filter((c) => c.status === "paid")
      .reduce((s, c) => s + Number(c.amount), 0);
  const committed =
    entries
      .filter((e) => e.kind === "payable")
      .reduce((s, e) => s + Number(e.amount), 0) +
    independent
      .filter((c) => c.status === "committed")
      .reduce((s, c) => s + Number(c.amount), 0);
  return {
    paid,
    committed,
    independent,
    total: remaining === null ? null : paid + committed + remaining,
  };
}
