import { contractContext, contractFailure } from "@/lib/contract-server";
import { paymentHash, paymentIp, paymentJson, paymentLimit, PaymentError } from "@/lib/payment-server";
export async function GET(request: Request) {
  try {
    const token = request.headers.get("x-contract-token") || "";
    if (!/^[a-f0-9]{64}$/.test(token)) throw new PaymentError("Link de acompanhamento inválido.", 401);
    const { db } = await contractContext(request, false);
    await paymentLimit(db, `contract-tracking:${paymentIp(request)}`, 120, 60);
    const result = await db.from("contract_requests").select("id").eq("tracking_token_hash", paymentHash(token)).is("requester_user_id", null).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new PaymentError("Link de acompanhamento inválido.", 404);
    return paymentJson(result.data);
  } catch (error) { return contractFailure(error); }
}
