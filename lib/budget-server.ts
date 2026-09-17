import { operationsAccess, allRows, checked } from "./operations-server";
import { PaymentError, paymentFailure } from "./payment-server";
export async function budgetAccess(
  request: Request,
  write = false,
  business = false,
) {
  if (!request.headers.get("authorization")) {
    throw new PaymentError("Entre no sistema para continuar.", 401);
  }
  return operationsAccess(
    request,
    business ? ["novos-negocios"] : ["financeiro"],
    write,
  );
}
export async function budgetBody(request: Request) {
  const raw = await request.text();
  if (raw.length > 2_000_000)
    throw new PaymentError("O cenário excede o tamanho permitido.", 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new PaymentError("Dados inválidos.");
  }
}
export function budgetFailure(e: unknown) {
  const message =
    e && typeof e === "object" && "message" in e ? String(e.message) : "";
  if (message.includes("budget_conflict"))
    return paymentFailure(
      new PaymentError(
        "Este cenário ou curva foi atualizado por outra pessoa. Recarregue antes de salvar.",
        409,
      ),
    );
  if (message.includes("budget_business_missing"))
    return paymentFailure(
      new PaymentError("Negócio indisponível ou arquivado.", 404),
    );
  if (/budget_plans|budget_source_months|business_budget_curves/.test(message))
    return paymentFailure(
      new PaymentError(
        "A base do planejador está indisponível. Confira a instalação do módulo.",
        503,
      ),
    );
  return paymentFailure(e);
}
export async function budgetBusinesses(
  service: Awaited<ReturnType<typeof budgetAccess>>["service"],
) {
  const [businesses, curves] = await Promise.all([
    checked(
      service
        .from("businesses")
        .select("id,name,potential_vgv,qlik_work_key")
        .is("archived_at", null)
        .order("name")
        .limit(10000),
    ),
    allRows(service, "business_budget_curves", "business_id,curve,version"),
  ]);
  return businesses.map((b) => {
    const c = curves.find((c) => c.business_id === b.id);
    return { ...b, curve: c?.curve || [], version: c?.version || 0 };
  });
}
