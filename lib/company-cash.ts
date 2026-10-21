import type { QlikMetricSnapshot } from "./qlik-cloud.ts";

type AccountBalance = { dimensions: string[]; value: number };

function verifiedAccounts(snapshot: QlikMetricSnapshot): AccountBalance[] {
  const fail = () => { throw new Error(`Qlik Financeiro: composição bancária inconsistente em ${snapshot.referenceMonth}. Nenhum dado foi gravado.`); };
  let rows: AccountBalance[];
  try { rows = JSON.parse(snapshot.selections.account_balances || "null"); } catch { return fail(); }
  if (!Array.isArray(rows) || rows.length === 0) return fail();
  const seen = new Set<string>();
  let sum = 0;
  for (const row of rows) {
    if (!Array.isArray(row.dimensions) || row.dimensions.length < 2
      || row.dimensions.some((part) => typeof part !== "string" || !part.trim())
      || typeof row.value !== "number" || !Number.isFinite(row.value)) return fail();
    const key = JSON.stringify(row.dimensions);
    if (seen.has(key)) return fail();
    seen.add(key);
    sum += row.value;
  }
  const total = Number(snapshot.selections.qlik_total);
  if (!snapshot.selections.qlik_total || !Number.isFinite(total)
    || Math.abs(sum - total) > 0.011 || Math.abs(sum - snapshot.value) > 0.011) return fail();
  return rows;
}

/** Union of the group's accounts and all rental accounts, never a sum of overlapping totals. */
export function consolidateCompanyCash(group: QlikMetricSnapshot, rentals: QlikMetricSnapshot): QlikMetricSnapshot {
  if (group.referenceMonth !== rentals.referenceMonth
    || !group.selections.reference_date || group.selections.reference_date !== rentals.selections.reference_date) {
    throw new Error("Qlik Financeiro: caixa e aluguéis devem ter a mesma data de fechamento.");
  }
  const groupRows = verifiedAccounts(group);
  const rentalRows = verifiedAccounts(rentals);
  const accounts = new Map(groupRows.map((row) => [JSON.stringify(row.dimensions), row]));
  let additional = 0;
  for (const row of rentalRows) {
    const key = JSON.stringify(row.dimensions);
    const existing = accounts.get(key);
    if (existing && Math.abs(existing.value - row.value) > 0.011) {
      throw new Error("Qlik Financeiro: uma conta apresentou saldos diferentes no grupo e em aluguéis.");
    }
    if (!existing) {
      accounts.set(key, row);
      additional += row.value;
    }
  }
  const total = Math.round((group.value + additional) * 100) / 100;
  return {
    ...group,
    value: total,
    selections: {
      ...group.selections,
      cálculo: "contas do grupo Terra Lotus e todas as contas de aluguéis, sem duplicidade",
      valor_caixa_grupo: String(group.value),
      saldo_alugueis_adicional: String(Math.round(additional * 100) / 100),
      consolidated_total: String(total),
      consolidated_account_balances: JSON.stringify([...accounts.values()]),
    },
  };
}
