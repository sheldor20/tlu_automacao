import { z } from "zod";
import { paymentActor, paymentDb, paymentHash, paymentLimit, paymentIp, PaymentError, paymentFailure } from "./payment-server";
import type { ContractRequest } from "./contract-requests";

export const CONTRACT_SELECT = "id,protocol,requester_user_id,requester_name,requester_email,details,status,version,created_at,updated_at";
export async function contractContext(request: Request, required = true) {
  const db = paymentDb();
  const actor = await paymentActor(request, db, required);
  let manager = Boolean(actor?.admin);
  if (actor && !manager) {
    const result = await db.from("profile_contract_permissions").select("can_manage").eq("user_id", actor.id).maybeSingle();
    if (result.error) throw result.error;
    manager = Boolean(result.data?.can_manage);
  }
  return { db, actor, manager };
}
export async function contractAccess(request: Request, id: string) {
  if (!z.uuid().safeParse(id).success) throw new PaymentError("Solicitação não encontrada.", 404);
  const ctx = await contractContext(request, false);
  let tokenHash: string | null = null;
  if (!ctx.actor) {
    const token = request.headers.get("x-contract-token") || "";
    if (!/^[a-f0-9]{64}$/.test(token)) throw new PaymentError("Entre no sistema ou use o link de acompanhamento.", 401);
    await paymentLimit(ctx.db, `contract-tracking:${paymentIp(request)}`, 120, 60);
    tokenHash = paymentHash(token);
  }
  let query = ctx.db.from("contract_requests").select(CONTRACT_SELECT).eq("id", id);
  if (!ctx.actor) query = query.eq("tracking_token_hash", tokenHash!).is("requester_user_id", null);
  else if (!ctx.manager) query = query.eq("requester_user_id", ctx.actor.id);
  const result = await query.maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new PaymentError("Solicitação não encontrada ou sem acesso.", 404);
  return { ...ctx, tokenHash, row: result.data as ContractRequest };
}
export function contractFailure(error: unknown) {
  const code = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  const errors: Record<string, [string, number]> = {
    contract_not_found: ["Solicitação não encontrada.", 404],
    contract_forbidden: ["Você não tem permissão para esta ação.", 403],
    contract_edit_forbidden: ["Os dados podem ser complementados quando o status for Falta informações.", 403],
    contract_conflict: ["A solicitação foi atualizada. Recarregue antes de continuar.", 409],
    contract_invalid_status: ["Status inválido.", 422],
    contract_message_required: ["Descreva quais informações estão faltando.", 422],
    contract_empty_update: ["Informe uma alteração ou mensagem.", 422],
  };
  return paymentFailure(errors[code] ? new PaymentError(...errors[code]) : error);
}
