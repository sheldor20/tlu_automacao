import test from "node:test";
import assert from "node:assert/strict";
import {
  paymentCreateSchema,
  paymentActionSchema,
  detailsTotal,
  validTaxId,
  PAYMENT_TRANSITIONS,
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
test("termination matches all five components from the source template", () => {
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
    paymentCreateSchema.safeParse({ ...input(), details, amount: 200 }).success,
    true,
  );
  assert.equal(
    paymentCreateSchema.safeParse({ ...input(), details, amount: 199 }).success,
    false,
  );
  assert.equal(
    paymentCreateSchema.safeParse({
      ...input(),
      details: { ...details, cancellation_date: "" },
      amount: 200,
    }).success,
    false,
  );
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
  for (const status of ["paid", "rejected", "cancelled"] as const)
    assert.deepEqual(PAYMENT_TRANSITIONS[status], []);
  assert.equal(PAYMENT_TRANSITIONS.submitted.includes("paid"), false);
  assert.equal(PAYMENT_TRANSITIONS.submitted.includes("approved"), false);
  assert.equal(PAYMENT_TRANSITIONS.approved.includes("paid"), true);
});
