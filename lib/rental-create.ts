import { z } from "zod";

export const rentalCreateSchema = z.object({
  name: z.string().trim().min(2).max(140),
  qlik_property_id: z.string().trim().min(1).max(200).refine(value => value !== "-"),
  property_address: z.string().trim().min(5).max(260),
  lessor_name: z.string().trim().min(2).max(160),
  lessor_type: z.enum(["pf", "pj"]),
  property_type: z.enum(["Imóvel Comercial", "Imóvel Residencial", "Terreno", "Área"]),
  rentable: z.boolean(),
}).strict();
