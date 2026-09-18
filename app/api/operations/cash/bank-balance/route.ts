import { z } from "zod";
import { operationsAccess } from "@/lib/operations-server";
import { paymentFailure, paymentJson, PaymentError } from "@/lib/payment-server";
import { localToday } from "@/lib/operational-finance";
import type { CashBankBalance } from "@/lib/cash-bank-balance";

export const runtime = "nodejs";

/**
 * The Finance dashboard already persists the validated Qlik bank balance.
 * The weekly cash view consumes that same source instead of opening a second
 * browser session against Qlik, which was the cause of the production failure.
 */
export async function GET(request: Request) {
  try {
    const { service } = await operationsAccess(request, ["financeiro"]);
    const params = new URL(request.url).searchParams;
    const date = z.iso.date().parse(params.get("date") || localToday());
    const companyId = z.string().max(200).parse(params.get("company_id") || "");

    if (companyId) {
      throw new PaymentError(
        "O saldo bancário automático está disponível na visão consolidada. Para uma empresa específica, use o saldo manual até a origem publicar o saldo por empresa.",
        422,
      );
    }
    if (date > localToday()) {
      throw new PaymentError(
        "O Qlik não possui saldo bancário realizado para uma data futura. Use um saldo manual para esse cenário.",
        422,
      );
    }

    const referenceMonth = date.slice(0, 7) + "-01";
    const { data, error } = await service
      .from("management_indicator_values")
      .select("value,reference_month,updated_at,metadata")
      .eq("area", "empresa")
      .eq("metric_key", "valor_caixa")
      .eq("dimension_key", "total")
      .lte("reference_month", referenceMonth)
      .order("reference_month", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data || data.value === null || !Number.isFinite(Number(data.value))) {
      throw new PaymentError(
        "O saldo em banco do Qlik ainda não foi publicado para esta competência.",
        503,
      );
    }

    const metadata = data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
      ? data.metadata as Record<string, unknown>
      : {};
    const selections = metadata.selections && typeof metadata.selections === "object" && !Array.isArray(metadata.selections)
      ? metadata.selections as Record<string, unknown>
      : {};
    const synchronizedAt = typeof metadata.synchronized_at === "string"
      ? metadata.synchronized_at
      : data.updated_at;
    const referenceDate = typeof selections.reference_date === "string"
      ? selections.reference_date
      : data.reference_month;

    const result: CashBankBalance = {
      amount: Number(data.value),
      as_of: date,
      company_id: "",
      synchronized_at: synchronizedAt,
      account_count: 1,
      source: "Qlik DFC",
      stale: referenceDate < date,
    };
    return paymentJson(result);
  } catch (error) {
    return paymentFailure(error);
  }
}
