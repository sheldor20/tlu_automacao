export function sumMetricSeries(values: Array<number | null>) {
  const available = values.filter((value): value is number => value !== null);
  return available.length ? available.reduce((sum, value) => sum + value, 0) : null;
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
