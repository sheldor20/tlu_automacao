import test from "node:test";
import assert from "node:assert/strict";
import { contractDetailsSchema, contractCreateSchema, CONTRACT_STATUSES, type ContractRequest } from "../lib/contract-requests.ts";
import { contractDocumentText, wordDocument } from "../lib/contract-document.ts";

export const rental = contractDetailsSchema.parse({ type: "rental", title: "Locação do escritório", company_name: "Empresa solicitante",
  party_a_name: "Locador Teste", party_a_tax_id: "CPF A", party_a_address: "Rua do Locador, 10",
  party_b_name: "Locatária Teste", party_b_tax_id: "CNPJ B", party_b_address: "Rua da Locatária, 20",
  object: "Locação de escritório", property_address: "Rua do Imóvel, 30", amount: 4200,
  start_date: "2026-11-01", end_date: "2027-11-01", term_months: 12, due_day: 5, first_payment: "2026-12-05" });
export const sample: ContractRequest = { id: "11111111-1111-4111-8111-111111111111", protocol: 12, requester_user_id: null,
  requester_name: "Solicitante", requester_email: "test@example.test", details: rental, status: "in_progress", version: 1, created_at: "2026-10-20", updated_at: "2026-10-20" };

test("contratos validam dados condicionais, vigência e token", () => {
  assert.equal(Object.keys(CONTRACT_STATUSES).length, 3);
  assert.equal(contractDetailsSchema.safeParse({ ...rental, property_address: "" }).success, false);
  assert.equal(contractDetailsSchema.safeParse({ ...rental, end_date: "2025-01-01" }).success, false);
  assert.equal(contractDetailsSchema.safeParse({ ...rental, due_day: 32 }).success, false);
  assert.equal(contractDetailsSchema.safeParse({ ...rental, type: "amendment" }).success, false);
  assert.equal(contractDetailsSchema.safeParse({ ...rental, type: "other", other_type: "" }).success, false);
  assert.equal(contractDetailsSchema.safeParse({ ...rental, type: "services", property_address: "", amount: null, start_date: "", end_date: "" }).success, true);
  assert.equal(contractCreateSchema.safeParse({ details: rental, submission_id: sample.id, tracking_token: "x", requester_name: "A", requester_email: "test@example.test" }).success, false);
});
test("minuta contém as 14 cláusulas, os dados preenchidos e nenhum dado pessoal da base", () => {
  const text = contractDocumentText(sample);
  assert.equal((text.match(/CL[ÁA]USULA /g) || []).length, 14);
  for (const value of ["Locador Teste", "Locatária Teste", "Rua do Imóvel, 30", "4.200,00", "01/11/2026", "01/11/2027", "05/12/2026", "CON-000012", "[PREENCHER]"]) assert.ok(text.includes(value), value);
  for (const value of ["CARLOS HENRIQUE", "ANA CRISTINA", "123.375", "664.225", "13.051", "8672", "5.000,00", "19/10/2026", "Itumbiara", "{{"]) assert.ok(!text.includes(value), value);
  const other = contractDocumentText({ ...sample, details: { ...rental, type: "services" } });
  assert.ok(other.includes("não possui minuta padrão")); assert.ok(!other.includes("CLÁUSULA PRIMEIRA"));
});
test("documento Word escapa comandos e preserva acentos e Unicode", () => {
  const doc = wordDocument("Locação {\\object} 😀\nFinal");
  assert.ok(doc.startsWith("{\\rtf1")); assert.ok(doc.includes("\\{\\\\object\\}"));
  assert.ok(doc.includes("\\u231?")); assert.ok(doc.includes("\\u-10179?\\u-8704?")); assert.ok(doc.includes("\\par"));
});
