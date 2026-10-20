import { contractUpdateSchema } from "@/lib/contract-requests";
import { contractAccess, contractFailure } from "@/lib/contract-server";
import { paymentBody, paymentJson, PaymentError } from "@/lib/payment-server";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await contractAccess(request, (await params).id);
    const events = await ctx.db.from("contract_request_events").select("id,actor_name,message,status,kind,created_at").eq("request_id", ctx.row.id).order("created_at");
    if (events.error) throw events.error;
    return paymentJson({ row: ctx.row, events: events.data, can_manage: ctx.manager });
  } catch (error) { return contractFailure(error); }
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await contractAccess(request, (await params).id);
    const input = contractUpdateSchema.parse(await paymentBody(request));
    if (input.status && !ctx.manager) throw new PaymentError("Apenas a gestão pode alterar o status.", 403);
    const result = await ctx.db.rpc("update_contract_request", { p_id: ctx.row.id, p_actor: ctx.actor?.id || null,
      p_token_hash: ctx.tokenHash, p_version: input.version, p_status: input.status || null, p_details: input.details || null, p_message: input.message });
    if (result.error) throw result.error;
    return paymentJson({ row: result.data });
  } catch (error) { return contractFailure(error); }
}
