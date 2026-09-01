import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("../components/management-dashboard.tsx", import.meta.url), "utf8");
const tractionSection = dashboard.match(
  /<section className="management-panel">[\s\S]*?<h2>Tração das unidades quitadas<\/h2>[\s\S]*?<\/section>/,
)?.[0] || "";

test("mantém os blocos das posições das unidades quitadas", () => {
  assert.match(dashboard, /\["Quitadas", "unidades_quitadas"\]/);
  assert.match(dashboard, /\["Sem processo", "unidades_sem_processo"\]/);
  assert.match(dashboard, /\["Autorizadas", "unidades_autorizadas_escrituracao"\]/);
  assert.match(dashboard, /\["Em escrituração", "unidades_escrituracao_sem_registro"\]/);
  assert.match(tractionSection, /deedMetrics\.map\(\(\[label, key\]\)/);
  assert.match(tractionSection, /displayNumber\(closedValue\(key\)\)/);
});

test("mostra Sem processo e Autorizadas como linhas mensais sobrepostas", () => {
  assert.match(dashboard, /const chartMonths = closedMonthIndex >= 0 \? months\.slice\(0, closedMonthIndex \+ 1\) : \[closedMonth\]/);
  assert.match(tractionSection, /<TrendChart/);
  assert.doesNotMatch(tractionSection, /<GroupedBarChart/);
  assert.match(tractionSection, /labels=\{chartMonths\.map\(\(month\) => month\.label\)\}/);
  assert.match(tractionSection, /label: "Sem processo"[\s\S]*?closedSeries\("unidades_sem_processo"\)/);
  assert.match(tractionSection, /label: "Autorizadas"[\s\S]*?closedSeries\("unidades_autorizadas_escrituracao"\)/);
});
