import assert from "node:assert/strict";
import test from "node:test";
import {
  currentMonthKey,
  parseBrazilianNumber,
  parseDelinquencySnapshot,
  parseQlikReferenceMonth,
  QLIK_DELINQUENCY_FILTERS,
  QLIK_DELINQUENCY_HEADERS,
  toDelinquencyIndicatorRows,
  type QlikTableSnapshot,
} from "../lib/qlik-delinquency.ts";

const selections = Object.fromEntries(QLIK_DELINQUENCY_FILTERS.map((filter) => [filter.field, filter.value]));

function snapshot(rows: string[][]): QlikTableSnapshot {
  return { headers: [...QLIK_DELINQUENCY_HEADERS], rows, selections };
}

test("normaliza números monetários e percentuais do Qlik", () => {
  assert.equal(parseBrazilianNumber("R$ 9.882.647,34"), 9_882_647.34);
  assert.equal(parseBrazilianNumber("12,25%"), 12.25);
});

test("converte a posição em competência mensal", () => {
  assert.equal(parseQlikReferenceMonth("Jul 2026"), "2026-07-01");
  assert.equal(currentMonthKey(new Date("2026-08-12T12:00:00-03:00")), "2026-08-01");
});

test("usa somente competências fechadas e exige o mês anterior", () => {
  const result = parseDelinquencySnapshot(snapshot([
    ["Ago 2026", "⏳ Em Curso", "11.353.469,21", "262.471,60", "280.077,22", "0,00", "1.250,92", "2.757,90", "10.806.911,57", "4,81%"],
    ["Jun 2026", "✅ Concluído", "10.839.733,82", "555.041,47", "215.079,16", "0,00", "0,00", "0,00", "10.069.613,19", "7,10%"],
    ["Jul 2026", "✅ Concluído", "11.261.711,11", "570.751,75", "629.324,06", "0,00", "178.987,96", "0,00", "9.882.647,34", "12,25%"],
  ]), new Date("2026-08-12T12:00:00-03:00"));

  assert.deepEqual(result.map((month) => month.referenceMonth), ["2026-06-01", "2026-07-01"]);
  assert.equal(result.at(-1)?.delinquencyBalance, 9_882_647.34);
  assert.equal(result.at(-1)?.reductionPercent, 12.25);
});

test("não grava uma posição antiga quando o mês anterior ainda não foi fechado", () => {
  assert.throws(() => parseDelinquencySnapshot(snapshot([
    ["Jun 2026", "✅ Concluído", "10", "0", "0", "0", "0", "0", "9", "10%"],
    ["Jul 2026", "⏳ Em Curso", "10", "0", "0", "0", "0", "0", "9", "10%"],
  ]), new Date("2026-08-12T12:00:00-03:00")), /a competência anterior.*ainda não está concluída/i);
});

test("interrompe a carga quando um filtro obrigatório não está aplicado", () => {
  const invalid = snapshot([]);
  invalid.selections["Cobrável?"] = "Não";
  assert.throws(() => parseDelinquencySnapshot(invalid), /filtro “Cobrável\?”/);
});

test("gera os dois indicadores mensais esperados", () => {
  const rows = toDelinquencyIndicatorRows([{
    referenceMonth: "2026-07-01",
    periodLabel: "Jul 2026",
    status: "✅ Concluído",
    delinquencyBalance: 9_882_647.34,
    reductionPercent: 12.25,
  }], "2026-08-12T15:00:00.000Z");

  assert.deepEqual(rows.map((row) => [row.metric_key, row.value]), [
    ["inadimplencia_total", 9_882_647.34],
    ["eficiencia_cobranca", 12.25],
  ]);
});
