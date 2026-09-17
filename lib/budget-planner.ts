export type AccountGroup =
  "income" | "expense" | "investment" | "cash_in" | "cash_out";
export type BudgetAccount = { id: string; name: string; group: AccountGroup };
export type BusinessCurve = { month: number; vgv: number; investment: number };
export type BudgetBusiness = {
  id: string;
  name: string;
  potential_vgv: number;
  qlik_work_key: string | null;
  curve: BusinessCurve[];
  version: number;
};
export type BudgetWork = {
  business_id: string;
  business_name: string;
  linked: boolean;
  start: string;
  end: string;
  enabled: boolean;
  incremental: boolean;
  curve: BusinessCurve[];
};
export type BudgetLine = {
  id: string;
  account_id: string;
  month: string;
  cash_month: string;
  amount: number;
  justification: string;
};
export type BudgetAdjustment = {
  id: string;
  account_id: string;
  month: string;
  amount: number;
  justification: string;
};
export type BudgetPlan = {
  annual_rates: { income: number; expense: number; investment: number };
  id?: string;
  company_id: string | null;
  version: number;
  name: string;
  start_year: number;
  closed_through: string;
  opening_cash: number | null;
  accounts: BudgetAccount[];
  works: BudgetWork[];
  lines: BudgetLine[];
  adjustments: BudgetAdjustment[];
  mappings: Record<string, string>;
  reconciled_months: string[];
  baseline_receipts: SourceMonth[];
};
export type SourceMonth = {
  month: string;
  company_id: string;
  work_key: string | null;
  kind: "received" | "paid" | "receivable" | "payable";
  category: string;
  amount: number;
  count: number;
};
export type SourceCoverage = {
  kind: string;
  company_id: string;
  count: number;
  updated_at: string | null;
  undated: number;
};
export type BudgetSources = {
  rows: SourceMonth[];
  coverage: SourceCoverage[];
  overdue_receivables: number;
  companies: { id: string; name: string }[];
};
export type BudgetColumn = {
  month: string;
  income: number;
  expense: number;
  investment: number;
  result: number;
  bridge: number;
  cashResult: number;
  transfers: number;
  opening: number | null;
  closing: number | null;
  accounts: Record<string, number>;
  active: boolean;
  complete: boolean;
  reconciled: boolean;
  actual: boolean;
};
export const DEFAULT_ACCOUNTS: BudgetAccount[] = [
  { id: "current_vgv", name: "VGV da carteira atual", group: "income" },
  { id: "new_vgv", name: "VGV de novos negócios", group: "income" },
  { id: "other_income", name: "Outras entradas", group: "income" },
  { id: "administrative", name: "Administrativas e pessoal", group: "expense" },
  { id: "commercial", name: "Comerciais", group: "expense" },
  { id: "taxes", name: "Tributos", group: "expense" },
  { id: "unclassified", name: "Saídas a classificar", group: "expense" },
  {
    id: "transfer_in",
    name: "Transferências e aportes recebidos",
    group: "cash_in",
  },
  {
    id: "transfer_out",
    name: "Transferências e distribuições pagas",
    group: "cash_out",
  },
  { id: "works", name: "Investimentos em obras", group: "investment" },
];
export const money = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;
export function monthNumber(month: string) {
  const [y, m] = month.split("-").map(Number);
  return y * 12 + m - 1;
}
export function addMonths(month: string, amount: number) {
  const n = monthNumber(month) + amount;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
}
export function planMonths(year: number) {
  return Array.from({ length: 60 }, (_, i) => addMonths(`${year}-01`, i));
}
export function newBudgetPlan(year: number, currentMonth: string): BudgetPlan {
  return {
    annual_rates: { income: 0, expense: 0, investment: 0 },
    company_id: null,
    version: 0,
    name: `Orçamento ${year}–${year + 4}`,
    start_year: year,
    closed_through: addMonths(currentMonth, -1),
    opening_cash: null,
    accounts: DEFAULT_ACCOUNTS.map((a) => ({ ...a })),
    works: [],
    lines: [],
    adjustments: [],
    mappings: {},
    reconciled_months: [],
    baseline_receipts: [],
  };
}
export function sourceKey(
  row: Pick<SourceMonth, "kind" | "category" | "company_id" | "work_key">,
) {
  return `${row.kind === "received" || row.kind === "receivable" ? "income" : "expense"}:${row.company_id}:${row.work_key || "*"}:${row.category}`;
}

