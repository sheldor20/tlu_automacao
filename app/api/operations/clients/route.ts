import { z } from "zod";
import { operationsAccess, allRows, checked } from "@/lib/operations-server";
import {
  paymentBody,
  paymentFailure,
  paymentJson,
  PaymentError,
} from "@/lib/payment-server";
export async function GET(request: Request) {
  try {
    const { db, service, canWriteModule } = await operationsAccess(request, [
      "clientes",
      "cobranca",
    ]);
    const params = new URL(request.url).searchParams;
    const clientId = params.get("client_id");
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .parse(params.get("page") || 0);
    const query = z
      .string()
      .max(200)
      .parse(params.get("q") || "");
    const list = clientId
      ? {
          clients: await checked(
            db.from("client_accounts").select("*").eq("id", clientId),
          ),
          contracts: await allRows(db, "client_contracts", "*", {
            client_id: clientId,
          }),
          total: 1,
        }
      : await checked(
          db.rpc("search_operational_clients", {
            p_query: query,
            p_page: page,
          }),
        );
    const clients = list.clients,
      contracts = list.contracts;
    const contractIds = contracts.map((c: { id: string }) => c.id);
    const [entries, cases, events, companies, works, users] = await Promise.all(
      [
        clientId && contractIds.length
          ? allRows(db, "operational_cash_entries", "*", {
              active: true,
              contract_id: contractIds,
              kind: ["received", "receivable"],
            })
          : Promise.resolve([]),
        clientId && contractIds.length
          ? checked(
              db
                .from("collection_cases")
                .select("*")
                .in("contract_id", contractIds),
            )
          : Promise.resolve([]),
        clientId
          ? allRows(db, "client_events", "*", { client_id: clientId })
          : Promise.resolve([]),
        allRows(db, "qlik_companies"),
        allRows(db, "qlik_works"),
        checked(
          service
            .from("profiles")
            .select("user_id,full_name")
            .eq("active", true)
            .is("deleted_at", null)
            .order("full_name"),
        ),
      ],
    );
    return paymentJson({
      total: list.total,
      clients,
      contracts,
      entries,
      cases,
      events,
      companies,
      works,
      users,
      canWrite: canWriteModule("clientes"),
    });
  } catch (e) {
    return paymentFailure(e);
  }
}
const schema = z.object({
  id: z.uuid().optional(),
  client_id: z.string().min(1),
  contract_id: z.string().nullable(),
  kind: z.enum([
    "contact",
    "renegotiation",
    "legal",
    "document",
    "regularization",
  ]),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(10000),
  event_date: z.iso.date(),
  due_date: z.iso.date().nullable(),
  status: z.enum(["open", "in_progress", "completed", "cancelled"]),
  responsible_user_id: z.uuid().nullable(),
});
export async function POST(request: Request) {
  try {
    const { service, actor } = await operationsAccess(
      request,
      ["clientes"],
      true,
    );
    const body = schema.parse(await paymentBody(request));
    if (body.contract_id) {
      const c = await checked(
        service
          .from("client_contracts")
          .select("client_id")
          .eq("id", body.contract_id)
          .single(),
      );
      if (c.client_id !== body.client_id)
        throw new PaymentError("Contrato não pertence a este cliente.");
    }
    if (body.id) {
      await checked(
        service
          .from("client_events")
          .update({ ...body, updated_at: new Date().toISOString() })
          .eq("id", body.id)
          .eq("client_id", body.client_id)
          .select("id")
          .single(),
      );
    } else
      await checked(
        service.from("client_events").insert({ ...body, created_by: actor.id }),
      );
    return paymentJson({ ok: true });
  } catch (e) {
    return paymentFailure(e);
  }
}
