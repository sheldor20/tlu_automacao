export type PerformanceMode = "realized" | "forecast" | "total";
export const PERFORMANCE_FIELDS = ["received", "paid", "receivable", "payable"] as const;
export type PerformanceField = typeof PERFORMANCE_FIELDS[number];
export type PerformanceAmounts = Record<PerformanceField, number>;
export type PerformanceRow = PerformanceAmounts & { date: string | null };
export type PerformanceCompany = { key: string; name: string };
export type PerformanceSnapshot = {
  synchronized_at: string | null;
  as_of: string | null;
  companies: PerformanceCompany[];
  rows: PerformanceRow[];
  source: string;
};
export type DatedCashFlow = { date: string; value: number };
export type AnnualPerformance = PerformanceAmounts & { year: string; incoming: number; outgoing: number; net: number; accumulated: number | null };

const DAY = 86_400_000;
const YEAR = 365 * DAY;
export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const emptyAmounts = (): PerformanceAmounts => ({ received: 0, paid: 0, receivable: 0, payable: 0 });

export function validCashDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function totalPerformance(rows: PerformanceRow[]) {
  return rows.reduce((total, row) => {
    for (const key of PERFORMANCE_FIELDS) total[key] = roundMoney(total[key] + row[key]);
    return total;
  }, emptyAmounts());
}

export function performanceAmounts(amounts: PerformanceAmounts, mode: PerformanceMode) {
  const incoming = mode === "realized" ? amounts.received : mode === "forecast" ? amounts.receivable : amounts.received + amounts.receivable;
  const outgoing = mode === "realized" ? amounts.paid : mode === "forecast" ? amounts.payable : amounts.paid + amounts.payable;
  return { incoming: roundMoney(incoming), outgoing: roundMoney(outgoing), net: roundMoney(incoming - outgoing) };
}

export function currentPerformanceDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// The user-defined projection assumes overdue open balances occur today.
// Actual payments and future due dates remain unchanged, as does the source data.
export function schedulePerformance(rows: PerformanceRow[], asOf: string) {
  let undated = 0, overdue = 0, futureActual = 0;
  const scheduled: PerformanceRow[] = [];
  for (const row of rows) {
    const date = validCashDate(row.date) ? row.date : null;
    const actual = { date, received: row.received, paid: row.paid, receivable: 0, payable: 0 };
    if (row.received || row.paid) {
      scheduled.push(actual);
      if (!date) undated += Math.abs(row.received) + Math.abs(row.paid);
      else if (date > asOf) futureActual += Math.abs(row.received) + Math.abs(row.paid);
    }
    if (row.receivable || row.payable) {
      if (!date) undated += Math.abs(row.receivable) + Math.abs(row.payable);
      const isOverdue = Boolean(date && date < asOf);
      if (isOverdue) overdue += Math.abs(row.receivable) + Math.abs(row.payable);
      scheduled.push({ date: isOverdue ? asOf : date, received: 0, paid: 0, receivable: row.receivable, payable: row.payable });
    }
  }
  return {
    rows: scheduled,
    undated: roundMoney(undated), overdue: roundMoney(overdue), futureActual: roundMoney(futureActual),
    blockedReason: !validCashDate(asOf) ? "Data-base indisponível."
      : undated > 0 ? "Há movimentos sem data na origem."
      : futureActual > 0 ? "Há baixas posteriores à data-base."
        : null,
  };
}

export function annualPerformance(rows: PerformanceRow[], mode: PerformanceMode): AnnualPerformance[] {
  const byYear = new Map<string, PerformanceAmounts>();
  for (const row of rows) {
    const key = row.date?.slice(0, 4) || "Sem data";
    const total = byYear.get(key) || emptyAmounts();
    for (const field of PERFORMANCE_FIELDS) total[field] = roundMoney(total[field] + row[field]);
    byYear.set(key, total);
  }
  let accumulated = 0;
  return [...byYear].sort(([a], [b]) => a.localeCompare(b)).map(([year, amounts]) => {
    const values = performanceAmounts(amounts, mode);
    if (year !== "Sem data") accumulated = roundMoney(accumulated + values.net);
    return { year, ...amounts, ...values, accumulated: year === "Sem data" ? null : accumulated };
  });
}

