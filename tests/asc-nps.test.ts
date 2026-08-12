import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import {
  assertMonthlyFiltersApplied,
  buildMonthlyReportPath,
  parseNpsReportHtml,
  type NpsMonthResult,
} from "../lib/asc-nps.ts";

const reportHtml = `
  <h3 class="panel-title">Como foi sua experiência com nosso atendimento numa escala de 0 a 5?</h3>
  <h3 class="panel-title">Em uma escala de 0 a 5, o quanto você indicaria a Terra Lótus a um amigo?</h3>
  <script>
    var atendPorStatus = [
      [{"label":"Nota: 5","data":"99"}],
      [
        {"label":"Nota: 0","data":"0"},
        {"label":"Nota: 1","data":"0"},
        {"label":"Nota: 2","data":"3"},
        {"label":"Nota: 3","data":"0"},
        {"label":"Nota: 4","data":"0"},
        {"label":"Nota: 5","data":"8"}
      ]
    ];
  </script>
`;

test("calcula a média somente da pergunta de recomendação", () => {
  assert.deepEqual(parseNpsReportHtml(reportHtml, "2026-07-01"), {
    referenceMonth: "2026-07-01",
    average: 4.1818,
    responseCount: 11,
    distribution: { "0": 0, "1": 0, "2": 3, "3": 0, "4": 0, "5": 8 },
  });
});

test("monta o filtro mensal com o último dia correto", () => {
  const encoded = buildMonthlyReportPath("1", 2026, 2).split("/").at(-1)!;
  assert.equal(
    Buffer.from(encoded, "base64").toString(),
    "cod_pesquisa/1/dat_inicial/01-02-2026/dat_final/28-02-2026",
  );
});

test("reproduz exatamente o filtro mensal usado pelo ASCSAC", () => {
  assert.equal(
    buildMonthlyReportPath("1", 2026, 7),
    "/relatorios-pesquisa/detalhamento/datastr/Y29kX3Blc3F1aXNhLzEvZGF0X2luaWNpYWwvMDEtMDctMjAyNi9kYXRfZmluYWwvMzEtMDctMjAyNg==",
  );
});

test("retorna mês vazio sem inventar uma nota", () => {
  assert.deepEqual(parseNpsReportHtml("<script>var atendPorStatus = [];</script>", "2026-08-01"), {
    referenceMonth: "2026-08-01",
    average: null,
    responseCount: 0,
    distribution: {},
  });
});

test("falha explicitamente se a pergunta de recomendação mudar", () => {
  assert.throws(
    () => parseNpsReportHtml('<h3 class="panel-title">Outra pergunta</h3><script>var atendPorStatus = [[]];</script>', "2026-07-01"),
    /pergunta de recomendação não encontrada/,
  );
});

test("bloqueia uma carga anual quando o filtro mensal foi ignorado", () => {
  const repeated = Array.from({ length: 12 }, (_, index): NpsMonthResult => ({
    referenceMonth: `2026-${String(index + 1).padStart(2, "0")}-01`,
    average: 4.2181,
    responseCount: 1128,
    distribution: { "0": 10, "1": 20, "2": 30, "3": 40, "4": 50, "5": 978 },
  }));
  assert.throws(() => assertMonthlyFiltersApplied(repeated), /filtro mensal não foi aplicado/);
});
