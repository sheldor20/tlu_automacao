import test from "node:test";
import assert from "node:assert/strict";
import {
  paymentCreateSchema,
  paymentActionSchema,
  detailsTotal,
  validTaxId,
  PAYMENT_TRANSITIONS,
  CLOSED_PAYMENT_STATUSES,
  PAYMENT_STATUSES,
  requiresPaymentReceipt,
  paymentMoney,
  terminationTotal,
} from "../lib/payment-requests.ts";

const input = () => ({
  submission_id: "00000000-0000-4000-8000-000000000001",
  requester_name: "Solicitante de teste",
  requester_email: "requester@example.com",
  company_key: "EMPRESA",
  title: "Serviço de manutenção",
  description: "Manutenção na unidade.",
  amount: 120.5,
  budget_max: 150,
  due_date: "2026-09-20",
  beneficiary: {
    person_type: "PF",
    name: "Beneficiário de teste",
    tax_id: "529.982.247-25",
    method: "pix",
    pix_key: "beneficiary@example.com",
  },
  details: {
    type: "service",
    scope: "Conserto da porta",
    service_date: "2026-09-16",
    document_type: "RPA",
  },
});

test("validates a service request and normalizes requester email", () => {
  const result = paymentCreateSchema.parse({
    ...input(),
    requester_email: "REQUESTER@example.com",
  });
  assert.equal(result.requester_email, "requester@example.com");
  assert.equal(result.details.type, "service");
});
test("CPF and CNPJ require correct check digits, with no repeated-digit bypass", () => {
  assert.equal(validTaxId("529.982.247-25", "PF"), true);
  assert.equal(validTaxId("529.982.247-24", "PF"), false);
  assert.equal(validTaxId("111.111.111-11", "PF"), false);
  assert.equal(validTaxId("01.872.837/0001-93", "PJ"), true);
  assert.equal(validTaxId("01.872.837/0001-94", "PJ"), false);
  assert.equal(validTaxId("00.000.000/E08G-12", "PJ"), true);
  assert.equal(validTaxId("00.000.000/E08G-13", "PJ"), false);
  assert.equal(validTaxId("529a98224725", "PF"), false);
});
test("bank transfer cannot omit beneficiary bank details", () => {
  const data = input();
  data.beneficiary.method = "transfer";
  assert.equal(paymentCreateSchema.safeParse(data).success, false);
});
test("invalid dates, negative values, fractions of cents, empty descriptions and honeypot fail", () => {
  for (const delta of [
    { due_date: "2026-02-30" },
    { amount: -1 },
    { amount: 0 },
    { amount: null },
    { amount: undefined },
    { beneficiary: undefined },
    { amount: 1.005 },
    { description: " " },
    { website: "spam" },
  ])
    assert.equal(
      paymentCreateSchema.safeParse({ ...input(), ...delta }).success,
      false,
    );
});
test("budget maximum supports zero and remains distinct from no budget", () => {
  assert.equal(
    paymentCreateSchema.parse({ ...input(), budget_max: 0 }).budget_max,
    0,
  );
  assert.equal(
    paymentCreateSchema.parse({ ...input(), budget_max: null }).budget_max,
    null,
  );
});
test("material amount must equal rounded line totals", () => {
  const details = {
    type: "materials" as const,
    delivery_address: "Almoxarifado",
    items: [
      { description: "Areia", quantity: 1.5, unit: "m³", unit_price: 15.25 },
      { description: "Cimento", quantity: 2, unit: "saco", unit_price: 25 },
    ],
  };
  assert.equal(detailsTotal(details), 72.88);
  assert.equal(
    paymentCreateSchema.safeParse({ ...input(), details, amount: 72.88 })
      .success,
    true,
  );
  assert.equal(
    paymentCreateSchema.safeParse({ ...input(), details, amount: 72.87 })
      .success,
    false,
  );
  assert.equal(
    paymentCreateSchema.safeParse({
      ...input(),
      details: { ...details, items: [] },
    }).success,
    false,
  );
});
test("termination subtracts legal expenses and customer IPTU is not deducted", () => {
  const details = {
    type: "termination" as const,
    cancellation_date: "2026-09-10",
    reason: "Cancelamento contratual",
    construction_delay: false,
    customer_name: "Cliente de teste",
    contract: "Contrato 1",
    iptu_responsibility: "customer",
    restitution: 100,
    iptu: 20,
    legal_fees: 30,
    court_costs: 40,
    damages: 10,
    document_type: "Distrato",
  };
  assert.equal(
    paymentCreateSchema.safeParse({ ...input(), details, amount: 20 }).success,
    true,
  );
  assert.equal(paymentCreateSchema.parse({
    ...input(), details: { ...details, contract: undefined }, amount: 20,
  }).details.type, "termination");
  assert.equal(
    paymentCreateSchema.safeParse({ ...input(), details, amount: 200 }).success,
    false,
  );
  assert.equal(
    paymentCreateSchema.safeParse({
      ...input(),
      details: { ...details, cancellation_date: "" },
      amount: 20,
    }).success,
    false,
  );
  for (const iptu_responsibility of ["not_applicable", "", undefined])
    assert.equal(paymentCreateSchema.safeParse({
      ...input(), details: { ...details, iptu_responsibility }, amount: 20,
    }).success, false);
  assert.equal(paymentCreateSchema.safeParse({
    ...input(), details: { ...details, iptu_responsibility: "company" }, amount: 0,
  }).success, false);
  assert.equal(paymentCreateSchema.safeParse({
    ...input(), details: { ...details, legal_fees: 200 }, amount: -150,
  }).success, false);
});
test("termination preview and saved total deduct IPTU only when the company is responsible", () => {
  const amounts = { restitution: 1000, iptu: 80, legal_fees: 100, court_costs: 50, damages: 25 };
  assert.equal(terminationTotal({ ...amounts, iptu_responsibility: "company" }), 745);
  assert.equal(terminationTotal({ ...amounts, iptu_responsibility: "customer" }), 825);
  assert.equal(terminationTotal({ restitution: 100.1, iptu: 0.02, legal_fees: 30.03, court_costs: 40.04, damages: 10.01, iptu_responsibility: "company" }), 20);
});
test("materials allow unknown prices, beneficiary and payment method without inventing zero", () => {
  const details = {
    type: "materials" as const, delivery_address: "Almoxarifado",
    items: [{ description: "Cimento", quantity: 2, unit: "saco" }],
  };
  const result = paymentCreateSchema.parse({
    ...input(), amount: undefined, beneficiary: undefined, details,
  });
  assert.equal(result.amount, null);
  assert.equal(result.beneficiary.name, "");
  assert.equal(result.beneficiary.method, "");
  assert.equal(detailsTotal(result.details), null);
  assert.equal(paymentMoney(result.amount), "A definir");
  assert.notEqual(paymentMoney(0), "A definir");
  assert.equal(paymentCreateSchema.safeParse({
    ...input(), amount: null, beneficiary: { name: "Fornecedor a confirmar" }, details,
  }).success, true);
  assert.equal(paymentCreateSchema.safeParse({
    ...input(), amount: null, beneficiary: { tax_id: "11111111111" }, details,
  }).success, false);
});
test("partial material prices do not produce a misleading total; entered amounts stay validated", () => {
  const details = {
    type: "materials" as const, delivery_address: "Almoxarifado",
    items: [
      { description: "Areia", quantity: 2, unit: "m³", unit_price: 10 },
      { description: "Cimento", quantity: 2, unit: "saco", unit_price: null },
    ],
  };
  assert.equal(detailsTotal(details), null);
  assert.equal(paymentCreateSchema.safeParse({ ...input(), details, amount: null }).success, true);
  assert.equal(paymentCreateSchema.safeParse({ ...input(), details, amount: 20 }).success, false);
  for (const price of [-1, 1.005, Number.NaN])
    assert.equal(paymentCreateSchema.safeParse({
      ...input(), details: { ...details, items: [{ ...details.items[0], unit_price: price }] }, amount: null,
    }).success, false);
  assert.equal(paymentCreateSchema.safeParse({
    ...input(), details: { ...details, items: [{ ...details.items[0], unit_price: 0 }] }, amount: 0,
  }).success, true);
});
test("receipt remains mandatory only for services and terminations", () => {
  assert.equal(requiresPaymentReceipt("materials"), false);
  assert.equal(requiresPaymentReceipt("bills"), false);
  assert.equal(requiresPaymentReceipt("service"), true);
  assert.equal(requiresPaymentReceipt("termination"), true);
});
test("bill requests require issuer and reference", () => {
  const details = {
    type: "bills",
    issuer: "Concessionária",
    reference: "09/2026",
    document_type: "Boleto",
  };
  assert.equal(
    paymentCreateSchema.safeParse({ ...input(), details }).success,
    true,
  );
  assert.equal(
    paymentCreateSchema.safeParse({
      ...input(),
      details: { ...details, issuer: "" },
    }).success,
    false,
  );
});
test("status changes require explanatory messages and schedule when applicable", () => {
  assert.equal(
    paymentActionSchema.safeParse({ action: "request_info", version: 1 })
      .success,
    false,
  );
  assert.equal(
    paymentActionSchema.safeParse({
      action: "status",
      status: "rejected",
      version: 1,
    }).success,
    false,
  );
  assert.equal(
    paymentActionSchema.safeParse({
      action: "status",
      status: "scheduled",
      version: 1,
    }).success,
    false,
  );
  assert.equal(
    paymentActionSchema.safeParse({
      action: "status",
      status: "scheduled",
      scheduled_date: "2026-09-20",
      version: 1,
    }).success,
    true,
  );
  assert.equal(
    paymentActionSchema.safeParse({
      action: "reply",
      message: "Documento anexado",
      version: 1,
    }).success,
    true,
  );
});
test("closed requests have no transitions and received requests cannot skip approval", () => {
  for (const status of ["finalized", "rejected", "cancelled"] as const)
    assert.deepEqual(PAYMENT_TRANSITIONS[status], []);
  assert.equal(PAYMENT_TRANSITIONS.submitted.includes("paid"), false);
  assert.equal(PAYMENT_TRANSITIONS.submitted.includes("approved"), false);
  assert.equal(PAYMENT_TRANSITIONS.approved.includes("paid"), true);
});
test("only paid requests can be finalized and finalized requests remain read-only", () => {
  assert.equal(PAYMENT_STATUSES.finalized, "Finalizado");
  assert.deepEqual(PAYMENT_TRANSITIONS.paid, ["finalized"]);
  for (const [status, transitions] of Object.entries(PAYMENT_TRANSITIONS))
    if (status !== "paid") assert.equal(transitions.includes("finalized"), false);
  assert.ok(CLOSED_PAYMENT_STATUSES.includes("paid"));
  assert.ok(CLOSED_PAYMENT_STATUSES.includes("finalized"));
  assert.equal(paymentActionSchema.safeParse({
    action: "status", status: "finalized", version: 6,
  }).success, true);
});
