export function currency(value: number | null | undefined, compact = false) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 2,
  }).format(amount);
}

export function dateBr(value: string | null | undefined) {
  if (!value) return "—";
  const date = value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value);
  return new Intl.DateTimeFormat("pt-BR").format(date);
}

export function monthBr(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 7)}-02T12:00:00`));
}

export function daysBetween(start: string, end?: string | null) {
  const startDate = new Date(start).getTime();
  const endDate = end ? new Date(end).getTime() : Date.now();
  return Math.max(0, Math.round((endDate - startDate) / 86_400_000));
}

export function initials(name?: string | null) {
  if (!name) return "TL";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
