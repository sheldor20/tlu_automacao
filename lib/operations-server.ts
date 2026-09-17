import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { paymentActor, paymentDb, PaymentError } from "./payment-server";
export type OperationsModule =
  "financeiro" | "clientes" | "cobranca" | "obras" | "novos-negocios";
export async function operationsAccess(
  request: Request,
  modules: OperationsModule[],
  write = false,
) {
  const service = paymentDb();
  const actor = (await paymentActor(request, service))!;
  const { data, error } = await service
    .from("profile_departments")
    .select("department_slug,access_level")
    .eq("user_id", actor.id)
    .in("department_slug", modules);
  if (error) throw error;
  if (
    !actor.admin &&
    (!data?.length || (write && !data.some((p) => p.access_level !== "viewer")))
  )
    throw new PaymentError("Você não tem acesso a esta operação.", 403);
  const token = request.headers
    .get("authorization")!
    .replace(/^Bearer\s+/i, "");
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  return {
    db,
    service,
    actor,
    canWriteModule: (module: OperationsModule) =>
      actor.admin ||
      !!data?.some(
        (p) => p.department_slug === module && p.access_level !== "viewer",
      ),
    canWrite: actor.admin || !!data?.some((p) => p.access_level !== "viewer"),
  };
}
export async function allRows(
  db: SupabaseClient,
  table: string,
  columns = "*",
  filters: Record<string, string | boolean | string[]> = {},
) {
  const result: Record<string, unknown>[] = [];
  for (let offset = 0; offset < 500000; offset += 1000) {
    let q = db
      .from(table)
      .select(columns)
      .order(
        (
          {
            construction_stage_mappings: "source_category",
            construction_stage_finances: "macro_stage_id",
            qlik_works: "key",
            collection_cases: "contract_id",
            cash_opening_balances: "company_id",
            construction_cost_estimates: "construction_id",
            cash_reconciliations: "request_id",
          } as Record<string, string>
        )[table] || "id",
      )
      .range(offset, offset + 999);
    for (const [key, value] of Object.entries(filters))
      q = Array.isArray(value) ? q.in(key, value) : q.eq(key, value);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) return result;
    result.push(...(data as unknown as Record<string, unknown>[]));
    if (data.length < 1000) return result;
  }
  throw new PaymentError(
    "A consulta excedeu o limite. Restrinja a carteira.",
    422,
  );
}
export async function checked<T>(
  query: PromiseLike<{ data: T; error: unknown }>,
): Promise<NonNullable<T>> {
  const r = await query;
  if (r.error) throw r.error;
  return r.data as NonNullable<T>;
}

export async function allRpcRows(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
) {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < 100000; offset += 1000) {
    const { data, error } = await db
      .rpc(name, args)
      .order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
  throw new PaymentError("Consulta excedeu o limite.", 422);
}
