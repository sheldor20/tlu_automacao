import { z } from "zod";
import { PaymentError, paymentAccess, paymentBody, paymentDb, paymentFailure, paymentJson, paymentLimit } from "@/lib/payment-server";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const db = paymentDb(), { id } = await context.params;
    const { actor, record } = await paymentAccess(request, db, id);
    if (!actor?.manager) throw new PaymentError("Acesso restrito à gestão.", 403);
    const assigned = await db.from("payment_request_responsibles")
      .select("user_id,profile:profiles!payment_request_responsibles_user_id_fkey(full_name,active,deleted_at)")
      .eq("request_id", record.id);
    if (assigned.error) throw assigned.error;
    const candidates = actor.globalManager
      ? await db.from("profiles").select("user_id,full_name").eq("active", true).is("deleted_at", null).order("full_name")
      : { data: [], error: null };
    if (candidates.error) throw candidates.error;
    return paymentJson({ assigned: assigned.data, candidates: candidates.data });
  } catch (error) { return paymentFailure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const db = paymentDb(), { id } = await context.params;
    const { actor, record } = await paymentAccess(request, db, id);
    if (!actor?.globalManager) throw new PaymentError("Somente a gestão geral pode vincular responsáveis.", 403);
    await paymentLimit(db, `assign:${actor.id}`, 60, 600);
    const payload = z.object({ user_id: z.uuid(), remove: z.boolean().default(false), version: z.number().int().min(0) }).parse(await paymentBody(request));
    const { error } = await db.rpc("assign_payment_responsible", { p_id: record.id, p_actor: actor.id, p_user: payload.user_id, p_remove: payload.remove, p_version: payload.version });
    if (error) throw error;
    return paymentJson({ ok: true });
  } catch (error) { return paymentFailure(error); }
}
