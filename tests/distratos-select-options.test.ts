import assert from "node:assert/strict";
import test from "node:test";
import { filterDistratoOptions } from "../lib/distratos-select-options.ts";
const works = [
  { value: "20|033", label: "Jardim São José · Obra 033 · Empresa Alfa" },
  { value: "20|33", label: "Jardim São José II · Obra 033 · Empresa Beta" },
  { value: "2|7", label: "Residencial Águas · Obra 007 · Empresa Alfa" },
];
test("filtra empreendimento por nome, código e empresa sem acentos ou diferença de caixa", () => {
  assert.deepEqual(filterDistratoOptions(works, "  SAO jose 033 empresa alfa "), [works[0]]);
  assert.deepEqual(filterDistratoOptions(works, "aguas"), [works[2]]);
});
test("não altera chaves nem combina empreendimentos com rótulos semelhantes", () => {
  const found = filterDistratoOptions(works, "033");
  assert.deepEqual(found.map((o) => o.value), ["20|033", "20|33"]);
  assert.strictEqual(found[0], works[0]);
});
test("quadra e lote preservam zeros e códigos alfanuméricos", () => {
  const options = ["007", "7", "A07", "003"].map((value) => ({ value, label: value }));
  assert.deepEqual(filterDistratoOptions(options, "007"), [options[0]]);
  assert.deepEqual(filterDistratoOptions(options, "a07"), [options[2]]);
  assert.deepEqual(filterDistratoOptions(options, ""), options);
});
test("sem resultados e limpeza não modificam as opções de origem", () => {
  const before = structuredClone(works);
  assert.deepEqual(filterDistratoOptions(works, "inexistente"), []);
  assert.deepEqual(filterDistratoOptions(works, "  "), works);
  assert.deepEqual(works, before);
});
