import { budgetAccess, budgetBody, budgetFailure } from "@/lib/budget-server";
import { businessCurveSchema } from "@/lib/budget-schema";
import { paymentJson } from "@/lib/payment-server";
export async function GET(request: Request) {
  try {
    const { db, canWrite } = await budgetAccess(request, false, true);
    const id = new URL(request.url).searchParams.get("id");
    const result = await db
      .from("business_budget_curves")
      .select("curve,version")
      .eq("business_id", id)
      .maybeSingle();
    if (result.error) throw result.error;
    return paymentJson({
      curve: result.data?.curve || [],
      version: result.data?.version || 0,
      canWrite,
    });
  } catch (e) {
    return budgetFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    const { service, actor } = await budgetAccess(request, true, true);
    const input = businessCurveSchema.parse(await budgetBody(request));
    const result = await service.rpc("save_business_budget_curve", {
      p_business: input.business_id,
      p_curve: input.curve,
      p_version: input.version,
      p_actor: actor.id,
    });
    if (result.error) throw result.error;
    return paymentJson(result.data);
  } catch (e) {
    return budgetFailure(e);
  }
}
