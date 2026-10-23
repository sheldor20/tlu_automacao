import type { SupabaseClient } from "@supabase/supabase-js";
import { accountabilityArtifacts } from "./artifacts";
import { monthlyEmail } from "./policy";
export async function sendAccountabilityDispatch(
  service: SupabaseClient,
  id: string,
  enterprise: { name: string; qlik_value: string },
  year: number,
  month: number,
  authorize?: () => Promise<boolean>,
) {
  let sending = false;
  try {
    const { pdf, excel, reference } = await accountabilityArtifacts(
      service,
      id,
      enterprise.qlik_value,
      year,
      month,
    );
    if (authorize && !(await authorize()))
      throw new Error(
        "A permissão foi revogada durante a geração. O envio foi cancelado.",
      );
    if (!enterprise.name.trim())
      throw new Error("O empreendimento não possui nome para o e-mail.");
    const email = monthlyEmail(enterprise.name, reference);
    sending = true;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `accountability-beta-${id}`,
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL,
        ...email,
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
    if (!response.ok) {
      sending = false;
      throw new Error(
        `O provedor de e-mail recusou o envio (${response.status}).`,
      );
    }
    const result = await response.json();
    if (typeof result.id !== "string")
      throw new Error("Não foi possível confirmar o envio.");
    const saved = await service
      .from("accountability_dispatches")
      .update({
        status: "sent_beta",
        provider_id: result.id,
        sent_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", id);
    if (saved.error)
      throw new Error(
        "O provedor aceitou o envio, mas o registro precisa ser reconciliado.",
      );
    return { sent: true as const, providerId: result.id };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha na geração do book.";
    await service
      .from("accountability_dispatches")
      .update({
        status: sending ? "uncertain" : "failed",
        error: message.slice(0, 500),
      })
      .eq("id", id);
    return { sent: false as const, error: message, uncertain: sending };
  }
}
