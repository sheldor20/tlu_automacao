import { z } from "zod";

const date = z.string().date().nullable();
export const rentalContractDraftSchema = z.object({
  property_address: z.string().max(260).nullable(),
  monthly_rent: z.number().min(0).max(999999999).nullable(),
  lessor_name: z.string().max(160).nullable(),
  lessor_type: z.enum(["pf", "pj"]).nullable(),
  tenant_name: z.string().max(500).nullable(),
  lease_start_date: date,
  lease_end_date: date,
  due_day: z.number().int().min(1).max(31).nullable(),
  annual_adjustment_percent: z.number().min(0).max(100).nullable(),
  adjustment_index: z.string().max(160).nullable(),
  renewal_terms: z.string().max(3000).nullable(),
  iptu_payer: z.enum(["tlu", "tenant", "shared", "unknown"]),
  iptu_clause: z.string().max(3000).nullable(),
  warnings: z.array(z.string().max(1000)).max(30),
});
export const rentalContractJsonSchema = z.toJSONSchema(rentalContractDraftSchema);
export type RentalContractDraft = z.infer<typeof rentalContractDraftSchema>;
export type RentalContractFile = { path: string; name: string };
export type RentalContractVersion = { id: string; created_at: string; files: RentalContractFile[]; snapshot: Record<string, unknown> };
export const RENTAL_CONTRACT_BUCKET = "rental-contracts";
export const MAX_RENTAL_PDF_BYTES = 25 * 1024 * 1024;
