import { z } from "zod";
import { operationsAccess, allRows } from "@/lib/operations-server";
import { paymentJson, paymentFailure } from "@/lib/payment-server";
export async function GET(request: Request) {
  try {
    const { db } = await operationsAccess(request, [
      "clientes",
      "cobranca",
      "financeiro",
      "obras",
    ]);
    const p = new URL(request.url).searchParams;
    const contract = z.string().min(1).max(500).parse(p.get("contract_id"));
    const kind = z
      .enum(["received", "receivable"])
      .parse(p.get("kind") || "received");
    const entries = await allRows(db, "operational_cash_entries", "*", {
      contract_id: contract,
      kind,
      active: true,
    });
    return paymentJson({ entries });
  } catch (e) {
    return paymentFailure(e);
  }
}
