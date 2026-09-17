import {
  budgetAccess,
  budgetBusinesses,
  budgetFailure,
} from "@/lib/budget-server";
import { checked } from "@/lib/operations-server";
import { paymentJson, PaymentError } from "@/lib/payment-server";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const { service, canWrite } = await budgetAccess(request);
    const year = Number(new URL(request.url).searchParams.get("year"));
    if (!Number.isInteger(year) || year < 2020 || year > 2095)
      throw new PaymentError("Ano inválido.");
    const [source, businesses, plans] = await Promise.all([
      checked(service.rpc("budget_source_months", { p_year: year })),
      budgetBusinesses(service),
      checked(
        service
          .from("budget_plans")
          .select("id,name,start_year,data,version,updated_at")
          .order("updated_at", { ascending: false })
          .limit(100),
      ),
    ]);
    return paymentJson({
      source,
      businesses,
      plans: plans.map((p) => ({ ...p.data, id: p.id, version: p.version })),
      canWrite,
    });
  } catch (e) {
    return budgetFailure(e);
  }
}