/** Stretch/compress the original investment curve, preserving its total to the cent. */
export function placeBusiness(work: BudgetWork, curve: BusinessCurve[]) {
  const duration = monthNumber(work.end) - monthNumber(work.start) + 1;
  if (duration < 1 || duration > 120)
    throw new Error("A obra deve durar entre 1 e 120 meses.");
  const original = Math.max(
    1,
    ...curve.filter((r) => r.investment > 0).map((r) => r.month),
  );
  const investment = Array.from({ length: duration }, () => 0);
  for (const row of curve) {
    if (!row.investment) continue;
    const left = ((row.month - 1) * duration) / original;
    const right = (row.month * duration) / original;
    for (let i = Math.floor(left); i < Math.ceil(right); i++) {
      if (i < duration)
        investment[i] +=
          (row.investment *
            Math.max(0, Math.min(right, i + 1) - Math.max(left, i))) /
          (right - left);
    }
  }
  // Round cumulative values, so splitting a cent never changes the total.
  let cumulative = 0,
    previous = 0;
  return {
    investment: investment.map((amount, i) => {
      cumulative += amount;
      const rounded = money(cumulative);
      const value = money(rounded - previous);
      previous = rounded;
      return { month: addMonths(work.start, i), amount: value };
    }),
    receipts: curve
      .filter((r) => r.vgv > 0)
      .map((r) => ({ month: addMonths(work.end, r.month), amount: r.vgv })),
  };
}

export function calculateBudget(
  plan: BudgetPlan,
  businesses: BudgetBusiness[],
  source: BudgetSources,
  mode: "budget" | "actual" | "forecast",
): BudgetColumn[] {
  const months = planMonths(plan.start_year);
  const accounts = new Map(plan.accounts.map((a) => [a.id, a]));
  const planned = new Map(
    months.map((m) => [
      m,
      {
        accrual: {} as Record<string, number>,
        cash: {} as Record<string, number>,
      },
    ]),
  );
  const realized = new Map(
    months.map((m) => [m, {} as Record<string, number>]),
  );
  const put = (
    values: Record<string, number> | undefined,
    id: string,
    amount: number,
  ) => {
    if (values && accounts.has(id))
      values[id] = money((values[id] || 0) + amount);
  };
  // Contractual receivables are the existing portfolio, never an annual total divided by 12.
  for (const row of [
    ...source.rows.filter((r) => r.kind === "received" || r.kind === "paid"),
    ...plan.baseline_receipts,
  ]) {
    if (plan.company_id && row.company_id !== plan.company_id) continue;
    const id =
      plan.mappings[sourceKey(row)] ||
      (row.kind === "received" || row.kind === "receivable"
        ? "current_vgv"
        : "unclassified");
    if (row.kind === "receivable") {
      put(planned.get(row.month)?.accrual, id, row.amount);
      put(planned.get(row.month)?.cash, id, row.amount);
    } else if (row.kind === "received" || row.kind === "paid")
      put(realized.get(row.month), id, row.amount);
  }
  const adjusted = (amount: number, month: string, group: AccountGroup) =>
    money(
      amount *
        Math.pow(
          1 +
            (group === "income" || group === "expense" || group === "investment"
              ? plan.annual_rates[group]
              : 0) /
              100,
          Math.max(0, Number(month.slice(0, 4)) - plan.start_year),
        ),
    );
  for (const line of plan.lines) {
    const amount = adjusted(
      line.amount,
      line.month,
      accounts.get(line.account_id)!.group,
    );
    put(planned.get(line.month)?.accrual, line.account_id, amount);
    put(planned.get(line.cash_month)?.cash, line.account_id, amount);
  }
  for (const work of plan.works.filter((w) => w.enabled)) {
    const business = businesses.find((b) => b.id === work.business_id);
    if ((business?.qlik_work_key || work.linked) && !work.incremental) continue;
    const placed = placeBusiness(work, work.curve);
    for (const [id, rows] of [
      ["new_vgv", placed.receipts],
      ["works", placed.investment],
    ] as const)
      for (const row of rows) {
        const amount = adjusted(
          row.amount,
          row.month,
          id === "new_vgv" ? "income" : "investment",
        );
        put(planned.get(row.month)?.accrual, id, amount);
        put(planned.get(row.month)?.cash, id, amount);
      }
  }
  let balance = plan.opening_cash;
  const hasActuals = ["received", "paid"].every((kind) =>
    source.coverage.some(
      (c) =>
        c.kind === kind &&
        c.count > 0 &&
        (!plan.company_id || c.company_id === plan.company_id),
    ),
  );
  return months.map((month) => {
    const actual =
      mode === "actual" ||
      (mode === "forecast" && month <= plan.closed_through);
    if (actual && month > plan.closed_through)
      return {
        month,
        active: false,
        income: 0,
        expense: 0,
        investment: 0,
        result: 0,
        bridge: 0,
        transfers: 0,
        cashResult: 0,
        opening: null,
        closing: null,
        accounts: {},
        complete: false,
        reconciled: false,
        actual: true,
      };
    const cash = actual
      ? { ...realized.get(month) }
      : { ...planned.get(month)!.cash };
    const accrual = actual ? { ...cash } : { ...planned.get(month)!.accrual };
    if (actual)
      for (const a of plan.adjustments.filter((a) => a.month === month))
        put(accrual, a.account_id, a.amount);
    const sum = (values: Record<string, number>, group: AccountGroup) =>
      money(
        Object.entries(values).reduce(
          (n, [id, value]) =>
            n + (accounts.get(id)?.group === group ? value : 0),
          0,
        ),
      );
    const income = sum(accrual, "income"),
      expense = sum(accrual, "expense"),
      result = money(income - expense);
    const cashOperating = money(sum(cash, "income") - sum(cash, "expense")),
      investment = sum(cash, "investment");
    const transfers = money(sum(cash, "cash_in") - sum(cash, "cash_out"));
    const cashResult = money(cashOperating - investment + transfers);
    const complete = !actual || (hasActuals && month <= plan.closed_through);
    const opening = balance;
    balance = complete && balance !== null ? money(balance + cashResult) : null;
    return {
      month,
      active: true,
      income,
      expense,
      result,
      investment,
      cashResult,
      transfers,
      bridge: money(cashOperating - result),
      opening,
      closing: balance,
      accounts: accrual,
      complete,
      reconciled: !actual || plan.reconciled_months.includes(month),
      actual,
    };
  });
}

