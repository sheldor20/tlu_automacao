import assert from "node:assert/strict";
import test from "node:test";
import { buildDeedTractionHistory, sumMetricSeries } from "../lib/management-metrics.ts";

test("soma somente competências disponíveis e preserva ausência total", () => {
  assert.equal(sumMetricSeries([64288.22, 0, 156840, 76400.64, 258249.39, 7246, 0]), 563024.25);
  assert.equal(sumMetricSeries([null, null]), null);
});

test("usa somente as posições mensais informadas pelo Qlik", () => {
  const history = buildDeedTractionHistory({
    semProcessoInformado: [null, null, 70],
    autorizadas: [10, 20, 30],
  });

  assert.deepEqual(history.map((point) => point.semProcesso), [null, null, 70]);
  assert.deepEqual(history.map((point) => point.autorizadas), [10, 20, 30]);
  assert.equal(history[0].taxa, null);
  assert.equal(history[1].taxa, null);
  assert.equal(history[2].taxa, 30);
});

test("calcula a variação mensal em pontos percentuais sem inventar mês ausente", () => {
  const history = buildDeedTractionHistory({
    semProcessoInformado: [90, null, 70],
    autorizadas: [10, null, 30],
  });

  assert.equal(history[0].variacaoPontosPercentuais, null);
  assert.equal(history[1].taxa, null);
  assert.equal(history[2].variacaoPontosPercentuais, null);
});
