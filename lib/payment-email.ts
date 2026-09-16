import { paymentDb } from "./payment-server";
import {
  PAYMENT_STATUSES,
  paymentProtocol,
  type PaymentStatus,
} from "./payment-requests";

const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
export function paymentAppUrl() {
  const domain =
    process.env.PAYMENT_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "");
  if (!domain)
    throw new Error(
      "Configure PAYMENT_APP_URL para os links de acompanhamento.",
    );
  const url = new URL(domain);
  if (url.protocol !== "https:" && url.hostname !== "localhost")
    throw new Error("PAYMENT_APP_URL deve usar HTTPS.");
  return url.origin;
}
export async function dispatchPaymentEmails() {
  const key = process.env.RESEND_API_KEY,
    from = process.env.RESEND_FROM_EMAIL;
  if (!key || !from || key === "[SENSITIVE]")
    return { sent: 0, failed: 0, configured: false };
  const origin = paymentAppUrl();
  const db = paymentDb();
  let sent = 0,
    failed = 0;
  while (sent + failed < 10) {
    const { data: jobs, error } = await db.rpc("claim_payment_emails", {
      p_limit: 10 - sent - failed,
    });
    if (error) throw error;
    if (!jobs?.length) break;
    for (const job of jobs || []) {
      try {
        const [requestResult, eventResult, tokenResult] = await Promise.all([
          db
            .from("payment_requests")
            .select("protocol,requester_name,requester_email,title")
            .eq("id", job.request_id)
            .single(),
          db
            .from("payment_request_events")
            .select("kind,status,message")
            .eq("id", job.event_id)
            .single(),
          db
            .from("payment_request_tokens")
            .select("token")
            .eq("request_id", job.request_id)
            .single(),
        ]);
        if (requestResult.error || eventResult.error || tokenResult.error)
          throw new Error("Não foi possível carregar a notificação.");
        const r = requestResult.data,
          event = eventResult.data;
        const label = PAYMENT_STATUSES[event.status as PaymentStatus];
        const link = `${origin}/acompanhar-pagamento#${tokenResult.data.token}`;
        const subject = `${paymentProtocol(r.protocol)} · ${event.kind === "reply" ? "Nova informação" : label}`;
        const message =
          event.message ||
          `O status da sua solicitação mudou para ${label.toLowerCase()}.`;
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `payment-event-${job.event_id}`,
          },
          body: JSON.stringify({
            from,
            to: [r.requester_email],
            subject,
            text: `Olá, ${r.requester_name}.\n\n${r.title}\nStatus: ${label}\n\n${message}\n\nAcompanhe, consulte comprovantes e envie informações: ${link}\n\nEste link é pessoal. Não o compartilhe.\nTerra Lótus`,
            html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:24px auto;color:#263329"><p style="letter-spacing:2px">TERRA LÓTUS</p><h1 style="font-size:24px">${escape(subject)}</h1><p>Olá, ${escape(r.requester_name)}.</p><p><strong>${escape(r.title)}</strong></p><p>Status: ${escape(label)}</p><p style="white-space:pre-line">${escape(message)}</p><p><a style="display:inline-block;background:#263329;color:white;padding:14px 20px;border-radius:8px" href="${escape(link)}">Acompanhar solicitação</a></p><p>Consulte comprovantes e envie informações pelo link acima.</p><small>Este link é pessoal. Não o compartilhe.</small></div>`,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.id)
          throw new Error(`Falha no provedor de e-mail (${response.status}).`);
        const update = await db
          .from("payment_email_outbox")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            provider_id: result.id,
            last_error: null,
            locked_until: null,
          })
          .eq("id", job.id)
          .eq("lease_id", job.lease_id);
        if (update.error) throw update.error;
        sent++;
      } catch (sendError) {
        failed++;
        const message =
          sendError instanceof Error
            ? sendError.message.slice(0, 300)
            : "Falha de envio.";
        const retryMinutes = Math.min(60, 2 ** Math.min(job.attempts, 6));
        const { error: retryError } = await db
          .from("payment_email_outbox")
          .update({
            status: "failed",
            last_error: message,
            available_at: new Date(
              Date.now() + retryMinutes * 60_000,
            ).toISOString(),
            locked_until: null,
          })
          .eq("id", job.id)
          .eq("lease_id", job.lease_id);
        if (retryError)
          console.error("Payment email retry audit failed", { id: job.id });
      }
    }
  }
  return { sent, failed, configured: true };
}