export function datedPerformance(rows: PerformanceRow[]): DatedCashFlow[] {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    if (!row.date || !validCashDate(row.date)) continue;
    byDate.set(row.date, roundMoney((byDate.get(row.date) || 0) + performanceAmounts(row, "total").net));
  }
  return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
}

export function datedNpv(flows: DatedCashFlow[], rate: number) {
  if (!flows.length || !Number.isFinite(rate) || rate <= -1) return null;
  const origin = Date.parse(flows[0].date);
  const result = flows.reduce((sum, row) => sum + row.value * Math.exp(-Math.log1p(rate) * (Date.parse(row.date) - origin) / YEAR), 0);
  return Number.isFinite(result) ? result : null;
}

export function datedIrr(flows: DatedCashFlow[]): { rate: number | null; reason: string | null } {
  if (flows.some((row) => !validCashDate(row.date) || !Number.isFinite(row.value))) return { rate: null, reason: "Há fluxos ou datas inválidos." };
  const byDate = new Map<string, number>();
  for (const row of flows) byDate.set(row.date, (byDate.get(row.date) || 0) + row.value);
  const nonzero = [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value })).filter((row) => Math.abs(row.value) >= 0.005);
  let changes = 0;
  for (let i = 1; i < nonzero.length; i++) if (Math.sign(nonzero[i].value) !== Math.sign(nonzero[i - 1].value)) changes++;
  if (!changes) return { rate: null, reason: "São necessárias entradas e saídas em datas distintas." };
  const uncertain = { rate: null, reason: "Não foi possível confirmar uma TIR única para este fluxo. Consulte o VPL." };
  const origin = Date.parse(nonzero[0].date);
  const scale = nonzero.reduce((sum, row) => sum + Math.abs(row.value), 0);
  const times = nonzero.map((row) => (Date.parse(row.date) - origin) / YEAR);
  const valueAt = (logRate: number) => {
    const shift = logRate < 0 ? -logRate * times[times.length - 1] : 0;
    return nonzero.reduce((sum, row, index) => sum + row.value / scale * Math.exp(-logRate * times[index] - shift), 0);
  };
  let low = -14, high = 14, lowValue = valueAt(low);
  const highValue = valueAt(high);
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || Math.sign(lowValue) === Math.sign(highValue)) return changes > 1 ? uncertain : { rate: null, reason: "TIR não encontrada para este fluxo." };
  let root = 0;
  for (let i = 0; i < 180; i++) {
    const middle = (low + high) / 2, value = valueAt(middle);
    root = middle;
    if (value === 0 || high - low < 1e-13) break;
    if (Math.sign(value) === Math.sign(lowValue)) { low = middle; lowValue = value; } else high = middle;
  }
  if (Math.abs(valueAt(root)) > 1e-10) return { rate: null, reason: "O cálculo da TIR não convergiu. Consulte o VPL." };
  if (changes > 1) {
    // Alternating individual flows do not imply multiple roots. If all discounted
    // prefix balances retain the first flow's sign at the root, summation by
    // parts proves that NPV has opposite signs on either side of that root.
    // This is a sufficient uniqueness test; inconclusive cases stay explicit.
    const direction = Math.sign(nonzero[0].value);
    const shift = root < 0 ? -root * times[times.length - 1] : 0;
    let balance = 0;
    for (let i = 0; i < nonzero.length - 1; i++) {
      balance += nonzero[i].value / scale * Math.exp(-root * times[i] - shift);
      if (balance * direction < -1e-12) return uncertain;
    }
  }
  return { rate: Math.expm1(root), reason: null };
}

export function capitalPerformance(flows: DatedCashFlow[], rate: number | null = null) {
  let accumulated = 0, minimum = 0, peakDate: string | null = null, lastNegative = -1;
  const origin = flows.length ? Date.parse(flows[0].date) : 0;
  const points = flows.map((row, index) => {
    const factor = rate === null ? 1 : Math.exp(-Math.log1p(rate) * (Date.parse(row.date) - origin) / YEAR);
    accumulated += row.value * factor;
    if (accumulated < minimum - 0.005) { minimum = accumulated; peakDate = row.date; }
    if (accumulated < -0.005) lastNegative = index;
    return { date: row.date, value: accumulated };
  });
  return {
    points, peak: Math.max(0, -minimum), peakDate,
    hasDeficit: minimum < -0.005,
    recovery: lastNegative >= 0 && lastNegative < flows.length - 1 ? points[lastNegative + 1].date : null,
  };
}
