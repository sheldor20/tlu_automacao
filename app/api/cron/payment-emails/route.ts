import { dispatchPaymentEmails } from "@/lib/payment-email";
import { paymentFailure, paymentJson } from "@/lib/payment-server";
export const maxDuration = 240;
export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  )
    return paymentJson({ error: "Não autorizado." }, 401);
  try {
    const result = await dispatchPaymentEmails();
    return paymentJson(result, result.configured ? 200 : 503);
  } catch (error) {
    return paymentFailure(error);
  }
}
