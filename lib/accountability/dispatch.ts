import type { SupabaseClient } from "@supabase/supabase-js";
import { BETA_RECIPIENT } from "./policy";

// Longer than this route's 800s execution limit. Recovery never extends a worker.
export const PROCESSING_TIMEOUT_MS = 15 * 60 * 1000;
export type EmailSnapshot = {
  from: string;
  to: string;
  subject: string;
  text: string;
};
export type DispatchRecord = {
  id: string;
  status: "historical" | "processing" | "failed" | "uncertain" | "sent_beta";
  updated_at: string;
  processing_token: string | null;
  processing_started_at: string | null;
  provider_attempted_at: string | null;
  provider_id: string | null;
  email_snapshot: EmailSnapshot | null;
};
export class DispatchConflict extends Error {}
export function processingExpired(
  record: Pick<DispatchRecord, "processing_started_at" | "updated_at">,
  now = Date.now(),
) {
  const started = Date.parse(record.processing_started_at || record.updated_at);
  return Number.isFinite(started) && now - started > PROCESSING_TIMEOUT_MS;
}
export function safeToRetry(record: DispatchRecord) {
  return (
    !record.provider_id &&
    !record.provider_attempted_at &&
    (record.status === "historical" ||
      (record.status === "failed" && !!record.processing_token))
  );
}
export async function claimDispatch(
  service: SupabaseClient,
  enterpriseId: string,
  year: number,
  month: number,
  userId: string,
) {
  const claim = {
    status: "processing",
    requested_by: userId,
    error: null,
    processing_token: crypto.randomUUID(),
    processing_started_at: new Date().toISOString(),
  };
  const inserted = await service
    .from("accountability_dispatches")
    .insert({ enterprise_id: enterpriseId, year, month, ...claim })
    .select("id")
    .single();
  if (!inserted.error && inserted.data)
    return { id: inserted.data.id as string, token: claim.processing_token };
  if (inserted.error?.code !== "23505")
    throw new Error("Não foi possível registrar o processamento.");
  const existing = await service
    .from("accountability_dispatches")
    .select("*")
    .eq("enterprise_id", enterpriseId)
    .eq("year", year)
    .eq("month", month)
    .single();
  if (existing.error || !existing.data)
    throw new Error("Não foi possível consultar o processamento.");
  const record = existing.data as DispatchRecord;
  if (!safeToRetry(record))
    throw new DispatchConflict(
      "Confira o envio existente antes de tentar novamente. Um resultado incerto não pode ser reenviado.",
    );
  const updated = await service
    .from("accountability_dispatches")
    .update(claim)
    .eq("id", record.id)
    .eq("status", record.status)
    .eq("updated_at", record.updated_at)
    .is("provider_attempted_at", null)
    .is("provider_id", null)
    .select("id")
    .maybeSingle();
  if (updated.error)
    throw new Error("Não foi possível iniciar o processamento.");
  if (!updated.data)
    throw new DispatchConflict("O processamento mudou. Atualize a página.");
  return { id: record.id, token: claim.processing_token };
}

