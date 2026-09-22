import type { ManagementIndicatorValue } from "./types.ts";

export function sumMetricSeries(values: Array<number | null>) {
  const available = values.filter((value): value is number => value !== null);
  return available.length ? available.reduce((sum, value) => sum + value, 0) : null;
}

export function latestCompanyCashSnapshot(values: ManagementIndicatorValue[], currentReferenceMonth: string) {
  const totals = values.filter((item) => item.area === "empresa" && item.dimension_key === "total"
    && item.reference_month <= currentReferenceMonth);
  const cashMetric = totals
    .filter((item) => item.metric_key === "valor_caixa")
    .sort((a, b) => b.reference_month.localeCompare(a.reference_month) || b.updated_at.localeCompare(a.updated_at))[0];
  const [year, month] = currentReferenceMonth.split("-").map(Number);
  const previousReferenceMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
  const availableMetric = cashMetric ? totals.find((item) => (
    item.metric_key === "caixa_disponivel"
    && item.reference_month === cashMetric.reference_month
    && item.metadata.synchronized_at === cashMetric.metadata.synchronized_at
    // The open month's available cash must deduct the last closed rental
    // balance, including December in January. Do not display a wrong pairing.
    && (cashMetric.reference_month !== currentReferenceMonth
      || (item.metadata.selections as Record<string, unknown> | undefined)?.saldo_conta_alugueis_competência === previousReferenceMonth)
  )) : undefined;
  const cash = cashMetric?.value ?? null;
  const availableCash = availableMetric?.value ?? null;
  const selections = cashMetric?.metadata.selections as Record<string, unknown> | undefined;
  const referenceDate = typeof selections?.reference_date === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(selections.reference_date) ? selections.reference_date : null;
  const synchronizedAt = typeof cashMetric?.metadata.synchronized_at === "string"
    ? cashMetric.metadata.synchronized_at : cashMetric?.updated_at ?? null;

  return {
    cash,
    availableCash,
    rentalCash: cash !== null && availableCash !== null ? cash - availableCash : null,
    referenceMonth: cashMetric?.reference_month ?? null,
    referenceDate,
    synchronizedAt,
  };
}

export function companyMonthSnapshot(
  referenceMonth: string,
  metricValueForMonth: (key: string, referenceMonth: string) => number | null,
) {
  const read = (key: string) => metricValueForMonth(key, referenceMonth);
  const revenue = read("receita_consolidada");
  const expense = read("despesa_consolidada");
  const reportedResult = read("resultado_gerencial");
  const result = reportedResult ?? (revenue !== null && expense !== null ? revenue - expense : null);
  const cash = read("valor_caixa");
  const availableCash = read("caixa_disponivel");
  const rentalCash = cash !== null && availableCash !== null ? cash - availableCash : null;
  return { revenue, expense, reportedResult, result, cash, availableCash, rentalCash };
}
