import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { type PaymentRequest, paymentCreateSchema } from "./payment-requests";

export class PaymentError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function paymentDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || key === "[SENSITIVE]")
    throw new PaymentError(
      "O serviço de pagamentos está indisponível. Tente novamente em instantes.",
      503,
    );
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function paymentHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function paymentFailure(error: unknown) {
  if (error instanceof PaymentError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  if (error instanceof z.ZodError)
    return NextResponse.json(
      {
        error: error.issues[0]?.message || "Revise os campos do formulário.",
        fields: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  const code =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "";
  const known: Record<string, [string, number]> = {
    payment_not_found: ["Solicitação não encontrada ou excluída.", 404],
    payment_receipt_required: [
      "Anexe o comprovante antes de marcar como paga.",
      422,
    ],
    payment_conflict: [
      "Esta solicitação foi atualizada. Recarregue antes de continuar.",
      409,
    ],
    submission_conflict: [
      "Este envio já foi registrado com outros dados. Abra uma nova solicitação.",
      409,
    ],
    payment_company_not_found: [
      "Selecione uma empresa disponível na lista do Qlik.",
      422,
    ],
    payment_forbidden: ["Você não tem permissão para esta ação.", 403],
    payment_closed: ["Esta solicitação já foi encerrada.", 409],
    payment_invalid_transition: [
      "Essa mudança de status não está disponível.",
      409,
    ],
    payment_message_required: ["Informe uma mensagem para o solicitante.", 422],
  };
  if (known[code])
    return NextResponse.json(
      { error: known[code][0] },
      { status: known[code][1] },
    );
  console.error("Payment operation failed", { message: code.slice(0, 180) });
  return NextResponse.json(
    { error: "Não foi possível concluir a operação. Tente novamente." },
    { status: 500 },
  );
}
export function paymentJson(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
export async function paymentBody(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 150_000)
    throw new PaymentError("O formulário excede o tamanho permitido.", 413);
  const raw = await request.text();
  if (raw.length > 150_000)
    throw new PaymentError("O formulário excede o tamanho permitido.", 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new PaymentError("Dados inválidos.");
  }
}
export type PaymentActor = {
  id: string;
  name: string;
  email: string;
  manager: boolean;
  admin: boolean;
};
export async function paymentActor(
  request: Request,
  db: SupabaseClient,
  required = true,
): Promise<PaymentActor | null> {
  const header = request.headers.get("authorization");
  if (!header) {
    if (required)
      throw new PaymentError("Entre no sistema para continuar.", 401);
    return null;
  }
  const token = header.replace(/^Bearer\s+/i, "");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user)
    throw new PaymentError("Sua sessão expirou. Entre novamente.", 401);
  const [profile, permission] = await Promise.all([
    db
      .from("profiles")
      .select("full_name,active,is_admin,deleted_at")
      .eq("user_id", data.user.id)
      .single(),
    db
      .from("profile_payment_permissions")
      .select("can_manage")
      .eq("user_id", data.user.id)
      .maybeSingle(),
  ]);
  if (profile.error || permission.error)
    throw new PaymentError("Não foi possível verificar seus acessos.", 503);
  if (!profile.data?.active || profile.data.deleted_at)
    throw new PaymentError("Este usuário não está ativo.", 403);
  return {
    id: data.user.id,
    name: profile.data.full_name,
    email: data.user.email || "",
    admin: profile.data.is_admin,
    manager: profile.data.is_admin || Boolean(permission.data?.can_manage),
  };
}
export async function paymentLimit(
  db: SupabaseClient,
  key: string,
  limit = 10,
  window = 3600,
) {
  const { data, error } = await db.rpc("payment_check_rate", {
    p_key: paymentHash(key),
    p_limit: limit,
    p_window: window,
  });
  if (error)
    throw new PaymentError(
      "Não foi possível validar o envio. Tente novamente.",
      503,
    );
  if (!data)
    throw new PaymentError(
      "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.",
      429,
    );
}
export function paymentIp(request: Request) {
  // Vercel overwrites this header at its trusted edge. Do not trust arbitrary X-Forwarded-For.
  return process.env.VERCEL
    ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown"
    : "local";
}
export async function paymentAccess(
  request: Request,
  db: SupabaseClient,
  id?: string,
) {
  const actor = await paymentActor(request, db, false);
  let tokenHash: string | null = null;
  if (!actor) {
    const token = request.headers.get("x-payment-token") || "";
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new PaymentError("Link de acompanhamento inválido.", 401);
    await paymentLimit(db, `tracking:${paymentIp(request)}`, 180, 60);
    tokenHash = paymentHash(token);
    const result = await db
      .from("payment_request_tokens")
      .select("request_id")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data || (id && id !== result.data.request_id))
      throw new PaymentError("Solicitação não encontrada.", 404);
    id = result.data.request_id;
  }
  if (!id || !z.uuid().safeParse(id).success)
    throw new PaymentError("Solicitação inválida.", 400);
  const { data: record, error } = await db
    .from("payment_requests")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (
    !record ||
    (actor && !actor.manager && record.requester_user_id !== actor.id)
  )
    throw new PaymentError("Solicitação não encontrada.", 404);
  return { actor, record: record as PaymentRequest, tokenHash };
}
export async function createPayment(request: Request) {
  const db = paymentDb();
  const actor = await paymentActor(request, db, false);
  await paymentLimit(db, `submit:${actor?.id || paymentIp(request)}`, 10, 3600);
  const input = paymentCreateSchema.parse(await paymentBody(request));
  if (actor) {
    input.requester_email = actor.email;
    input.requester_name = actor.name || input.requester_name;
  }
  await paymentLimit(db, `submit-email:${input.requester_email}`, 10, 3600);
  const token = randomBytes(32).toString("hex");
  const { data, error } = await db.rpc("create_payment_request", {
    p_data: input,
    p_actor: actor?.id || null,
    p_token: token,
    p_token_hash: paymentHash(token),
    p_digest: paymentHash(JSON.stringify(input)),
  });
  if (error) throw error;
  return data as { id: string; protocol: number; token: string };
}
