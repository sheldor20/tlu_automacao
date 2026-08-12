import assert from "node:assert/strict";
import test from "node:test";
import { remainingSupplyQuantity, supplyWithRemainingQuantity } from "../lib/construction-supplies.ts";

const supply = {
  name: "Cimento",
  total_value: 1200,
  total_quantity: 100,
  used_quantity: 35,
};

test("calcula o estoque pelo total menos o consumo", () => {
  assert.equal(remainingSupplyQuantity(supply), 65);
});

test("converte o estoque informado em consumo automaticamente", () => {
  assert.deepEqual(supplyWithRemainingQuantity(supply, 42), {
    ...supply,
    used_quantity: 58,
  });
});

test("limita estoque e consumo aos limites válidos", () => {
  assert.equal(supplyWithRemainingQuantity(supply, 150).used_quantity, 0);
  assert.equal(supplyWithRemainingQuantity(supply, -5).used_quantity, 100);
  assert.equal(remainingSupplyQuantity({ ...supply, used_quantity: 180 }), 0);
});
