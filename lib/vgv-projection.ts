export type VgvAnnualReceipt = { year: number; value: number };
export type VgvProjectionPoint = {
  year: number;
  receipts: number;
  openingBalance: number;
  closingBalance: number;
  adjustedClosingBalance: number;
};

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Keeps calendar order: the decrease comes from scheduled receipts, never sorting amounts. */
export function projectVgv(total: number, delinquencyPercent: number, receipts: VgvAnnualReceipt[], firstYear: number, overdue = 0, finalYear?: number) {
  if (!Number.isFinite(total) || total < 0) throw new Error("VGV total a receber inválido.");
  if (!Number.isFinite(overdue) || overdue < 0 || overdue > total) throw new Error("Saldo vencido inválido.");
  if (!Number.isFinite(delinquencyPercent) || delinquencyPercent < 0 || delinquencyPercent > 100) {
    throw new Error("O percentual de inadimplência deve estar entre 0% e 100%.");
  }
  if (!Number.isInteger(firstYear) || firstYear < 2000 || firstYear > 2200 || !receipts.length) {
    throw new Error("Cronograma anual de recebimentos indisponível.");
  }
  const byYear = new Map<number, number>();
  for (const receipt of receipts) {
    if (!Number.isInteger(receipt.year) || receipt.year < firstYear || receipt.year > 2200
      || !Number.isFinite(receipt.value) || receipt.value < 0) {
      throw new Error("Ano ou recebimento inválido na projeção de VGV.");
    }
    byYear.set(receipt.year, (byYear.get(receipt.year) || 0) + receipt.value);
  }
  const scheduled = money([...byYear.values()].reduce((sum, value) => sum + value, 0));
  const lastReceiptYear = Math.max(...byYear.keys());
  const endYear = finalYear ?? lastReceiptYear;
  if (!Number.isInteger(endYear) || endYear < lastReceiptYear || endYear > 2200) {
    throw new Error("O fim da projeção deve abranger todos os recebimentos até 2200.");
  }
  if (Math.abs(scheduled + overdue - total) > 0.05) {
    throw new Error("O cronograma anual não concilia com o VGV total a receber.");
  }
  const factor = 1 - delinquencyPercent / 100;
  let balance = money(total);
  let accumulatedReceipts = 0;
  const points: VgvProjectionPoint[] = [];
  for (let year = firstYear; year <= endYear; year += 1) {
    const receipts = money(byYear.get(year) || 0);
    const openingBalance = balance;
    // Qlik projections can contain fractions of a cent. Round the cumulative
    // position only, so rounding each year does not leave a fictitious balance.
    accumulatedReceipts += byYear.get(year) || 0;
    balance = money(Math.max(overdue, total - accumulatedReceipts));
    points.push({ year, receipts, openingBalance, closingBalance: balance, adjustedClosingBalance: money(balance * factor) });
  }
  return { total: money(total), overdue: money(overdue), delinquencyPercent, adjustedTotal: money(total * factor), points };
}
