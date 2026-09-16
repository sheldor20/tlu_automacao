import { after } from "next/server";
import {
  PaymentError,
  paymentAccess,
  paymentBody,
  paymentDb,
  paymentFailure,
  paymentJson,
  paymentLimit,
} from "@/lib/payment-server";
import { paymentActionSchema, paymentEditSchema, paymentDeleteSchema } from "@/lib/payment-requests";
import { dispatchPaymentEmails } from "@/lib/payment-email";
export const maxDuration = 240;
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const db = paymentDb(),
      { id } = await context.params;
    const { actor, record } = await paymentAccess(
      request,
      db,
      id === "tracking" ? undefined : id,
    );
    const [events, files, emails] = await Promise.all([
      db
        .from("payment_request_events")
        .select("id,kind,status,message,actor_name,created_at")
        .eq("request_id", record.id)
        .order("created_at"),
      db
        .from("payment_request_files")
        .select("id,name,kind,size,ready,created_at")
        .eq("request_id", record.id)
        .eq("ready", true)
        .order("created_at"),
      actor?.manager
        ? db
            .from("payment_email_outbox")
            .select("id,status,attempts,last_error,sent_at,created_at")
            .eq("request_id", record.id)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (events.error || files.error || emails.error)
      throw events.error || files.error || emails.error;
    // Exclude idempotency metadata from every browser response.
    const safe = { ...record } as Record<string, unknown>;
    delete safe.submission_digest;
    delete safe.submission_id;
    return paymentJson({
      request: safe,
      events: events.data,
      files: files.data,
      emails: emails.data,
      can_manage: Boolean(actor?.manager),
    });
  } catch (error) {
    return paymentFailure(error);
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const db = paymentDb(),
      { id } = await context.params;
    const { actor, record, tokenHash } = await paymentAccess(request, db, id);
    await paymentLimit(db, `action:${actor?.id || record.id}`, 60, 600);
    const payload = paymentActionSchema.parse(await paymentBody(request));
    const { error } = await db.rpc("payment_request_action", {
      p_id: record.id,
      p_actor: actor?.id || null,
      p_token_hash: tokenHash,
      p_action: payload.action,
      p_payload: payload,
    });
    if (error) throw error;
    after(async () => {
      try {
        await dispatchPaymentEmails();
      } catch {
        console.error("Payment notifications remain queued");
      }
    });
    return paymentJson({ ok: true });
  } catch (error) {
    return paymentFailure(error);
  }
}

async function manageRequest(request: Request, context: Context, action: "edit" | "delete") {
  try {
    const db = paymentDb(), { id } = await context.params;
    const { actor, record } = await paymentAccess(request, db, id);
    if (!actor?.manager) throw new PaymentError("Acesso restrito à gestão de pagamentos.", 403);
    await paymentLimit(db, `manage:${actor.id}`, 60, 600);
    const body = await paymentBody(request);
    const payload = action === "edit" ? paymentEditSchema.parse(body) : paymentDeleteSchema.parse(body);
    const { error } = await db.rpc("manage_payment_request", {
      p_id: record.id,
      p_actor: actor.id,
      p_version: payload.version,
      p_action: action,
      p_data: action === "edit" ? payload : {},
    });
    if (error) throw error;
    after(async () => {
      try { await dispatchPaymentEmails(); }
      catch { console.error("Payment notifications remain queued"); }
    });
    return paymentJson({ ok: true });
  } catch (error) {
    return paymentFailure(error);
  }
}
export async function PUT(request: Request, context: Context) {
  return manageRequest(request, context, "edit");
}
export async function DELETE(request: Request, context: Context) {
  return manageRequest(request, context, "delete");
}
