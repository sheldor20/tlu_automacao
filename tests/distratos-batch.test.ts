import assert from "node:assert/strict";
import test from "node:test";
import { calculateDistrato, distratoTerm, type DistratoInput, type DistratoDocument, type DistratoUnit } from "../lib/distratos.ts";
import { consolidateDistratos, consolidatedCsv, createGenerationLedger, generateContractBatch, type GenerationInput } from "../lib/distratos-batch.ts";

const actor = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
function input(contractId = "20|033|001"): GenerationInput {
  return { contractId, sourceRevision: "a".repeat(64), regime: "com_lei", correctionDate: "2026-10-22", saleDate: "2025-01-10", saleValue: 100000, fruitionMonths: 1, brokerage: 0, municipalTaxes: 0, sellerDocument: "", sellerAddress: "", sellerRepresentative: "", buyerDocument: "", buyerQualification: "", buyerAddress: "", registration: "", registryOffice: "", reason: "", possession: "", refundTerms: "", city: "", notes: "" };
}
function document(body: DistratoInput = { ...input(), requestId }, paid = 40000, actorId = actor): DistratoDocument {
  const receipt = { id: `payment:${body.contractId}`, date: body.saleDate, amount: paid, description: "Parcela fictícia" };
  const unit: DistratoUnit = { contractId: body.contractId, contractNumber: body.contractId.split("|").at(-1)!, companyId: "20", companyName: "Empresa fictícia", workKey: "20|033", workCode: "033", workName: "Obra fictícia", block: "007", lot: "003", buyerName: "Pessoa Exemplo", synchronizedAt: "2026-10-22T09:00:00Z", receipts: [receipt] };
  const property = { id: "imovel", date: body.saleDate, original: body.saleValue, corrected: body.saleValue, factor: 1, indices: [] };
  const value = { id: receipt.id, date: receipt.date, original: paid, corrected: paid, factor: 1, indices: [] };
  const calculation = calculateDistrato(body, property, [value]);
  return { id: body.requestId, created_at: "2026-10-22T10:00:00Z", created_by: actorId, input: body, unit, calculation, correction: { source: "fixture", index: "INPC", interest: 0, referenceDate: body.correctionDate, availableThrough: "09/2026", values: [property, value] }, ...distratoTerm(body, unit, calculation) };
}
function journal() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test("cada contrato mantém preço, data, regra, fruição e pagamentos próprios mesmo com o mesmo nome/lote", async () => {
  const store = journal();
  const seen: DistratoInput[] = [];
  const generate = createGenerationLedger({ journal: () => store, execute: async body => { seen.push(body); return document(body, body.contractId.endsWith("001") ? 40000 : 500); } });
  const a = input();
  const b = { ...input("20|033|002"), saleDate: "2024-08-02", saleValue: 250000, regime: "sem_lei" as const, fruitionMonths: 9, brokerage: 300, municipalTaxes: 80 };
  const docs = await Promise.all([generate(actor, a), generate(actor, b)]);
  assert.deepEqual(seen.map(body => { const copy = { ...body }; Reflect.deleteProperty(copy, "requestId"); return copy; }), [a, b]);
  assert.equal(docs[0].calculation.refund, 29250);
  assert.equal(docs[1].calculation.refund, 0);
  assert.equal(docs[1].calculation.balance, -47430);
  assert.match(docs[0].term, /nº 001/);
  assert.match(docs[1].term, /nº 002/);
  const summary = consolidateDistratos([a.contractId, b.contractId], new Map(docs.map(d => [d.unit.contractId, d])));
  assert.equal(summary.refund, 29250, "saldo negativo de outro contrato não compensa a restituição");
  assert.equal(summary.correctedPaid, 40500);
  assert.equal(summary.totalDeductions, 58680);
});

test("seleção repetida e titulares do mesmo contrato geram um documento por ID exato", async () => {
  const ids = ["20|033|001", "20|033|001", "20|033|01"];
  const called: string[] = [];
  const result = await generateContractBatch({ contractIds: ids, cancelled: () => false, generate: async id => { called.push(id); return document({ ...input(id), requestId }); } });
  assert.deepEqual(called, [ids[0], ids[2]]);
  assert.equal(result.length, 2);
  const summary = consolidateDistratos(ids, new Map(result.map(r => [r.contractId, r.document!])));
  assert.equal(summary.rows.length, 2);
  assert.equal(summary.refund, 58500);
});

