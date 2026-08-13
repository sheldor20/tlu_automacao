export type DeedTractionPoint = {
  semProcesso: number | null;
  autorizadas: number | null;
  taxa: number | null;
  variacaoPontosPercentuais: number | null;
};

type DeedTractionInput = {
  semProcessoInformado: Array<number | null>;
  autorizadas: Array<number | null>;
};

export function sumMetricSeries(values: Array<number | null>) {
  const available = values.filter((value): value is number => value !== null);
  return available.length ? available.reduce((sum, value) => sum + value, 0) : null;
}

export function buildDeedTractionHistory({
  semProcessoInformado,
  autorizadas,
}: DeedTractionInput): DeedTractionPoint[] {
  const length = Math.max(semProcessoInformado.length, autorizadas.length);

  return Array.from({ length }, (_, index) => {
    const autorizadasNoMes = autorizadas[index] ?? null;
    const semProcessoNoMes = semProcessoInformado[index] ?? null;
    const base = semProcessoNoMes !== null && autorizadasNoMes !== null
      ? semProcessoNoMes + autorizadasNoMes
      : 0;
    const taxa = base > 0 && autorizadasNoMes !== null
      ? autorizadasNoMes / base * 100
      : null;

    return {
      semProcesso: semProcessoNoMes,
      autorizadas: autorizadasNoMes,
      taxa,
      variacaoPontosPercentuais: null,
    };
  }).map((point, index, history) => {
    if (index === 0 || point.taxa === null || history[index - 1].taxa === null) return point;
    return {
      ...point,
      variacaoPontosPercentuais: point.taxa - history[index - 1].taxa!,
    };
  });
}
