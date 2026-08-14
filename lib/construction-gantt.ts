import type { Construction, MacroStage } from "./types";

const DAY_MS = 86_400_000;

export type ConstructionGanttRow = {
  id: string;
  parent_id: string | null;
  kind: "macro" | "micro";
  label: string;
  start_date: string | null;
  end_date: string | null;
  derived: boolean;
  progress_percent: number;
  left_percent: number | null;
  width_percent: number | null;
};

export type ConstructionGanttMonth = {
  key: string;
  label: string;
};

function dateTime(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function isoDate(value: number) {
  return new Date(value).toISOString().slice(0, 10);
}

function range(start: string | null | undefined, end: string | null | undefined) {
  if (!start && !end) return null;
  const first = start || end!;
  const last = end || start!;
  return dateTime(last) >= dateTime(first)
    ? { start: first, end: last }
    : { start: last, end: first };
}

function monthFloor(value: number) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function monthCeil(value: number) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0);
}

function monthsBetween(start: number, end: number): ConstructionGanttMonth[] {
  const months: ConstructionGanttMonth[] = [];
  const cursor = new Date(monthFloor(start));
  while (cursor.getTime() <= end) {
    months.push({
      key: `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`,
      label: new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(cursor),
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

export function buildConstructionGantt(construction: Pick<Construction, "start_date" | "expected_end_date">, macros: MacroStage[]) {
  const rowsWithoutPosition = macros.flatMap((macro) => {
    const micros = macro.micro_stages || [];
    const microRanges = micros.map((micro) => range(micro.start_date, micro.end_date)).filter(Boolean) as Array<{ start: string; end: string }>;
    const explicitMacroRange = range(macro.start_date, macro.end_date);
    const derivedStart = microRanges.length ? isoDate(Math.min(...microRanges.map((item) => dateTime(item.start)))) : null;
    const derivedEnd = microRanges.length ? isoDate(Math.max(...microRanges.map((item) => dateTime(item.end)))) : null;
    const macroRange = explicitMacroRange || range(derivedStart, derivedEnd);

    const macroRow: Omit<ConstructionGanttRow, "left_percent" | "width_percent"> = {
      id: macro.id,
      parent_id: null,
      kind: "macro",
      label: macro.name,
      start_date: macroRange?.start || null,
      end_date: macroRange?.end || null,
      derived: !explicitMacroRange && Boolean(macroRange),
      progress_percent: Number(macro.progress_percent || 0),
    };
    const microRows: Array<Omit<ConstructionGanttRow, "left_percent" | "width_percent">> = micros.map((micro) => {
      const microRange = range(micro.start_date, micro.end_date);
      return {
        id: micro.id,
        parent_id: macro.id,
        kind: "micro",
        label: micro.name,
        start_date: microRange?.start || null,
        end_date: microRange?.end || null,
        derived: false,
        progress_percent: Number(micro.progress_percent || 0),
      };
    });
    return [macroRow, ...microRows];
  });

  const datedRows = rowsWithoutPosition.filter((row) => row.start_date && row.end_date);
  const fallbackStart = construction.start_date;
  const fallbackEnd = construction.expected_end_date || isoDate(dateTime(fallbackStart) + 30 * DAY_MS);
  const firstDate = Math.min(dateTime(fallbackStart), ...datedRows.map((row) => dateTime(row.start_date!)));
  const lastDate = Math.max(dateTime(fallbackEnd), ...datedRows.map((row) => dateTime(row.end_date!)));
  const timelineStart = monthFloor(firstDate);
  const timelineEnd = monthCeil(Math.max(firstDate, lastDate));
  const totalDays = Math.max(1, Math.round((timelineEnd - timelineStart) / DAY_MS) + 1);

  const rows: ConstructionGanttRow[] = rowsWithoutPosition.map((row) => {
    if (!row.start_date || !row.end_date) return { ...row, left_percent: null, width_percent: null };
    const start = Math.max(timelineStart, dateTime(row.start_date));
    const end = Math.min(timelineEnd, dateTime(row.end_date));
    const left = Math.max(0, ((start - timelineStart) / DAY_MS / totalDays) * 100);
    const width = Math.max(0.8, (((end - start) / DAY_MS + 1) / totalDays) * 100);
    return { ...row, left_percent: left, width_percent: Math.min(100 - left, width) };
  });

  return {
    start_date: isoDate(timelineStart),
    end_date: isoDate(timelineEnd),
    months: monthsBetween(timelineStart, timelineEnd),
    rows,
  };
}
