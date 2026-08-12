export const QLIK_DELINQUENCY_CONNECTION_SLUG = "qlik-delinquency";
export const QLIK_DELINQUENCY_SOURCE = "Qlik Cloud - Gestão Inadimplência";

export const QLIK_DELINQUENCY_FILTERS = [
  { field: "Empreendimento?", value: "Sim" },
  { field: "Cobrável?", value: "Sim" },
  { field: "Venda Jurídico?", value: "Não" },
] as const;

export const QLIK_DELINQUENCY_HEADERS = [
  "Posição",
  "Situação Período",
  "Inadimplência Inicial",
  "Inadimplência Recebida",
  "Inadimplência Renegociada",
  "Inadimplência Prorrogada",
  "Inadimplência Distratada",
  "Inadimplência Cessionada",
  "Inadimplência Saldo",
  "Redução Inadimplência",
] as const;

export type QlikTableSnapshot = {
  headers: string[];
  rows: string[][];
  selections: Record<string, string>;
};

export type DelinquencyMonth = {
  referenceMonth: string;
  periodLabel: string;
  status: string;
  delinquencyBalance: number;
  reductionPercent: number;
};

const PORTUGUESE_MONTHS: Record<string, number> = {
  jan: 1,
  fev: 2,
  mar: 3,
  abr: 4,
  mai: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  set: 9,
  out: 10,
  nov: 11,
  dez: 12,
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

export function parseBrazilianNumber(value: string) {
  const cleaned = value
    .replace(/R\$/gi, "")
    .replace(/%/g, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^-\d.]/g, "");
  const number = Number(cleaned);
  if (!cleaned || !Number.isFinite(number)) {
    throw new Error(`Qlik: valor numérico inválido: “${value}”.`);
  }
  return number;
}

export function parseQlikReferenceMonth(value: string) {
  const normalized = normalizeText(value);
  const match = normalized.match(/^([a-z]{3})\s+(\d{4})$/);
  const month = match ? PORTUGUESE_MONTHS[match[1]] : undefined;
  if (!match || !month) throw new Error(`Qlik: competência inválida: “${value}”.`);
  return `${match[2]}-${String(month).padStart(2, "0")}-01`;
}

export function previousMonthKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  if (!year || !month) throw new Error("Qlik: não foi possível determinar a competência atual.");
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function currentMonthKey(now = new Date()) {
  const previous = previousMonthKey(now);
  const previousDate = new Date(`${previous}T12:00:00Z`);
  const current = new Date(Date.UTC(previousDate.getUTCFullYear(), previousDate.getUTCMonth() + 1, 1));
  return `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function assertQlikFilters(selections: Record<string, string>) {
  for (const filter of QLIK_DELINQUENCY_FILTERS) {
    const selected = selections[filter.field];
    if (normalizeText(selected || "") !== normalizeText(filter.value)) {
      throw new Error(`Qlik: filtro “${filter.field}” deveria estar em “${filter.value}”, mas retornou “${selected || "sem seleção"}”.`);
    }
  }
}

export function assertQlikHeaders(headers: string[]) {
  QLIK_DELINQUENCY_HEADERS.forEach((expected, index) => {
    if (normalizeText(headers[index] || "") !== normalizeText(expected)) {
      throw new Error(`Qlik: a coluna ${index + 1} deveria ser “${expected}”, mas retornou “${headers[index] || "vazia"}”.`);
    }
  });
}

export function parseDelinquencySnapshot(snapshot: QlikTableSnapshot, now = new Date()) {
  assertQlikFilters(snapshot.selections);
  assertQlikHeaders(snapshot.headers);
  const previousMonth = previousMonthKey(now);
  const byMonth = new Map<string, DelinquencyMonth>();

  for (const cells of snapshot.rows) {
    if (cells.length < QLIK_DELINQUENCY_HEADERS.length) continue;
    const status = cells[1].trim();
    if (!normalizeText(status).includes("concluido")) continue;
    const referenceMonth = parseQlikReferenceMonth(cells[0]);
    if (referenceMonth > previousMonth) continue;
    if (byMonth.has(referenceMonth)) throw new Error(`Qlik: a competência ${referenceMonth} apareceu mais de uma vez na tabela.`);
    byMonth.set(referenceMonth, {
      referenceMonth,
      periodLabel: cells[0].trim(),
      status,
      delinquencyBalance: parseBrazilianNumber(cells[8]),
      reductionPercent: parseBrazilianNumber(cells[9]),
    });
  }

  const months = [...byMonth.values()].sort((a, b) => a.referenceMonth.localeCompare(b.referenceMonth));
  if (!months.length) throw new Error("Qlik: nenhuma competência fechada foi encontrada na tabela de inadimplência.");
  if (!byMonth.has(previousMonth)) {
    throw new Error(`Qlik: a competência anterior (${previousMonth}) ainda não está concluída na tabela. Nenhum dado foi gravado.`);
  }
  return months;
}

export function toDelinquencyIndicatorRows(months: DelinquencyMonth[], synchronizedAt: string) {
  return months.flatMap((month) => {
    const metadata = {
      connection: QLIK_DELINQUENCY_CONNECTION_SLUG,
      qlik_status: month.status,
      qlik_period: month.periodLabel,
      filters: Object.fromEntries(QLIK_DELINQUENCY_FILTERS.map((item) => [item.field, item.value])),
      synchronized_at: synchronizedAt,
    };
    const common = {
      area: "juridico-vendas-cobranca",
      reference_month: month.referenceMonth,
      dimension_key: "total",
      dimension_label: null,
      source: QLIK_DELINQUENCY_SOURCE,
      metadata,
    };
    return [
      {
        ...common,
        metric_key: "inadimplencia_total",
        value: month.delinquencyBalance,
        notes: "Saldo de inadimplência ao final da competência fechada.",
      },
      {
        ...common,
        metric_key: "eficiencia_cobranca",
        value: month.reductionPercent,
        notes: "Percentual de redução da inadimplência na competência fechada.",
      },
    ];
  });
}
