import assert from "node:assert/strict";
import test from "node:test";
import { buildDeedTractionHistory } from "../lib/management-metrics.ts";

test("recompõe os meses sem posição informada usando quitadas menos autorizadas", () => {
  const history = buildDeedTractionHistory({
    semProcessoInformado: [null, null, 70],
    quitadas: [100, 110, 120],
    autorizadas: [10, 20, 30],
  });

  assert.deepEqual(history.map((point) => point.semProcesso), [90, 90, 70]);
  assert.deepEqual(history.map((point) => point.autorizadas), [10, 20, 30]);
  assert.equal(history[0].taxa, 10);
  assert.equal(history[1].taxa, 20 / 110 * 100);
  assert.equal(history[2].taxa, 30);
});

test("calcula a variação mensal em pontos percentuais sem inventar mês ausente", () => {
  const history = buildDeedTractionHistory({
    semProcessoInformado: [90, null, 70],
    quitadas: [100, null, 100],
    autorizadas: [10, null, 30],
  });

  assert.equal(history[0].variacaoPontosPercentuais, null);
  assert.equal(history[1].taxa, null);
  assert.equal(history[2].variacaoPontosPercentuais, null);
});
