import { z } from "zod";

export const PAYMENT_TYPES = {
  service: "Serviço",
  materials: "Materiais e insumos",
  termination: "Distrato",
  bills: "Boletos e contas",
} as const;
export const PAYMENT_STATUSES = {
  submitted: "Recebida",
  reviewing: "Em análise",
  awaiting_information: "Aguardando informações",
  approved: "Aprovada",
  scheduled: "Agendada",
  paid: "Paga",
  finalized: "Finalizado",
  rejected: "Recusada",
  cancelled: "Cancelada",
} as const;
export type PaymentStatus = keyof typeof PAYMENT_STATUSES;
export type PaymentType = keyof typeof PAYMENT_TYPES;
export function requiresPaymentReceipt(type: PaymentType) {
  return type === "service" || type === "termination";
}
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  submitted: ["reviewing", "awaiting_information", "rejected", "cancelled"],
  reviewing: ["awaiting_information", "approved", "rejected", "cancelled"],
  awaiting_information: ["reviewing", "rejected", "cancelled"],
  approved: ["scheduled", "paid", "awaiting_information", "cancelled"],
  scheduled: ["paid", "awaiting_information", "cancelled"],
  paid: ["finalized"],
  finalized: [],
  rejected: [],
  cancelled: [],
};
export const CLOSED_PAYMENT_STATUSES: PaymentStatus[] = [
  "paid",
  "finalized",
  "rejected",
  "cancelled",
];
export const PAYMENT_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
export const PAYMENT_FILE_MAX = 10 * 1024 * 1024;
export const PAYMENT_BUCKET = "payment-documents";
const text = (max = 500) => z.string().trim().max(max);
const required = (max = 500) => text(max).min(1, "Preencha este campo.");
const money = z
  .number()
  .finite()
  .min(0)
  .max(999_999_999.99)
  .refine(
    (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001,
    "Use no máximo duas casas decimais.",
  );
const date = z.iso.date();

export function validTaxId(value: string, personType: "PF" | "PJ") {
  const digits = value.replace(/[.\/\-\s]/g, "").toUpperCase();
  if (/^(\d)\1+$/.test(digits)) return false;
  const check = (base: string, weights: number[]) => {
    const remainder =
      [...base].reduce(
        (sum, digit, i) => sum + (digit.charCodeAt(0) - 48) * weights[i],
        0,
      ) % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  if (personType === "PF")
    return (
      /^\d{11}$/.test(digits) &&
      check(digits.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]) ===
        Number(digits[9]) &&
      check(digits.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) ===
        Number(digits[10])
    );
  // Receita Federal: the first twelve positions may be alphanumeric; DV uses ASCII minus 48.
  return (
    /^[A-Z0-9]{12}\d{2}$/.test(digits) &&
    check(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) ===
      Number(digits[12]) &&
    check(digits.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) ===
      Number(digits[13])
  );
}

const beneficiaryFieldsSchema = z
  .object({
    person_type: z.enum(["PF", "PJ"]).default("PF"),
    name: text(200).default(""),
    tax_id: text(30).default(""),
    email: z.union([z.email(), z.literal("")]).default(""),
    phone: text(40).default(""),
    method: z.enum(["", "pix", "transfer", "boleto", "guide", "other"]).default(""),
    pix_key: text(200).default(""),
    bank: text(100).default(""),
    branch: text(30).default(""),
    account: text(50).default(""),
    account_holder: text(200).default(""),
  });
const optionalBeneficiarySchema = beneficiaryFieldsSchema
  .superRefine((b, ctx) => {
    if (b.tax_id && !validTaxId(b.tax_id, b.person_type))
      ctx.addIssue({
        code: "custom",
        path: ["tax_id"],
        message: `Informe um ${b.person_type === "PF" ? "CPF" : "CNPJ"} válido.`,
      });
    if (b.method === "pix" && !b.pix_key)
      ctx.addIssue({
        code: "custom",
        path: ["pix_key"],
        message: "Informe a chave PIX.",
      });
    if (
      b.method === "transfer" &&
      (!b.bank || !b.branch || !b.account || !b.account_holder)
    )
      ctx.addIssue({
        code: "custom",
        path: ["bank"],
        message: "Preencha banco, agência, conta e titular.",
      });
  });
export const beneficiarySchema = optionalBeneficiarySchema.superRefine((b, ctx) => {
  for (const [key, message] of [
    ["name", "Informe o nome do beneficiário."],
    ["tax_id", "Informe o CPF ou CNPJ do beneficiário."],
    ["method", "Informe a forma de pagamento."],
  ] as const)
    if (!b[key]) ctx.addIssue({ code: "custom", path: [key], message });
});
export const paymentDetailsSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("service"),
    scope: required(5000),
    service_date: date,
    document_type: required(100),
  }),
  z.object({
    type: z.literal("materials"),
    delivery_address: required(1000),
    items: z
      .array(
        z.object({
          description: required(500),
          quantity: z.number().positive().max(1_000_000),
          unit: required(30),
          unit_price: money.nullable().default(null),
        }),
      )
      .min(1)
      .max(100),
  }),
  z.object({
    type: z.literal("termination"),
    cancellation_date: date,
    reason: required(1000),
    construction_delay: z.boolean(),
    customer_name: required(200),
    contract: text(200).default(""),
    lot: text(100).default(""),
    block: text(100).default(""),
    lawsuit: text(200).default(""),
    iptu_responsibility: z.enum(["company", "customer"]),
    restitution: money,
    iptu: money,
    legal_fees: money,
    court_costs: money,
    damages: money,
    document_type: required(100),
  }),
  z.object({
    type: z.literal("bills"),
    issuer: required(200),
    document_type: required(100),
    reference: required(200),
    barcode: text(100).default(""),
  }),
]);
export const paymentCreateSchema = z
  .object({
    submission_id: z.uuid(),
    requester_name: required(200),
    requester_email: z.email().toLowerCase(),
    requester_phone: text(40).default(""),
    company_key: required(500),
    project_name: text(300).default(""),
    title: required(180),
    description: required(8000),
    amount: money.nullable().default(null),
    budget_max: money.nullable(),
    due_date: date,
    quotes: z
      .array(
        z.object({
          supplier: required(200),
          amount: money,
          notes: text(2000).default(""),
        }),
      )
      .max(20)
      .default([]),
    beneficiary: beneficiaryFieldsSchema.default(beneficiaryFieldsSchema.parse({})),
    details: paymentDetailsSchema,
    website: z.literal("").default(""),
  })
  .superRefine((data, ctx) => {
    const materials = data.details.type === "materials";
    if (!materials && (data.amount === null || data.amount <= 0))
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Informe um valor maior que zero." });
    const beneficiary = (materials ? optionalBeneficiarySchema : beneficiarySchema).safeParse(data.beneficiary);
    if (!beneficiary.success)
      for (const issue of beneficiary.error.issues)
        ctx.addIssue({ ...issue, path: ["beneficiary", ...issue.path] });
    const total = detailsTotal(data.details);
    if (
      (total !== null && (data.amount === null || Math.abs(total - data.amount) > 0.005)) ||
      (materials && total === null && data.amount !== null)
    )
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: "O valor deve corresponder ao cálculo do formulário.",
      });
  });
