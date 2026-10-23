export type InstallmentEntry = {
  id: string; title_key: string | null; amount: number | string; cash_date: string | null;
};
export type PaidInstallments = {
  count: number | null;
  reason: string;
  receivedPublishedAt: string | null;
  receivablePublishedAt: string | null;
};

// Count titles, never receipt rows or monetary totals. A partial payment still
// has an open balance; a fully reversed title has no positive net receipt.
export function paidInstallments(
  received: InstallmentEntry[], receivable: InstallmentEntry[],
  receivedPublishedAt: string | null, receivablePublishedAt: string | null,
  asOf: string, stable = true,
): PaidInstallments {
  const result = (count: number | null, reason: string): PaidInstallments => ({ count, reason, receivedPublishedAt, receivablePublishedAt });
  if (!stable) return result(null, "A base está sendo atualizada. Selecione a unidade novamente.");
  const receivedTime = Date.parse(receivedPublishedAt || ""), receivableTime = Date.parse(receivablePublishedAt || "");
  if (!Number.isFinite(receivedTime) || !Number.isFinite(receivableTime) || receivableTime < receivedTime) return result(null, "É necessária uma base de saldos em aberto publicada após a base de recebimentos para confirmar as parcelas pagas.");
  const seen = new Map<string, string>();
  const totals = new Map<string, number>();
  const open = new Set<string>();
  for (const [kind, rows] of [["received", received], ["receivable", receivable]] as const) {
    for (const row of rows) {
      const amount = typeof row.amount === "string" && !row.amount.trim() ? NaN : Number(row.amount);
      if (!row.id || !row.title_key?.trim() || !Number.isFinite(amount)) return result(null, "Há lançamentos sem identificação de parcela ou valor válido para confirmar o total pago.");
      const key = `${kind}:${row.id}`, signature = JSON.stringify([row.title_key, row.amount, row.cash_date]);
      if (seen.has(key)) {
        if (seen.get(key) !== signature) return result(null, "Há lançamentos duplicados com dados divergentes. Confira a origem.");
        continue;
      }
      seen.set(key, signature);
      if (kind === "received") {
        if (!row.cash_date || !/^\d{4}-\d{2}-\d{2}$/.test(row.cash_date) || row.cash_date > asOf) return result(null, "Há recebimentos sem data confirmada ou com data futura.");
        totals.set(row.title_key, (totals.get(row.title_key) || 0) + Math.round(amount * 1e6));
      } else {
        if (amount < 0) return result(null, "Há saldo em aberto negativo que precisa de conferência.");
        if (amount > 0) open.add(row.title_key);
      }
    }
  }
  const count = [...totals].filter(([key, net]) => net > 0 && !open.has(key)).length;
  if (count > 1200) return result(null, "O total de parcelas excede o limite do cálculo. Confira a origem.");
  return result(count, "Total de parcelas distintas com recebimento líquido positivo e sem saldo em aberto na base publicada; pagamentos parciais e estornos integrais não entram.");
}

export function assertFruitionMonths(months: number, paid: PaidInstallments | undefined) {
  if (paid?.count !== null && paid?.count !== undefined && months !== paid.count) throw new Error("Os meses de fruição devem corresponder ao total de parcelas pagas da unidade. Selecione a unidade novamente.");
}

export function salePrefill(sale: { saleDate?: unknown; saleValue?: unknown }, asOf: string) {
  const date = typeof sale.saleDate === "string" ? sale.saleDate : "";
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date && date >= "1994-07-01" && date <= asOf;
  return {
    saleDate: validDate ? date : "",
    saleValue: typeof sale.saleValue === "number" && Number.isFinite(sale.saleValue) && sale.saleValue > 0 && sale.saleValue <= 1e10 ? sale.saleValue : 0,
  };
}