export function annualColumns(columns: BudgetColumn[]) {
  return Array.from(new Set(columns.map((c) => c.month.slice(0, 4)))).map(
    (year) => {
      const rows = columns.filter((c) => c.month.startsWith(year) && c.active);
      const total = (
        key:
          | "income"
          | "expense"
          | "result"
          | "investment"
          | "cashResult"
          | "bridge"
          | "transfers",
      ) => money(rows.reduce((sum, row) => sum + row[key], 0));
      const accounts: Record<string, number> = {};
      for (const row of rows)
        for (const [id, value] of Object.entries(row.accounts))
          accounts[id] = money((accounts[id] || 0) + value);
      return {
        month: year,
        income: total("income"),
        expense: total("expense"),
        result: total("result"),
        investment: total("investment"),
        cashResult: total("cashResult"),
        transfers: total("transfers"),
        bridge: total("bridge"),
        accounts,
        active: rows.length > 0,
        opening: rows[0]?.opening ?? null,
        closing: rows.at(-1)?.closing ?? null,
        complete: rows.length > 0 && rows.every((r) => r.complete),
        reconciled: rows.every((r) => r.reconciled),
        actual: rows.some((r) => r.actual),
      };
    },
  );
}

export function parseBusinessCurve(text: string): BusinessCurve[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/)
    .filter((s) => s.trim());
  if (!lines.length) throw new Error("Preencha a curva mensal.");
  const delimiter = lines[0].includes(";")
    ? ";"
    : lines[0].includes("\t")
      ? "\t"
      : ",";
  const start = /^m[eê]s/i.test(lines[0].trim()) ? 1 : 0;
  const seen = new Set<number>();
  const number = (v: string) => {
    v = v.trim().replace(/^"|"$/g, "");
    if (
      !v ||
      !/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$|^\d+\.\d{1,2}$/.test(v)
    )
      throw new Error("Use valores numéricos positivos, sem R$.");
    return Number(
      v.includes(",")
        ? v.replaceAll(".", "").replace(",", ".")
        : /^\d{1,3}(?:\.\d{3})+$/.test(v)
          ? v.replaceAll(".", "")
          : v,
    );
  };
  const result = lines.slice(start).map((line, index) => {
    const parts = line.split(delimiter);
    if (parts.length !== 3)
      throw new Error(
        `Linha ${index + start + 1}: informe mês, VGV e investimento.`,
      );
    const month = Number(parts[0]);
    if (!Number.isInteger(month) || month < 1 || month > 120 || seen.has(month))
      throw new Error(
        `Linha ${index + start + 1}: mês inválido ou repetido (1 a 120).`,
      );
    seen.add(month);
    return {
      month,
      vgv: money(number(parts[1])),
      investment: money(number(parts[2])),
    };
  });
  if (!result.length) throw new Error("Inclua pelo menos um mês.");
  return result.sort((a, b) => a.month - b.month);
}
