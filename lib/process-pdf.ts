import { z } from "zod";

export const MAX_PROCESS_PDF_BYTES = 4 * 1024 * 1024;

const processStepDraftSchema = z.object({
  title: z.string().trim().min(2).max(180),
  description: z.string().trim().min(2).max(4000),
  responsible_role: z.string().trim().max(140),
  business_rule: z.string().trim().max(3000),
});

export const processDraftSchema = z.object({
  title: z.string().trim().min(2).max(160),
  area: z.string().trim().min(2).max(100),
  objective: z.string().trim().min(2).max(3000),
  rules: z.array(z.string().trim().min(2).max(2000)).max(40),
  policies: z.array(z.string().trim().min(2).max(2000)).max(40),
  steps: z.array(processStepDraftSchema).min(1).max(60),
});

export type ProcessDraft = z.infer<typeof processDraftSchema>;

export const processDraftJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 2, maxLength: 160 },
    area: { type: "string", minLength: 2, maxLength: 100 },
    objective: { type: "string", minLength: 2, maxLength: 3000 },
    rules: { type: "array", maxItems: 40, items: { type: "string", minLength: 2, maxLength: 2000 } },
    policies: { type: "array", maxItems: 40, items: { type: "string", minLength: 2, maxLength: 2000 } },
    steps: {
      type: "array",
      minItems: 1,
      maxItems: 60,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", minLength: 2, maxLength: 180 },
          description: { type: "string", minLength: 2, maxLength: 4000 },
          responsible_role: { type: "string", maxLength: 140 },
          business_rule: { type: "string", maxLength: 3000 },
        },
        required: ["title", "description", "responsible_role", "business_rule"],
      },
    },
  },
  required: ["title", "area", "objective", "rules", "policies", "steps"],
} as const;

export function responseOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof response.output_text === "string") return response.output_text;
  return (response.output || []).flatMap((item) => item.content || []).filter((item) => item.type === "output_text").map((item) => item.text || "").join("");
}

export function isPdfUpload(file: { name: string; type: string; size: number }, firstBytes: Uint8Array) {
  const hasPdfExtension = file.name.toLocaleLowerCase("pt-BR").endsWith(".pdf");
  const hasPdfMime = file.type === "application/pdf" || !file.type;
  const hasPdfSignature = String.fromCharCode(...firstBytes.slice(0, 5)) === "%PDF-";
  return hasPdfExtension && hasPdfMime && hasPdfSignature && file.size > 0 && file.size <= MAX_PROCESS_PDF_BYTES;
}
