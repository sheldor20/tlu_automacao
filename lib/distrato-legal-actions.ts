import { z } from "zod";

export const legalActionStatuses = ["EM TRÂMITE", "CUMPRIMENTO DE SENTENÇA", "AGUARDANDO ARQUIVAMENTO", "ARQUIVADO"] as const;

export const legalActionFields = [
  { key: "work", label: "Nº da obra" },
  { key: "company", label: "Nº da empresa" },
  { key: "sale", label: "Nº da venda" },
  { key: "district", label: "Comarca", required: true },
  { key: "nature", label: "Natureza", required: true },
  { key: "summary", label: "Resumo da natureza" },
  { key: "court", label: "Vara" },
  { key: "plaintiff", label: "Autor", required: true },
  { key: "defendant", label: "Réu", required: true },
  { key: "companyRole", label: "Posição da empresa" },
  { key: "development", label: "Empreendimento" },
  { key: "block", label: "Quadra" },
  { key: "lot", label: "Lote" },
  { key: "claimAmount", label: "Valor da causa", type: "money" },
  { key: "provision", label: "Provisionamento" },
  { key: "refundAmount", label: "Valor restituído (distrato)", type: "money" },
  { key: "filedOn", label: "Data do ajuizamento", type: "date" },
  { key: "archivedOn", label: "Data do arquivamento", type: "date" },
] as const satisfies readonly { key: string; label: string; required?: boolean; type?: "date" | "money" }[];

type DetailKey = (typeof legalActionFields)[number]["key"];
const detailsSchema = z.object(Object.fromEntries(legalActionFields.map(field => {
  const value = z.string().trim().max(500);
  if ("required" in field) return [field.key, value.min(1, `Preencha o campo ${field.label}.`)];
  if ("type" in field && field.type === "date") return [field.key, z.union([z.literal(""), z.iso.date()])];
  if ("type" in field && field.type === "money") {
    return [field.key, value.regex(/^(?:\d{1,12}(?:\.\d{1,2})?)?$/, `Confira o campo ${field.label}.`)];
  }
  return [field.key, value];
})) as Record<DetailKey, z.ZodType<string>>);

const trackingSchema = z.object({
  status: z.enum(legalActionStatuses),
  observations: z.string().trim().max(12000),
});

export const legalActionCreate = trackingSchema.extend({
  id: z.uuid(),
  protocol: z.string().trim().max(120).regex(/[0-9]/, "Informe o número do processo."),
  details: detailsSchema,
});

export const legalActionUpdate = trackingSchema.extend({
  id: z.uuid(),
  revision: z.uuid(),
});

export type LegalAction = z.infer<typeof legalActionCreate> & { revision: string; updated_at: string };
