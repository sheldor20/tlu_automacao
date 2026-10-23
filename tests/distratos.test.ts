import assert from "node:assert/strict";
import test from "node:test";
import { calculateDistrato, distratoTerm, distratoInputSchema, displayWorkCode, type CorrectedValue, type DistratoUnit } from "../lib/distratos.ts";
import { juriscalcPayload, parseJuriscalcResponse, correctDistratoValues } from "../lib/distratos-juriscalc.ts";

const value = (corrected: number, id = "imovel"): CorrectedValue => ({ id, date: "2025-01-10", original: corrected, corrected, factor: 1, indices: [] });
const input = { requestId: "11111111-1111-4111-8111-111111111111", contractId: "20|33|67", sourceRevision: "a".repeat(64), regime: "com_lei" as const, correctionDate: "2026-10-22", saleDate: "2025-01-10", saleValue: 224785.98, fruitionMonths: 37, brokerage: 0, municipalTaxes: 4580.73, sellerDocument: "", sellerAddress: "", sellerRepresentative: "", buyerDocument: "", buyerQualification: "", buyerAddress: "", registration: "", registryOffice: "", reason: "", possession: "", refundTerms: "", city: "", notes: "" };
const unit: DistratoUnit = { contractId: input.contractId, contractNumber: "67", companyId: "20", companyName: "Vendedora Exemplo", workKey: "20|33", workCode: "033", workName: "Empreendimento Exemplo", block: "007", lot: "003", buyerName: "Cliente Exemplo", synchronizedAt: "2026-10-22T09:00:00Z", receipts: [{ id: "rec-1", date: "2025-01-10", amount: 77902.84, description: "Principal" }] };
test("identificador exibe o código da obra, preservando sua chave exata para consultas", () => {
  assert.equal(displayWorkCode("20|33"), "033");
  assert.equal(displayWorkCode("033"), "033");
  assert.equal(displayWorkCode("2|A33"), "A33");
});

test("com lei reproduz o exemplo Fernando, incluindo o saldo negativo", () => {
  const result = calculateDistrato(input, value(224785.98), [value(77902.84, "parcela-1")]);
  assert.equal(result.totalDeductions, 89437.44);
  assert.equal(result.balance, -11534.60);
  assert.equal(result.refund, 0);
  const term = distratoTerm(input, unit, result);
  assert.equal(term.draft, true);
  assert.match(term.term, /não constitui, por si só, reconhecimento de dívida/);
  assert.match(term.term, /033\.007\.003/);
});
test("sem lei reproduz o exemplo Erica, reconciliando o centavo de arredondamento", () => {
  const result = calculateDistrato({ regime: "sem_lei", fruitionMonths: 1, brokerage: 4562.12, municipalTaxes: 0 }, value(131356.94), [value(89552.08, "parcela-1")]);
  assert.equal(result.totalDeductions, 27966.59);
  assert.equal(result.balance, 61585.49);
  assert.equal(result.roundingAdjustment, .01);
  assert.equal(Math.round((result.deductions.reduce((s, r) => s + r.amount, 0) + result.roundingAdjustment) * 100), Math.round(result.totalDeductions * 100));
});
test("validação rejeita datas invertidas, fruição fracionada e valores inválidos", () => {
  assert.ok(distratoInputSchema.safeParse(input).success);
  for (const patch of [{ saleDate: "2027-01-01" }, { fruitionMonths: 1.5 }, { municipalTaxes: -1 }, { saleValue: 0 }, { regime: "" }]) assert.equal(distratoInputSchema.safeParse({ ...input, ...patch }).success, false);
});
test("cada pagamento é enviado para correção individual sem juros, sem compensar o imóvel", () => {
  const payload = juriscalcPayload([{ id: "a", date: "2025-01-10", amount: 100 }, { id: "b", date: "2026-01-10", amount: 200 }], "2026-10-22");
  assert.equal(payload.indiceString, "INPC"); assert.equal(payload.juros, null);
  assert.ok(payload.valores.every((r) => r.especieValor === "DEBITO"));
  assert.deepEqual(payload.valores.map((r) => r.dataInicio), ["2025-01-10", "2026-01-10"]);
});
const report = (rows: Array<{ id: string; amount: number; corrected: number; date?: string }>) => [{ dataFinalDoCalculo: "22/10/2026", dataFinalDaCorrecao: "09/2026", total: Math.round(rows.reduce((s, r) => s + r.corrected, 0) * 100) / 100, itensDeSaida: [...rows.map((r) => ({ descricao: r.id, data: r.date || "10/01/2025", valorInicial: String(r.amount), valorCorrigido: String(r.corrected), juros: "0.00", total: r.corrected, indicesDeCorrecao: ["INPC de 01/2025 até 09/2026"] })), { descricao: "Totais", data: "22/10/2026", valorInicial: "100", valorCorrigido: "108.07", juros: "0", total: 108.07, indicesDeCorrecao: [] }] }];
test("valida o retorno do TJDFT: data, índice, juros, linhas e total", () => {
  const values = [{ id: "parcela-1", date: "2025-01-10", amount: 100 }];
  const response = report([{ id: "parcela-1", amount: 100, corrected: 108.07 }]);
  assert.equal(parseJuriscalcResponse(response, values, "2026-10-22").values[0].corrected, 108.07);
  for (const mutate of [
    (r: typeof response) => { r[0].itensDeSaida[0].juros = "1.00"; },
    (r: typeof response) => { r[0].total = 109; },
    (r: typeof response) => { r[0].itensDeSaida[0].indicesDeCorrecao = ["IPCA"]; },
    (r: typeof response) => { r[0].itensDeSaida[0].data = "11/01/2025"; },
    (r: typeof response) => { r[0].itensDeSaida = []; },
  ]) { const changed = structuredClone(response); mutate(changed); assert.throws(() => parseJuriscalcResponse(changed, values, "2026-10-22")); }
});
test("serviço indisponível não produz estimativa; data futura e duplicidade falham antes da consulta", async () => {
  const receipt = { id: "r1", date: "2025-01-10", amount: 100, description: "Principal" };
  let calls = 0;
  const fetcher = (async () => { calls++; return new Response("indisponível", { status: 503 }); }) as typeof fetch;
  await assert.rejects(() => correctDistratoValues([receipt], "2025-01-10", 1000, "2026-10-22", fetcher), /indisponível/);
  assert.equal(calls, 1);
  await assert.rejects(() => correctDistratoValues([receipt, receipt], "2025-01-10", 1000, "2026-10-22", fetcher), /duplicados/);
  await assert.rejects(() => correctDistratoValues([{ ...receipt, date: "2027-01-01" }], "2025-01-10", 1000, "2026-10-22", fetcher), /posteriores/);
  assert.equal(calls, 1);
});
test("campos preenchidos produzem termo completo; saldo negativo sempre permanece minuta", () => {
  const positive = calculateDistrato({ ...input, fruitionMonths: 0, municipalTaxes: 0 }, value(224785.98), [value(77902.84, "parcela-1")]);
  const completed = { ...input, sellerDocument: "documento informado", sellerAddress: "Rua Exemplo", sellerRepresentative: "Representante", buyerDocument: "documento informado", buyerQualification: "qualificação informada", buyerAddress: "Rua Exemplo", registration: "123", registryOffice: "Cartório", reason: "Pedido do comprador", possession: "Posse não transmitida", refundTerms: "À vista em 30/10/2026", city: "Sinop/MT" };
  const { draft, term } = distratoTerm(completed, unit, positive);
  assert.equal(draft, false); assert.doesNotMatch(term, /\[[^\]]+\]/);
});