type ProviderEmail = {
  id: string;
  created_at: string;
  to: string[];
  from: string;
  subject: string;
  text?: string | null;
  tags?: { name: string; value: string }[];
};
async function providerGet(path: string, request: typeof fetch) {
  const response = await request(`https://api.resend.com${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(
      `Não foi possível conferir o provedor (${response.status}). Nenhum reenvio foi liberado.`,
    );
  return response.json();
}
export const isProviderId = (id: unknown): id is string =>
  typeof id === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
function matchesProvider(record: DispatchRecord, email: ProviderEmail) {
  if (
    !isProviderId(email.id) ||
    !Number.isFinite(Date.parse(email.created_at)) ||
    !Array.isArray(email.to) ||
    email.to.length !== 1 ||
    email.to[0] !== BETA_RECIPIENT
  )
    return false;
  if (record.provider_id) return email.id === record.provider_id; // Association was saved by the server, never supplied by the browser.
  const snapshot = record.email_snapshot;
  return (
    !!snapshot &&
    email.from === snapshot.from &&
    email.subject === snapshot.subject &&
    email.text === snapshot.text &&
    email.tags?.some(
      (t) => t.name === "dispatch_id" && t.value === record.id,
    ) === true &&
    email.tags?.some(
      (t) => t.name === "attempt_id" && t.value === record.processing_token,
    ) === true
  );
}
/** Positive evidence only. Empty pages, 404, missing permissions or retention are NOT evidence of non-send. */
export async function findProviderAcceptance(
  record: DispatchRecord,
  request: typeof fetch = fetch,
): Promise<ProviderEmail | null> {
  if (record.provider_id) {
    if (!isProviderId(record.provider_id)) return null;
    const email = (await providerGet(
      `/emails/${record.provider_id}`,
      request,
    )) as ProviderEmail;
    return matchesProvider(record, email) ? email : null;
  }
  if (
    !record.provider_attempted_at ||
    !record.email_snapshot ||
    !record.processing_token
  )
    return null;
  let after = "";
  let inspected = 0;
  const cursors = new Set<string>();
  // Bounded read; exhaustion stays uncertain, even if no matching message was found.
  for (let page = 0; page < 10; page++) {
    const list = await providerGet(
      `/emails${after ? `?after=${encodeURIComponent(after)}` : ""}`,
      request,
    );
    if (!Array.isArray(list.data))
      throw new Error(
        "Resposta inválida do provedor. Nenhum reenvio foi liberado.",
      );
    for (const candidate of list.data) {
      if (
        !isProviderId(candidate.id) ||
        candidate.subject !== record.email_snapshot.subject ||
        !candidate.to?.includes(BETA_RECIPIENT)
      )
        continue;
      if (++inspected > 10) return null;
      const email = (await providerGet(
        `/emails/${candidate.id}`,
        request,
      )) as ProviderEmail;
      if (matchesProvider(record, email)) return email;
    }
    if (!list.has_more || !list.data.length) return null;
    const cursor = list.data.at(-1)?.id;
    if (!isProviderId(cursor) || cursors.has(cursor)) return null;
    cursors.add(cursor);
    after = cursor;
  }
  return null;
}
export async function recoverDispatch(
  service: SupabaseClient,
  id: string,
  request: typeof fetch = fetch,
  now = Date.now(),
) {
  const loaded = await service
    .from("accountability_dispatches")
    .select("*")
    .eq("id", id)
    .single();
  if (loaded.error || !loaded.data)
    throw new Error("Não foi possível consultar o envio.");
  const record = loaded.data as DispatchRecord;
  if (record.status === "sent_beta")
    return {
      status: "sent_beta",
      message:
        "Aceitação pelo provedor já registrada; isso não confirma entrega na caixa de entrada.",
    };
  if (record.status === "processing" && !processingExpired(record, now))
    throw new DispatchConflict(
      "O processamento ainda pode estar ativo. Aguarde 15 minutos desde o início antes de conferir.",
    );
  if (safeToRetry(record))
    return {
      status: record.status,
      message:
        "Nenhuma tentativa de envio registrada. Uma nova tentativa pode ser solicitada.",
    };
  const beforeSend =
    record.status === "processing" &&
    !!record.processing_token &&
    !record.provider_attempted_at &&
    !record.provider_id;
  let accepted: ProviderEmail | null = null;
  let reason =
    "Não foi possível comprovar o resultado do provedor. Reenvio bloqueado; é necessária conferência do envio original.";
  if (!beforeSend) {
    try {
      accepted = await findProviderAcceptance(record, request);
    } catch (error) {
      reason = error instanceof Error ? error.message : reason;
    }
  }
  const values = beforeSend
    ? {
        status: "failed",
        error:
          "Processamento interrompido antes da tentativa de envio. Uma nova tentativa pode ser solicitada.",
      }
    : accepted
      ? {
          status: "sent_beta",
          provider_id: accepted.id,
          sent_at: new Date(accepted.created_at).toISOString(),
          error: null,
        }
      : { status: "uncertain", error: reason };
  const saved = await service
    .from("accountability_dispatches")
    .update(values)
    .eq("id", id)
    .eq("status", record.status)
    .eq("updated_at", record.updated_at)
    .select("id")
    .maybeSingle();
  if (saved.error)
    throw new Error(
      "Não foi possível registrar a conferência. Nenhum reenvio foi liberado.",
    );
  if (!saved.data)
    throw new DispatchConflict(
      "O envio mudou durante a conferência. Atualize a página.",
    );
  return {
    status: values.status,
    message: accepted
      ? "Aceitação pelo provedor reconciliada. Isso não confirma entrega na caixa de entrada."
      : values.error!,
  };
}
