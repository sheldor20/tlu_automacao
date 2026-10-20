import { dispatchTaskEmails } from "@/lib/task-email";
import { dailyDigestOrigin } from "@/lib/daily-digest";
import { paymentDb, paymentFailure, paymentJson } from "@/lib/payment-server";
export const maxDuration = 240;
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return paymentJson({ error: "Não autorizado." }, 401);
  const key = process.env.RESEND_API_KEY, from = process.env.RESEND_FROM_EMAIL;
  if (!key || !from || key === "[SENSITIVE]") return paymentJson({ error: "Configure o envio de emails." }, 503);
  try {
    const result = await dispatchTaskEmails({ db: paymentDb(), key, from, origin: dailyDigestOrigin(process.env) });
    return paymentJson(result, result.failed ? 502 : 200);
  } catch (error) { return paymentFailure(error); }
}
