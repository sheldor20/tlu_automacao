import { dispatchPaymentEmails } from "@/lib/payment-email";
import {
  PaymentError,
  paymentAccess,
  paymentDb,
  paymentFailure,
  paymentJson,
  paymentLimit,
} from "@/lib/payment-server";
export const maxDuration = 240;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const db = paymentDb(),
      { id } = await params;
    const { actor } = await paymentAccess(request, db, id);
    if (!actor?.manager)
      throw new PaymentError("Acesso restrito à gestão.", 403);
    await paymentLimit(db, `retry:${id}`, 5, 3600);
    const { error } = await db
      .from("payment_email_outbox")
      .update({
        status: "pending",
        attempts: 0,
        available_at: new Date().toISOString(),
      })
      .eq("request_id", id)
      .eq("status", "failed");
    if (error) throw error;
    return paymentJson(await dispatchPaymentEmails());
  } catch (error) {
    return paymentFailure(error);
  }
}
