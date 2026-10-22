import { z } from "zod";

export const MANUAL_FINANCE_DISABLED =
  "O Financeiro da obra é somente leitura. Os valores vêm da sincronização Qlik; o histórico manual foi preservado como legado.";
export const constructionLinkSchema = z
  .object({
    action: z.literal("link"),
    id: z.uuid(),
    work_keys: z
      .array(
        z
          .string()
          .trim()
          .min(3)
          .max(500)
          .regex(/^[^|]+\|[^|]+$/, "Informe empresa|unidade."),
      )
      .max(50),
    expected_updated_at: z.iso.datetime({ offset: true }),
    confirmed: z.literal(true),
  })
  .strict()
  .refine((v) => new Set(v.work_keys).size === v.work_keys.length, {
    message: "Selecione cada unidade uma única vez.",
  });

export type ConstructionLink = {
  qlik_work_key: string | null;
  qlik_additional_work_keys?: string[];
};
export function constructionWorkKeys(work: ConstructionLink): string[] {
  // Existing single links remain valid without a backfill or automatic matching.
  return [
    ...new Set(
      [work.qlik_work_key, ...(work.qlik_additional_work_keys || [])].filter(
        (key): key is string => !!key,
      ),
    ),
  ];
}
export function inheritedLinkMatches(primary: string | null, keys: string[]) {
  return (keys[0] || null) === primary;
}
export type FinanceKind = "paid" | "payable";
export type FinanceSource = { at: string | null; status: string };
export type FinanceSources = Record<FinanceKind, FinanceSource>;
export type MonthlyCashEntry = {
  id: string;
  work_key: string | null;
  kind: string;
  cash_date: string | null;
  amount: number | string;
  active: boolean;
};
export type MonthlyExpense = {
  month: string | null;
  paid: number | null;
  payable: number | null;
  paidCount: number;
  payableCount: number;
};
export function monthlyConstructionExpenses(
  entries: MonthlyCashEntry[],
  workKeys: string[],
  sources: FinanceSources,
) {
  const keys = new Set(workKeys),
    seen = new Set<string>();
  const months = new Map<string, MonthlyExpense>();
  const covered: Record<FinanceKind, Set<string>> = {
    paid: new Set(),
    payable: new Set(),
  };
  for (const entry of entries) {
    if (
      !entry.active ||
      !entry.work_key ||
      !keys.has(entry.work_key) ||
      seen.has(entry.id)
    )
      continue;
    if (entry.kind !== "paid" && entry.kind !== "payable") continue;
    // Initial import rows may be active before the first publication completes.
    if (!sources[entry.kind].at) continue;
    const amount =
      typeof entry.amount === "number"
        ? entry.amount
        : entry.amount.trim()
          ? Number(entry.amount)
          : NaN;
    if (!Number.isFinite(amount))
      throw new Error("Valor Qlik inválido; totais indisponíveis.");
    seen.add(entry.id);
    covered[entry.kind].add(entry.work_key);
    const month =
      entry.cash_date && /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(entry.cash_date)
        ? entry.cash_date.slice(0, 7)
        : null;
    const key = month || "undated";
    const row = months.get(key) || {
      month,
      paid: null,
      payable: null,
      paidCount: 0,
      payableCount: 0,
    };
    row[entry.kind] = (row[entry.kind] ?? 0) + amount;
    row[entry.kind === "paid" ? "paidCount" : "payableCount"]++;
    months.set(key, row);
  }
  const rows = [...months.values()].sort((a, b) =>
    (b.month || "").localeCompare(a.month || ""),
  );
  const total = (kind: FinanceKind) => {
    const values = rows
      .map((r) => r[kind])
      .filter((v): v is number => v !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  return {
    rows,
    paid: total("paid"),
    payable: total("payable"),
    missingPaidKeys: workKeys.filter((key) => !covered.paid.has(key)),
    missingPayableKeys: workKeys.filter((key) => !covered.payable.has(key)),
  };
}
export type MonthlyFinance = ReturnType<typeof monthlyConstructionExpenses>;
export function monthlyExpensesCsv(
  name: string,
  units: string[],
  rows: MonthlyExpense[],
  sources: FinanceSources,
) {
  const cell = (value: string | number) => {
    const text = String(value);
    // Spreadsheet formula injection: labels and Qlik names are untrusted text.
    const safe = /^[\s]*[=+@-]/.test(text) ? "'" + text : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const money = (value: number | null) =>
    value === null
      ? "Sem registros (não confirma zero)"
      : value.toFixed(2).replace(".", ",");
  const data = [
    [
      "Obra",
      "Unidades (empresa / código / nome)",
      "Fonte",
      "Período",
      "Pagamentos realizados",
      "Contas a pagar",
      "Publicação pagamentos (UTC)",
      "Publicação a pagar (UTC)",
      "Situação pagamentos",
      "Situação a pagar",
    ],
    ...rows.map((r) => [
      name,
      units.join(" | "),
      "Qlik / qlik-operations",
      r.month || "Sem data na origem",
      money(r.paid),
      money(r.payable),
      sources.paid.at || "Carga pendente",
      sources.payable.at || "Carga pendente",
      sources.paid.status,
      sources.payable.status,
    ]),
  ];
  return "\uFEFF" + data.map((row) => row.map(cell).join(";")).join("\r\n");
}

export type QlikCodeWork = {
  key: string;
  work_id: string;
  company_id: string;
  name: string;
  active: boolean;
};
export function resolveQlikCodes(input: string, works: QlikCodeWork[]) {
  const codes = input
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const keys: string[] = [],
    errors: string[] = [];
  for (const code of codes) {
    const matches = works.filter(
      (w) =>
        w.active && (code.includes("|") ? w.key === code : w.work_id === code),
    );
    if (matches.length !== 1) {
      errors.push(
        matches.length
          ? `Código ${code} existe em mais de uma empresa. Informe empresa|unidade.`
          : `Código ${code} não encontrado entre as unidades ativas. Informe empresa|unidade, preservando zeros à esquerda.`,
      );
    } else if (keys.includes(matches[0].key)) {
      errors.push(`Unidade ${matches[0].key} repetida.`);
    } else keys.push(matches[0].key);
  }
  if (codes.length > 50) errors.push("Selecione no máximo 50 unidades.");
  return { keys, errors };
}
