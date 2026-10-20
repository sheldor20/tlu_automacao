import { contractCreateSchema } from "@/lib/contract-requests";
import { CONTRACT_SELECT, contractContext, contractFailure } from "@/lib/contract-server";
import { paymentBody, paymentHash, paymentIp, paymentJson, paymentLimit, PaymentError } from "@/lib/payment-server";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const { db, actor, manager } = await contractContext(request);
    const params = new URL(request.url).searchParams;
    const management = params.get("scope") === "management";
    if (management && !manager) throw new PaymentError("O ADM precisa liberar a Gestão de contratos.", 403);
    const page = Math.max(0, Math.min(100000, Math.floor(Number(params.get("page")) || 0)));
    let query = db.from("contract_requests").select(CONTRACT_SELECT, { count: "exact" }).order("created_at", { ascending: false });
    if (!management) query = query.eq("requester_user_id", actor!.id);
    if (params.get("status")) query = query.eq("status", params.get("status"));
    if (params.get("type")) query = query.eq("details->>type", params.get("type"));
    if (params.get("company")) query = query.ilike("details->>company_name", `%${params.get("company")!.replace(/[%_\\]/g, "").slice(0, 100)}%`);
    const search = params.get("search")?.trim();
    if (search) {
      if (/^(CON-)?\d+$/i.test(search)) query = query.eq("protocol", Number(search.replace(/^CON-/i, "")));
      else query = query.ilike("details->>title", `%${search.replace(/[%_\\]/g, "").slice(0, 100)}%`);
    }
    const { data, error, count } = await query.range(page * 40, page * 40 + 39);
    if (error) throw error;
    return paymentJson({ rows: data, count, can_manage: manager });
  } catch (error) { return contractFailure(error); }
}
export async function POST(request: Request) {
  try {
    const { db, actor } = await contractContext(request, false);
    await paymentLimit(db, `contract-create:${actor?.id || paymentIp(request)}`, 20, 3600);
    const input = contractCreateSchema.parse(await paymentBody(request));
    if (actor) { input.requester_name = actor.name; input.requester_email = actor.email; }
    const { tracking_token: token, submission_id, ...fields } = input;
    const digest = paymentHash(JSON.stringify({ ...fields, user_id: actor?.id || null }));
    const tokenHash = paymentHash(token);
    const inserted = await db.from("contract_requests").insert({ ...fields, submission_id, submission_digest: digest,
      tracking_token_hash: tokenHash, requester_user_id: actor?.id || null }).select("id,protocol").single();
    if (inserted.error?.code === "23505") {
      const prior = await db.from("contract_requests").select("id,protocol").eq("submission_id", submission_id).eq("submission_digest", digest).eq("tracking_token_hash", tokenHash).maybeSingle();
      if (prior.error) throw prior.error;
      if (!prior.data) throw new PaymentError("Este envio já foi registrado com outros dados. Abra uma nova solicitação.", 409);
      return paymentJson({ ...prior.data, token: actor ? undefined : token });
    }
    if (inserted.error) throw inserted.error;
    return paymentJson({ ...inserted.data, token: actor ? undefined : token }, 201);
  } catch (error) { return contractFailure(error); }
}
