import type { SupabaseClient } from "@supabase/supabase-js";
import { accountabilityArtifacts } from "./artifacts";
import { monthlyEmail } from "./policy";
import { PROCESSING_TIMEOUT_MS, isProviderId } from "./dispatch";

export async function sendAccountabilityDispatch(
  service: SupabaseClient,
  id: string,
  token: string,
  enterprise: { name: string; qlik_value: string },
  year: number,
  month: number,
  authorize?: () => Promise<boolean>,
) {
  let sending = false;
  let providerId: string | null = null;
  try {
    const { pdf, excel, reference } = await accountabilityArtifacts(
      service,
      id,
      enterprise.qlik_value,
      year,
      month,
      token,
    );
    if (authorize && !(await authorize()))
      throw new Error(
        "A permissão foi revogada durante a geração. O envio foi cancelado.",
      );
    if (!enterprise.name.trim())
      throw new Error("O empreendimento não possui nome para o e-mail.");
    const email = monthlyEmail(enterprise.name, reference);
    const from = process.env.RESEND_FROM_EMAIL;
    if (!from || !process.env.RESEND_API_KEY)
      throw new Error("Envio de e-mail não configurado.");
    // Mark the attempt durably BEFORE contacting the provider. A crashed worker
    // with this marker can only be reconciled, never blindly retried.
    sending = true;
    const armed = await service
      .from("accountability_dispatches")
      .update({
        provider_attempted_at: new Date().toISOString(),
        email_snapshot: { from, ...email },
      })
      .eq("id", id)
      .eq("status", "processing")
      .eq("processing_token", token)
      .is("provider_attempted_at", null)
      .gt(
        "processing_started_at",
        new Date(Date.now() - PROCESSING_TIMEOUT_MS).toISOString(),
      )
      .select("id")
      .maybeSingle();
    if (armed.error)
      throw new Error(
        "Não foi possível confirmar o registro da tentativa. Conferência necessária.",
      );
    if (!armed.data)
      return {
        sent: false as const,
        error: "O processamento expirou ou mudou. Nenhum envio foi iniciado.",
      };
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `accountability-beta-${id}`,
      },
      body: JSON.stringify({
        from,
        ...email,
        tags: [
          { name: "dispatch_id", value: id },
          { name: "attempt_id", value: token },
        ],
        attachments: [
          {
            filename: `Prestacao-contas-${year}-${String(month).padStart(2, "0")}.pdf`,
            content: pdf.toString("base64"),
          },
          {
            filename: `Detalhamento-a-receber-${year}-${String(month).padStart(2, "0")}.xlsx`,
            content: excel.toString("base64"),
          },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(
        `O provedor retornou ${response.status}. Confira a tentativa original antes de qualquer reenvio.`,
      );
    const result = await response.json();
    if (!isProviderId(result.id))
      throw new Error("Não foi possível confirmar a aceitação pelo provedor.");
    providerId = result.id;
    const saved = await service
      .from("accountability_dispatches")
      .update({
        status: "sent_beta",
        provider_id: providerId,
        sent_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", id)
      .eq("processing_token", token)
      .eq("status", "processing")
      .select("id")
      .maybeSingle();
    if (saved.error || !saved.data)
      throw new Error(
        "O provedor aceitou o envio, mas o registro precisa ser reconciliado.",
      );
    return { sent: true as const, providerId };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha na geração do book.";
    const values = {
      status: sending ? "uncertain" : "failed",
      error: message.slice(0, 500),
      ...(providerId ? { provider_id: providerId } : {}),
    };
    // Fence late workers and never downgrade an already accepted/reconciled job.
    let update = service
      .from("accountability_dispatches")
      .update(values)
      .eq("id", id)
      .eq("processing_token", token)
      .eq("status", "processing");
    if (!sending) update = update.is("provider_attempted_at", null);
    await update;
    return { sent: false as const, error: message, uncertain: sending };
  }
}
