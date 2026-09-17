import { budgetAccess, budgetBody, budgetFailure } from "@/lib/budget-server";
import { budgetSchema } from "@/lib/budget-schema";
import { paymentJson, PaymentError } from "@/lib/payment-server";
export async function POST(request: Request) {
  try {
    const { service, actor } = await budgetAccess(request, true);
    const plan = budgetSchema.parse(await budgetBody(request));
    const payload = {
      name: plan.name,
      start_year: plan.start_year,
      data: plan,
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
      version: plan.version + 1,
    };
    const result = plan.id
      ? await service
          .from("budget_plans")
          .update(payload)
          .eq("id", plan.id)
          .eq("version", plan.version)
          .select("id,version")
          .maybeSingle()
      : await service
          .from("budget_plans")
          .insert({ ...payload, version: 1, created_by: actor.id })
          .select("id,version")
          .single();
    if (result.error) throw result.error;
    if (!result.data)
      throw new PaymentError(
        "Este cenário foi atualizado por outra pessoa. Recarregue antes de salvar.",
        409,
      );
    return paymentJson({ ...plan, ...result.data });
  } catch (e) {
    return budgetFailure(e);
  }
}
