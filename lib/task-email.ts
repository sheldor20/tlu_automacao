import type { SupabaseClient } from "@supabase/supabase-js";
import type { DigestEmail } from "./daily-digest.ts";

type TaskEmailContent = { name: string; title: string; kind: string; message: string; href: string };
const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
export function buildTaskEmail(content: TaskEmailContent, recipient: string, from: string, origin: string): DigestEmail {
  const statuses: Record<string, string> = { a_fazer: "A fazer", em_andamento: "Em andamento", concluida: "Concluída" };
  const subject = `${content.kind === "comment" ? "Novo comentário" : "Mudança de status"} · ${content.title}`;
  const message = content.kind === "comment" ? content.message : `Status: ${statuses[content.message] || content.message}`;
  const link = `${origin}${content.href}`;
  return { from, to: [recipient], subject,
    text: `Olá, ${content.name}.\n\nA tarefa que você criou para outra pessoa teve uma atualização.\n${content.title}\n\n${message}\n\nAcompanhar: ${link}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#263329"><h1>${escape(subject)}</h1><p>Olá, ${escape(content.name)}.</p><p>A tarefa que você criou para outra pessoa teve uma atualização.</p><p style="white-space:pre-line">${escape(message)}</p><a href="${escape(link)}">Acompanhar tarefa</a></div>` };
}

export async function dispatchTaskEmails({ db, key, from, origin, fetcher = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }: { db: SupabaseClient; key: string; from: string; origin: string; fetcher?: typeof fetch; pause?: (ms: number) => Promise<void> }) {
  let sent = 0, failed = 0, skipped = 0;
  for (let count = 0; count < 10; count++) {
    const claim = await db.rpc("claim_task_email");
    if (claim.error) throw claim.error;
    const job = claim.data?.[0];
    if (!job) break;
    const update = async (values: Record<string, unknown>) => {
      const result = await db.from("task_email_outbox").update(values).eq("id", job.id).eq("lease_id", job.lease_id).eq("status", "sending").select("id");
      if (result.error || !result.data?.length) throw new Error("Falha ao registrar envio da tarefa.");
    };
    try {
      const authorized = await db.rpc("task_email_authorized", { p_job: job.id });
      if (authorized.error) throw authorized.error;
      if (!authorized.data) { await update({ status: "skipped", locked_until: null }); skipped++; continue; }
      const payload = job.email_payload || buildTaskEmail(job.content, job.recipient, from, origin);
      if (!job.email_payload) await update({ email_payload: payload });
      const response = await fetcher("https://api.resend.com/emails", { method: "POST", signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `task-event-${job.id}` }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.id) throw new Error(`Falha no provedor de email (${response.status}).`);
      await update({ status: "sent", provider_id: result.id, sent_at: new Date().toISOString(), locked_until: null, last_error: null });
      sent++;
    } catch {
      failed++;
      await update({ status: "failed", locked_until: null, last_error: "Falha ao enviar notificação de tarefa.", available_at: new Date(Date.now() + Math.min(60, 2 ** job.attempts) * 60_000).toISOString() });
    } finally { await pause(600); }
  }
  return { sent, failed, skipped };
}
