import { operationsAccess, checked } from "@/lib/operations-server";
import { paymentJson, paymentFailure } from "@/lib/payment-server";
export async function GET(request: Request) {
  try {
    const { service } = await operationsAccess(request, [
      "financeiro",
      "clientes",
      "cobranca",
      "obras",
    ]);
    const [connection, runs] = await Promise.all([
      checked(
        service
          .from("data_connections")
          .select("active,settings")
          .eq("slug", "qlik-operations")
          .single(),
      ),
      checked(
        service
          .from("operational_imports")
          .select("kind,status,started_at")
          .order("started_at", { ascending: false })
          .limit(50),
      ),
    ]);
    const sources = Object.fromEntries(
      ["catalog", "receivable", "payable", "received", "paid"].map((kind) => [
        kind,
        {
          at: connection.settings?.[kind]?.at || null,
          status: runs.find((r) => r.kind === kind)?.status || "pending",
        },
      ]),
    );
    return paymentJson({
      active: connection.active,
      checked_at: new Date().toISOString(),
      sources,
    });
  } catch (e) {
    return paymentFailure(e);
  }
}
