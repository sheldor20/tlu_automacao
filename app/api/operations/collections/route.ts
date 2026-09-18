import { z } from "zod";
import { operationsAccess, allRows, checked } from "@/lib/operations-server";
import {
  collectionFilterKey,
  normalizeCollectionQuery,
} from "@/lib/collection-totals";
import {
  paymentBody,
  paymentFailure,
  paymentJson,
  PaymentError,
} from "@/lib/payment-server";
export async function GET(request: Request) {
  try {
    const { db, service, canWrite } = await operationsAccess(request, [
      "cobranca",
    ]);
    const params = new URL(request.url).searchParams;
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .parse(params.get("page") || 0);
    const query = normalizeCollectionQuery(
      z.string().max(200).parse(params.get("q") || ""),
    );
    const company = z.string().max(200).parse(params.get("company") || "");
    const group = z
      .enum([
        "all",
        "current",
        "review",
        "judicial",
        "easy",
        "negotiation",
        "difficult",
      ])
      .parse(params.get("group") || "all");
    let q = db
      .from("collection_worklist")
      .select("*", { count: "exact" })
      .order("overdue_amount", { ascending: false })
      .order("id")
      .range(page * 25, page * 25 + 24);
    if (group === "all") q = q.neq("collection_group", "current");
    else q = q.eq("collection_group", group);
    if (company) q = q.eq("company_id", company);
    if (query)
      q = q.or(
        `client_name.ilike.*${query}*,contract_number.ilike.*${query}*,lot.ilike.*${query}*`,
      );
    const result = await q;
    if (result.error) throw result.error;
    const contracts = result.data || [],
      ids = contracts.map((c) => c.id);
    const clients = contracts.map((c) => ({
      id: c.client_id,
      name: c.client_name,
      phone: c.phone,
      email: c.email,
    }));
    // Aggregate before pagination. Reuse this result for global KPIs when unfiltered.
    const selectionTotalsQuery = checked(
      db.rpc("collection_worklist_filtered_totals", {
        p_company: company,
        p_query: query,
      }),
    );
    const totalsQuery = company || query
      ? checked(db.rpc("collection_worklist_totals"))
      : selectionTotalsQuery;
    const [cases, companies, works, users, totals, selectionTotals] = await Promise.all([
      ids.length
        ? checked(
            db.from("collection_cases").select("*").in("contract_id", ids),
          )
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
      totalsQuery,
      selectionTotalsQuery,
    ]);
    return paymentJson({
      clients,
      contracts,
      entries: [],
      total: result.count || 0,
      totals,
      selectionTotals,
      selectionScope: collectionFilterKey(query, company),
      cases,
      companies,
      works,
      users,
      canWrite,
    });
  } catch (e) {
    return paymentFailure(e);
  }
}
const schema = z.object({
  contract_id: z.string().min(1).max(500),
  version: z.number().int().nonnegative(),
  responsible_user_id: z.uuid().nullable(),
  legal_status: z.enum(["unknown", "extrajudicial", "judicial", "suspended"]),
  next_action: z.string().max(2000),
  next_action_date: z.iso.date().nullable(),
  last_contact_at: z.iso.datetime({ offset: true }).nullable(),
  promise_date: z.iso.date().nullable(),
  promise_amount: z.number().positive().max(1e12).nullable(),
  promise_status: z.enum(["none", "open", "fulfilled", "broken", "cancelled"]),
  receipt_entry_id: z.string().nullable(),
  notes: z.string().max(5000),
});
export async function POST(request: Request) {
  try {
    const { service, actor } = await operationsAccess(
      request,
      ["cobranca"],
      true,
    );
    const body = schema.parse(await paymentBody(request));
    const result = await service.rpc("save_collection_case", {
      p_data: body,
      p_actor: actor.id,
    });
    if (result.error) {
      if (result.error.message === "collection_conflict")
        throw new PaymentError(
          "Este contrato foi atualizado. Recarregue antes de salvar.",
          409,
        );
      if (result.error.message === "receipt_invalid")
        throw new PaymentError(
          "Selecione uma baixa do mesmo contrato que comprove o valor da promessa.",
          422,
        );
      throw result.error;
    }
    return paymentJson({ ok: true });
  } catch (e) {
    return paymentFailure(e);
  }
}
