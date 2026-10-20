import { z } from "zod";

export const CONTRACT_TYPES = { rental: "Locação comercial", services: "Prestação de serviços", purchase: "Compra e venda", amendment: "Aditivo contratual", termination: "Distrato contratual", other: "Outro" } as const;
export const CONTRACT_STATUSES = { in_progress: "Em andamento", finalizing: "Finalizando", missing_information: "Falta informações" } as const;
export type ContractStatus = keyof typeof CONTRACT_STATUSES;
export type ContractType = keyof typeof CONTRACT_TYPES;
export const contractProtocol = (n: number) => `CON-${String(n).padStart(6, "0")}`;
const text = (max = 2000) => z.string().trim().max(max);
const required = (max = 2000) => text(max).min(1, "Preencha os campos obrigatórios.");
const date = z.union([z.iso.date(), z.literal("")]);
export const contractDetailsSchema = z.object({
  type: z.enum(Object.keys(CONTRACT_TYPES) as [ContractType, ...ContractType[]]),
  other_type: text(200).default(""),
  title: required(200), company_name: required(200),
  party_a_name: required(200), party_a_tax_id: required(30), party_a_address: required(600),
  party_a_qualification: text(1000).default(""), party_a_representative: text(1000).default(""),
  party_b_name: required(200), party_b_tax_id: required(30), party_b_address: required(600),
  party_b_qualification: text(1000).default(""), party_b_representative: text(1000).default(""),
  contact_email: z.union([z.email(), z.literal("")]).default(""), contact_phone: text(40).default(""),
  object: required(4000), amount: z.number().finite().min(0).max(999999999.99).nullable().default(null),
  payment_terms: text(2000).default(""), start_date: date.default(""), end_date: date.default(""),
  deadline: date.default(""), notes: text(6000).default(""),
  original_contract: text(1000).default(""),
  property_address: text(600).default(""), property_registration: text(200).default(""),
  purpose: text(1000).default(""), term_months: z.number().int().min(1).max(1200).nullable().default(null),
  first_payment: date.default(""), due_day: z.number().int().min(1).max(31).nullable().default(null),
  grace_period: text(300).default(""), adjustment_index: text(200).default(""),
  bank_details: text(2000).default(""), renewal: text(1000).default(""), guarantee: text(1000).default(""),
  jurisdiction: text(200).default(""), signature_city: text(200).default(""), signature_date: date.default(""),
  witnesses: text(1000).default(""),
}).superRefine((v, ctx) => {
  const add = (field: string, message: string) => ctx.addIssue({ code: "custom", path: [field], message });
  if (v.start_date && v.end_date && v.end_date < v.start_date) add("end_date", "O término deve ser igual ou posterior ao início.");
  if (v.type === "rental") {
    if (!v.property_address) add("property_address", "Informe o endereço do imóvel.");
    if (!v.start_date || !v.end_date || !v.term_months) add("start_date", "Informe início, término e prazo da locação.");
    if (v.amount === null || v.amount <= 0) add("amount", "Informe o valor mensal do aluguel.");
    if (!v.due_day || !v.first_payment) add("first_payment", "Informe o primeiro pagamento e o dia de vencimento.");
  }
  if (v.type === "other" && !v.other_type) add("other_type", "Descreva o tipo de contrato.");
  if (["amendment", "termination"].includes(v.type) && !v.original_contract) add("original_contract", "Identifique o contrato original.");
});
export const contractCreateSchema = z.object({
  submission_id: z.uuid(), tracking_token: z.string().regex(/^[a-f0-9]{64}$/),
  requester_name: required(200), requester_email: z.email().max(320), details: contractDetailsSchema,
});
export const contractUpdateSchema = z.object({
  version: z.number().int().positive(),
  status: z.enum(Object.keys(CONTRACT_STATUSES) as [ContractStatus, ...ContractStatus[]]).optional(),
  message: text(6000).default(""), details: contractDetailsSchema.optional(),
}).refine(v => v.status || v.message || v.details, "Informe uma alteração ou mensagem.");
export type ContractDetails = z.infer<typeof contractDetailsSchema>;
export type ContractRequest = {
  id: string; protocol: number; requester_user_id: string | null; requester_name: string; requester_email: string;
  details: ContractDetails; status: ContractStatus; version: number; created_at: string; updated_at: string;
};
export type ContractEvent = { id: string; actor_name: string; message: string; status: ContractStatus; kind: string; created_at: string };
