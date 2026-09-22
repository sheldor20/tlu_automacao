import type { ManagementIndicatorValue } from "./types.ts";

export function sumMetricSeries(values: Array<number | null>) {
  const available = values.filter((value): value is number => value !== null);
  return available.length ? available.reduce((sum, value) => sum + value, 0) : null;
}

export function latestCompanyCashSnapshot(values: ManagementIndicatorValue[]) {
  const totals = values.filter((item) => item.area === "empresa" && item.dimension_key === "total");
  const cashMetric = totals
    .filter((item) => item.metric_key === "valor_caixa")
    .sort((a, b) => b.reference_month.localeCompare(a.reference_month) || b.updated_at.localeCompare(a.updated_at))[0];
  const availableMetric = cashMetric ? totals.find((item) => (
    item.metric_key === "caixa_disponivel"
    && item.reference_month === cashMetric.reference_month
    && item.metadata.synchronized_at === cashMetric.metadata.synchronized_at
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
