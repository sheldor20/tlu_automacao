import { z } from "zod";
import { DEFAULT_ACCOUNTS } from "./budget-planner.ts";
const month = z
  .string()
  .regex(/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/, "Mês inválido.");
const amount = z.number().finite().min(0).max(1e12);
const signed = z.number().finite().min(-1e12).max(1e12);
const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const curveSchema = z
  .array(
    z.object({
      month: z.number().int().min(1).max(120),
      vgv: amount,
      investment: amount,
    }),
  )
  .min(1)
  .max(120)
  .refine(
    (rows) => new Set(rows.map((r) => r.month)).size === rows.length,
    "Os meses não podem se repetir.",
  );
export const businessCurveSchema = z.object({
  business_id: z.uuid(),
  version: z.number().int().min(0),
  curve: curveSchema,
});
export const budgetSchema = z
  .object({
    annual_rates: z.object({
      income: z.number().min(-50).max(100),
      expense: z.number().min(-50).max(100),
      investment: z.number().min(-50).max(100),
    }),
    id: z.uuid().optional(),
    company_id: z.string().min(1).max(100).nullable(),
    version: z.number().int().min(0),
    name: z.string().trim().min(1).max(120),
    start_year: z.number().int().min(2020).max(2095),
    closed_through: month,
    opening_cash: signed.nullable(),
    accounts: z
      .array(
        z.object({
          id,
          name: z.string().trim().min(1).max(100),
          group: z.enum([
            "income",
            "expense",
            "investment",
            "cash_in",
            "cash_out",
          ]),
        }),
      )
      .min(8)
      .max(80),
    works: z
      .array(
        z.object({
          business_id: z.uuid(),
          business_name: z.string().max(200),
          linked: z.boolean(),
          start: month,
          end: month,
          enabled: z.boolean(),
          incremental: z.boolean(),
          curve: curveSchema,
        }),
      )
      .max(300),
    lines: z
      .array(
        z.object({
          id,
          account_id: id,
          month,
          cash_month: month,
          amount,
          justification: z
            .string()
            .trim()
            .min(3, "Justifique cada despesa do orçamento base zero.")
            .max(1000),
        }),
      )
      .max(6000),
    adjustments: z
      .array(
        z.object({
          id,
          account_id: id,
          month,
          amount: signed,
          justification: z.string().trim().min(3).max(1000),
        }),
      )
      .max(3000),
    mappings: z.record(z.string().max(600), id),
    reconciled_months: z.array(month).max(60),
    baseline_receipts: z
      .array(
        z.object({
          month,
          company_id: z.string().min(1).max(100),
          work_key: z.string().max(200).nullable(),
          kind: z.literal("receivable"),
          category: z.string().max(250),
          amount: signed,
          count: z.number().int().min(0),
        }),
      )
      .max(5000),
  })
  .superRefine((p, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const now = new Date().toISOString().slice(0, 7);
    if (p.closed_through >= now)
      fail("O realizado deve terminar em um mês já encerrado.");
    const accounts = new Map(p.accounts.map((a) => [a.id, a]));
    if (accounts.size !== p.accounts.length)
      fail("Planos de contas repetidos.");
    for (const a of DEFAULT_ACCOUNTS)
      if (accounts.get(a.id)?.group !== a.group)
        fail("Preserve os grupos dos planos de contas padrão.");
    for (const rows of [p.lines, p.adjustments])
      if (new Set(rows.map((r) => r.id)).size !== rows.length)
        fail("Lançamentos repetidos.");
    if (new Set(p.works.map((w) => w.business_id)).size !== p.works.length)
      fail("Uma obra não pode aparecer duas vezes no cenário.");
    const start = `${p.start_year}-01`,
      end = `${p.start_year + 4}-12`;
    for (const row of [...p.lines, ...p.adjustments]) {
      if (!accounts.has(row.account_id))
        fail("Plano de contas não encontrado.");
      if (row.month < start || row.month > end)
        fail("A competência deve estar nos cinco anos do cenário.");
    }
    for (const row of p.lines)
      if (row.cash_month < start || row.cash_month > end)
        fail("O mês de caixa deve estar nos cinco anos do cenário.");
    for (const row of p.adjustments)
      if (
        !["income", "expense"].includes(
          accounts.get(row.account_id)?.group || "",
        )
      )
        fail(
          "Ajustes de competência são apenas de entradas e saídas operacionais.",
        );
    for (const [key, value] of Object.entries(p.mappings)) {
      if (!accounts.has(value) || !/^(income|expense):/.test(key))
        fail("Classificação de origem inválida.");
      if (
        key.startsWith("income:") !==
        ["income", "cash_in"].includes(accounts.get(value)?.group || "")
      )
        fail(
          "Não classifique recebimentos como despesas, nem despesas como entradas.",
        );
    }
    for (const work of p.works) {
      const [sy, sm] = work.start.split("-").map(Number),
        [ey, em] = work.end.split("-").map(Number);
      const duration = (ey - sy) * 12 + em - sm + 1;
      if (duration < 1 || duration > 120)
        fail("A duração da obra deve ser de 1 a 120 meses.");
    }
  });