test("remover contratos e selecionar nenhum exclui seus documentos e totais; nova seleção não herda valores", () => {
  const a = document(); const b = document({ ...input("20|033|002"), requestId }, 20000);
  const documents = new Map([a, b].map(d => [d.unit.contractId, d]));
  assert.equal(consolidateDistratos([a.unit.contractId], documents).refund, a.calculation.refund);
  assert.equal(consolidateDistratos([], documents).refund, 0);
  assert.deepEqual(consolidateDistratos(["outro-lote"], documents).missing, ["outro-lote"]);
  assert.equal(consolidateDistratos(["outro-lote"], documents).rows.length, 0);
});

test("documento de outro contrato e recebimentos duplicados bloqueiam consolidação", () => {
  const a = document(); const b = document({ ...input("20|033|002"), requestId });
  assert.throws(() => consolidateDistratos(["outro"], new Map([["outro", a]])), /outro contrato/);
  b.unit.receipts = [...a.unit.receipts];
  assert.throws(() => consolidateDistratos([a.unit.contractId, b.unit.contractId], new Map([a, b].map(d => [d.unit.contractId, d]))), /Recebimento repetido/);
  a.unit.receipts.push(a.unit.receipts[0]);
  assert.throws(() => consolidateDistratos([a.unit.contractId], new Map([[a.unit.contractId, a]])), /Recebimento repetido/);
});

test("repetição concorrente e retorno à seleção reutilizam a geração confirmada", async () => {
  const store = journal(); let calls = 0;
  const generate = createGenerationLedger({ journal: () => store, execute: async body => { calls++; return document(body); } });
  const [a, b] = await Promise.all([generate(actor, input()), generate(actor, input())]);
  assert.equal(a.id, b.id); assert.equal(calls, 1);
  assert.equal((await generate(actor, input())).id, a.id); assert.equal(calls, 1);
  assert.equal(store.values.size, 1);
  assert.doesNotMatch(JSON.stringify([...store.values]), /Pessoa|saleValue|100000|20\|033/);
});

test("resposta incerta após gravação e reload preservam requestId; servidor recupera documento sem duplicar", async () => {
  const store = journal(); const saved = new Map<string, DistratoDocument>(); let calls = 0; let writes = 0;
  const execute = async (body: DistratoInput) => {
    calls++;
    let result = saved.get(body.requestId);
    if (!result) { result = document(body); saved.set(body.requestId, result); writes++; }
    if (calls === 1) throw new Error("Resposta perdida após gravar");
    return result;
  };
  const first = createGenerationLedger({ journal: () => store, execute });
  await assert.rejects(first(actor, input()), /Resposta perdida/);
  const reloaded = createGenerationLedger({ journal: () => store, execute });
  const recovered = await reloaded(actor, input());
  assert.equal(recovered.id, [...saved.keys()][0]); assert.equal(calls, 2); assert.equal(writes, 1);
});

test("mudança de campos, publicação da base ou ator exige requestId distinto; retorno ao original o preserva", async () => {
  const store = journal();
  let expectedActor = actor;
  const generate = createGenerationLedger({ journal: () => store, execute: async body => document(body, 40000, expectedActor) });
  const a = await generate(actor, input());
  const b = await generate(actor, { ...input(), brokerage: 500 });
  const c = await generate(actor, { ...input(), sourceRevision: "b".repeat(64) });
  expectedActor = "33333333-3333-4333-8333-333333333333";
  const d = await generate(expectedActor, input());
  assert.equal(new Set([a.id, b.id, c.id, d.id]).size, 4);
  assert.equal((await generate(actor, input())).id, a.id);
});

test("sem usuário, armazenamento de retomada ou dados válidos não envia POST", async () => {
  let calls = 0;
  const generate = createGenerationLedger({ journal: () => { throw new Error("indisponível"); }, execute: async body => { calls++; return document(body); } });
  await assert.rejects(generate("", input()), /Entre novamente/);
  await assert.rejects(generate(actor, { ...input(), saleValue: 0 }));
  await assert.rejects(generate(actor, input()), /armazenamento desta aba/);
  assert.equal(calls, 0);
});

test("retorno de contrato, ator, revisão ou requestId incorreto não entra no resumo/cache", async () => {
  for (const mismatch of ["contract", "actor", "revision", "request"]) {
    let calls = 0;
    const generate = createGenerationLedger({ journal: () => journal(), execute: async body => {
      calls++; const result = document(body);
      if (mismatch === "contract") result.unit.contractId = "outro";
      if (mismatch === "actor") result.created_by = "outro";
      if (mismatch === "revision") result.input.sourceRevision = "b".repeat(64);
      if (mismatch === "request") result.input.requestId = actor;
      return result;
    } });
    await assert.rejects(generate(actor, input()), /não corresponde/);
    await assert.rejects(generate(actor, input()), /não corresponde/);
    assert.equal(calls, 2);
  }
});

