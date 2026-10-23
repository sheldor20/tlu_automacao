import assert from "node:assert/strict";
import test from "node:test";
import { searchDistratoContracts } from "../lib/distratos-search.ts";

const contracts = [
  { id: "20|33|0007", buyerName: "João da Conceição", contract_number: "0007", block: "007", lot: "003" },
  { id: "20|33|7", buyerName: "Maria Sá", contract_number: "7", block: "007", lot: "003" },
  { id: "20|33|8", buyerName: "João Santos", contract_number: "8", block: "008", lot: "004" },
  { id: "20|33|9", buyerName: "Ana Lima", contract_number: "9", block: "7", lot: "3" },
];
const filters = { block: "", lot: "" };
test("busca cliente sem acentos e combina termos de nome e contrato", () => {
  assert.deepEqual(searchDistratoContracts(contracts, "  JOAO conceicao 0007 ", "20|33", filters), [contracts[0]]);
  assert.deepEqual(searchDistratoContracts(contracts, "sá", "033", filters), [contracts[1], contracts[2]]);
});
test("busca código exibido e preserva chaves, zeros e contratos distintos no mesmo lote", () => {
  const found = searchDistratoContracts(contracts, "033.007.003", "20|33", filters);
  assert.deepEqual(found, contracts.slice(0, 2));
  assert.strictEqual(found[0], contracts[0]);
  assert.deepEqual(found.map((c) => c.id), ["20|33|0007", "20|33|7"]);
  assert.deepEqual(searchDistratoContracts(contracts, "0007", "033", filters), [contracts[0]]);
});
test("busca respeita quadra e lote exatos sem converter códigos em números", () => {
  assert.deepEqual(searchDistratoContracts(contracts, "joao", "033", { block: "008", lot: "004" }), [contracts[2]]);
  assert.deepEqual(searchDistratoContracts(contracts, "ana", "033", { block: "007", lot: "003" }), []);
  assert.deepEqual(searchDistratoContracts(contracts, "quadra 007 lote 003", "033", filters), contracts.slice(0, 2));
});
test("busca sem resultado e limpeza preservam lista original e filtros", () => {
  const before = structuredClone(contracts);
  assert.deepEqual(searchDistratoContracts(contracts, "inexistente", "033", filters), []);
  assert.deepEqual(searchDistratoContracts(contracts, "", "033", { block: "007", lot: "003" }), contracts.slice(0, 2));
  assert.deepEqual(contracts, before);
});
