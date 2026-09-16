import assert from "node:assert/strict";
import test from "node:test";
import { projectVgv } from "../lib/vgv-projection.ts";

test("reduz o saldo em ordem cronológica e desconta a taxa percentual uma única vez", () => {
  const result = projectVgv(1000, 8, [{ year: 2028, value: 600 }, { year: 2026, value: 400 }], 2026);
  assert.equal(result.adjustedTotal, 920);
  assert.deepEqual(result.points.map((point) => [point.year, point.closingBalance, point.adjustedClosingBalance]), [
    [2026, 600, 552], [2027, 600, 552], [2028, 0, 0],
  ]);
});

test("agrega parcelas no mesmo ano sem duplicar o total e preserva centavos", () => {
  const result = projectVgv(0.3, 10, [{ year: 2026, value: 0.1 }, { year: 2026, value: 0.2 }], 2026);
  assert.equal(result.adjustedTotal, 0.27);
  assert.equal(result.points[0].closingBalance, 0);
});

test("aceita zero e 100% de inadimplência sem tratar como ausência de dados", () => {
  assert.equal(projectVgv(100, 0, [{ year: 2026, value: 100 }], 2026).adjustedTotal, 100);
  assert.equal(projectVgv(100, 100, [{ year: 2026, value: 100 }], 2026).adjustedTotal, 0);
  assert.equal(projectVgv(0, 0, [{ year: 2026, value: 0 }], 2026).total, 0);
});

test("mantém parcelas já vencidas sem inventar uma data futura de recuperação", () => {
  const result = projectVgv(1000, 8, [{ year: 2026, value: 600 }, { year: 2027, value: 200 }], 2026, 200);
  assert.deepEqual(result.points.map((point) => point.closingBalance), [400, 200]);
});

test("rejeita dados incompletos ou inconsistentes em vez de publicar uma curva inventada", () => {
  assert.throws(() => projectVgv(1000, 8, [{ year: 2026, value: 900 }], 2026), /concilia/);
  assert.throws(() => projectVgv(1000, 101, [{ year: 2026, value: 1000 }], 2026), /percentual/);
  assert.throws(() => projectVgv(1000, Number.NaN, [{ year: 2026, value: 1000 }], 2026));
  assert.throws(() => projectVgv(1000, 8, [], 2026));
  assert.throws(() => projectVgv(1000, 8, [{ year: 2025, value: 1000 }], 2026));
  assert.throws(() => projectVgv(1000, 8, [{ year: 2026, value: -1000 }], 2026));
});

test('não acumula centavos fictícios ao arredondar previsões anuais do Qlik', () => {
  const result = projectVgv(1, 2.47, [{ year: 2026, value: 0.334 }, { year: 2027, value: 0.334 }, { year: 2028, value: 0.332 }], 2026);
  assert.deepEqual(result.points.map(point => point.closingBalance), [0.67, 0.33, 0]);
});