test("cancelamento espera o contrato corrente e não inicia os demais; retomada não duplica concluídos", async () => {
  const store = journal(); let cancelled = false; let calls = 0;
  const generate = createGenerationLedger({ journal: () => store, execute: async body => { calls++; cancelled = true; return document(body); } });
  const ids = ["A", "B", "C"];
  const first = await generateContractBatch({ contractIds: ids, cancelled: () => cancelled, generate: id => generate(actor, input(id)) });
  assert.deepEqual(first.map(r => r.status), ["generated", "cancelled", "cancelled"]);
  assert.equal(calls, 1);
  const second = await generateContractBatch({ contractIds: ids, cancelled: () => false, generate: id => generate(actor, input(id)) });
  assert.deepEqual(second.map(r => r.status), ["generated", "generated", "generated"]);
  assert.equal(calls, 3);
  assert.equal(first[0].document!.id, second[0].document!.id);
});

test("cancelamento antes do início e seleção vazia não geram documentos", async () => {
  let calls = 0;
  const generate = async (id: string) => { calls++; return document({ ...input(id), requestId }); };
  assert.deepEqual(await generateContractBatch({ contractIds: [], cancelled: () => false, generate }), []);
  assert.equal((await generateContractBatch({ contractIds: ["A"], cancelled: () => true, generate }))[0].status, "cancelled");
  assert.equal(calls, 0);
});

test("falha parcial preserva sucesso anterior e posterior; retry reutiliza chave e não duplica", async () => {
  const store = journal(); const calls: string[] = []; let failed = false;
  const generate = createGenerationLedger({ journal: () => store, execute: async body => { calls.push(body.contractId); if (body.contractId === "B" && !failed) { failed = true; throw new Error("Fonte indisponível"); } return document(body); } });
  const run = () => generateContractBatch({ contractIds: ["A", "B", "C"], cancelled: () => false, generate: id => generate(actor, input(id)) });
  const first = await run();
  assert.deepEqual(first.map(r => r.status), ["generated", "failed", "generated"]);
  assert.match(first[1].error!, /Fonte indisponível/);
  const second = await run();
  assert.ok(second.every(r => r.status === "generated"));
  assert.deepEqual(calls, ["A", "B", "C", "B"]);
  assert.equal(store.values.size, 3);
});

test("CSV exporta somente a seleção completa, códigos e documentos individuais, sem total de imóvel/fruição", () => {
  const a = document(); const b = document({ ...input("20|033|002"), requestId }, 100);
  a.unit.buyerName = '=HYPERLINK("https://exemplo.invalid")';
  const documents = new Map([a, b].map(d => [d.unit.contractId, d]));
  const csv = consolidatedCsv(consolidateDistratos([a.unit.contractId], documents));
  assert.match(csv, /"001"/); assert.match(csv, /"'\=HYPERLINK/);
  assert.doesNotMatch(csv, /20\|033\|002/);
  assert.equal(csv.split("\r\n").length, 3);
  assert.match(csv, /"TOTAL".*"40000,00";"40000,00";"10750,00";"";"29250,00"/);
  assert.throws(() => consolidatedCsv(consolidateDistratos(["missing"], documents)), /todos os contratos/);
  assert.throws(() => consolidatedCsv(consolidateDistratos([], documents)), /todos os contratos/);
});

test("consolidação soma centavos sem resíduo binário", () => {
  const a = document(); const b = document({ ...input("B"), requestId });
  a.calculation.refund = .1; b.calculation.refund = .2;
  assert.equal(consolidateDistratos([a.unit.contractId, "B"], new Map([a, b].map(d => [d.unit.contractId, d]))).refund, .3);
});

test("CSV distingue venda consultada da base usada, sem inventar zero para origem ausente", () => {
  const a = document({ ...input(), saleValue: 110000, requestId });
  const summary = consolidateDistratos([a.unit.contractId], new Map([[a.unit.contractId, a]]));
  const csv = consolidatedCsv(summary, new Map([[a.unit.contractId, { saleDate: "2025-01-10", saleValue: 100000, label: "Fonte fictícia" }]]));
  assert.match(csv, /"100000,00";"Fonte fictícia";"2025-01-10";"110000,00"/);
  const missing = consolidatedCsv(summary);
  assert.match(missing, /"Não confirmado";"Não confirmado";"Não confirmada";"2025-01-10";"110000,00"/);
  a.unit.buyerName = "  =FORMULA()";
  assert.match(consolidatedCsv(summary), /"'  =FORMULA\(\)"/);
});