export type PaymentInput = z.infer<typeof paymentCreateSchema>;
export type PaymentDetails = z.infer<typeof paymentDetailsSchema>;
export function terminationTotal(details: Pick<Extract<PaymentDetails, { type: "termination" }>,
  "restitution" | "iptu" | "legal_fees" | "court_costs" | "damages" | "iptu_responsibility"
>) {
  const cents = (value: number) => Math.round(value * 100);
  return (cents(details.restitution) - cents(details.legal_fees) -
    cents(details.court_costs) - cents(details.damages) -
    (details.iptu_responsibility === "company" ? cents(details.iptu) : 0)) / 100;
}
export function detailsTotal(details: PaymentDetails) {
  if (details.type === "termination")
    return terminationTotal(details);
  if (details.type === "materials") {
    if (details.items.some((item) => item.unit_price === null)) return null;
    return (
      details.items.reduce(
        (sum, item) => sum + Math.round(item.quantity * (item.unit_price ?? 0) * 100),
        0,
      ) / 100
    );
  }
  return null;
}
export type PaymentRequest = Omit<PaymentInput, "website" | "submission_id"> & {
  id: string;
  protocol: number;
  type: PaymentType;
  company_name: string;
  status: PaymentStatus;
  source: string;
  requester_user_id: string | null;
  scheduled_date: string | null;
  paid_at: string | null;
  finalized_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};
export type PaymentFile = {
  id: string;
  name: string;
  kind: "support" | "quote" | "receipt";
  size: number;
  created_at: string;
  ready: boolean;
};
export type PaymentEvent = {
  id: string;
  kind: string;
  message: string;
  status: PaymentStatus;
  created_at: string;
  actor_name: string;
};
export const paymentActionSchema = z
  .object({
    action: z.enum(["status", "request_info", "reply"]),
    version: z.number().int().nonnegative(),
    status: z
      .enum(
        Object.keys(PAYMENT_STATUSES) as [PaymentStatus, ...PaymentStatus[]],
      )
      .optional(),
    message: text(5000).default(""),
    scheduled_date: date.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.action === "status" && !data.status)
      ctx.addIssue({ code: "custom", message: "Selecione o status." });
    if (
      (data.action !== "status" ||
        ["rejected", "cancelled", "awaiting_information"].includes(
          data.status || "",
        )) &&
      !data.message
    )
      ctx.addIssue({
        code: "custom",
        message: "Explique a atualização ao solicitante.",
      });
    if (data.status === "scheduled" && !data.scheduled_date)
      ctx.addIssue({ code: "custom", message: "Informe a data de pagamento." });
  });
export function paymentProtocol(protocol: number) {
  return `PAG-${String(protocol).padStart(6, "0")}`;
}
export function paymentMoney(value: number | null) {
  if (value === null) return "A definir";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}
