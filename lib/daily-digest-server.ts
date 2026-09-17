import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildDailyDigestEmail, dailyDigestOrigin, type DailyDigest, type DigestEmail } from "./daily-digest.ts";

type Job = { id: string; lease_id: string; recipient: string; attempts: number; content: DailyDigest | null; email_payload: DigestEmail | null };
type Options = { db: SupabaseClient; key: string; from: string; origin: string; fetcher?: typeof fetch; pause?: (ms: number) => Promise<void>; now?: () => number; budgetMs?: number };

export async function dispatchDailyDigests({ db, key, from, origin, fetcher = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, budgetMs = 180_000 }: Options) {
  const deadline = now() + budgetMs;
  let sent = 0, failed = 0, skipped = 0;
  // Claim one recipient at a time so a function timeout never strands a batch.
  while (now() < deadline - 20_000) {
    const claim = await db.rpc("claim_daily_digest");
    if (claim.error) throw claim.error;
    const job = (claim.data as Job[] | null)?.[0];
    if (!job) break;
    const update = async (values: Record<string, unknown>) => {
      const result = await db.from("daily_digest_outbox").update(values).eq("id", job.id).eq("lease_id", job.lease_id).eq("status", "sending").select("id");
      if (result.error || !result.data?.length) throw new Error("Falha ao registrar o envio do resumo.");
    };
    try {
      if (!job.email_payload) {
        const result = await db.rpc("daily_digest_content", { p_job: job.id });
        if (result.error) throw result.error;
        if (!result.data) {
          await update({ status: "skipped", locked_until: null, last_error: "Destinatário inativo ou email alterado." });
          skipped++;
          continue;
        }
        job.content = result.data as DailyDigest;
        job.email_payload = buildDailyDigestEmail(job.content, job.recipient, from, origin);
        // Freeze the exact provider body before the first send. An ambiguous
        // timeout is retried with the same body and Resend idempotency key.
        await update({ content: job.content, email_payload: job.email_payload });
      }
      const authorized = await db.rpc("daily_digest_authorized", { p_job: job.id });
      if (authorized.error) throw authorized.error;
      if (!authorized.data) {
        await update({ status: "skipped", locked_until: null, last_error: "Destinatário ou acesso alterado antes do envio." });
        skipped++;
        continue;
      }
      const response = await fetcher("https://api.resend.com/emails", {
        method: "POST", signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `daily-digest-${job.id}` },
        body: JSON.stringify(job.email_payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.id) throw new Error(`Falha no provedor de email (${response.status}).`);
      await update({ status: "sent", sent_at: new Date(now()).toISOString(), provider_id: result.id, locked_until: null, last_error: null });
      sent++;
    } catch (error) {
      failed++;
      // Store no provider response bodies or recipient data in logs.
      const message = error instanceof Error ? error.message.slice(0, 180) : "Falha ao processar o resumo.";
      try {
        await update({ status: "failed", last_error: message, locked_until: null, available_at: new Date(now() + Math.min(60, 2 ** job.attempts) * 60_000).toISOString() });
      } catch {
        console.error("Daily digest delivery audit failed", { jobId: job.id });
      }
    }
    await pause(600);
  }
  return { sent, failed, skipped };
}

export async function handleDailyDigestCron(request: Request, enqueue: boolean) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return json({ error: "Não autorizado." }, 401);
  const key = process.env.RESEND_API_KEY, from = process.env.RESEND_FROM_EMAIL;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !from || !url || !serviceKey || key === "[SENSITIVE]" || serviceKey === "[SENSITIVE]")
    return json({ error: "Configure Supabase e Resend para enviar os resumos." }, 503);
  let origin: string;
  try { origin = dailyDigestOrigin(process.env); }
  catch { return json({ error: "Configure APP_URL com o endereço HTTPS do sistema." }, 503); }
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    let queued = 0;
    if (enqueue) {
      const result = await db.rpc("enqueue_daily_digests");
      if (result.error) throw result.error;
      queued = Number(result.data || 0);
    }
    const result = await dispatchDailyDigests({ db, key, from, origin });
    return json({ queued, ...result }, result.failed ? 502 : 200);
  } catch {
    console.error("Daily digest cron failed");
    return json({ error: "Não foi possível processar os resumos." }, 500);
  }
}
