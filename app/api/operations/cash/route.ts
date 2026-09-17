import { z } from "zod";
import {
  operationsAccess,
  allRows,
  allRpcRows,
  checked,
} from "@/lib/operations-server";
import {
  paymentBody,
  paymentFailure,
  paymentJson,
  PaymentError,
} from "@/lib/payment-server";
import { localToday } from "@/lib/operational-finance";
export async function GET(request: Request) {
  try {
    const { db, service, canWrite } = await operationsAccess(request, [
      "financeiro",
    ]);
    const date = new URL(request.url).searchParams.get("date") || localToday();
    z.iso.date().parse(date);
    const [
      companies,
      catalog,
      entries,
      balances,
      reconciliations,
      commitments,
      works,
      payments,
      connection,
    ] = await Promise.all([
      allRows(db, "qlik_companies"),
      allRows(db, "qlik_works"),
      allRpcRows(db, "operational_cash_projection", { p_date: date }),
      allRows(db, "cash_opening_balances", "*", { as_of: date }),
      allRows(db, "cash_reconciliations"),
      allRows(db, "construction_commitments"),
      allRows(service, "constructions", "id,name,qlik_work_key"),
      checked(
        service
          .from("payment_requests")
          .select(
            "id,protocol,company_key,qlik_work_key,title,amount,due_date,scheduled_date,status",
          )
          .is("deleted_at", null)
          .in("status", ["approved", "scheduled"])
          .order("due_date")
          .limit(5000),
      ),
      checked(
        service
          .from("data_connections")
          .select("last_success_at,last_error_at,active")
          .eq("slug", "qlik-operations")
          .maybeSingle(),
      ),
    ]);
    return paymentJson({
      companies,
      catalog,
      entries,
      balances,
      reconciliations,
      commitments,
      works,
      payments,
      connection,
      canWrite,
    });
  } catch (e) {
    return paymentFailure(e);
  }
}
const input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("balance"),
    company_id: z.string().min(1),
    as_of: z.iso.date(),
    amount: z.number().finite().min(-1e12).max(1e12),
    note: z.string().max(2000),
  }),
  z.object({
    action: z.literal("reconcile"),
    request_id: z.uuid(),
    state: z.enum(["additional", "linked"]),
    cash_entry_id: z.string().nullable(),
  }),
]);
export async function POST(request: Request) {
  try {
    const { service, actor } = await operationsAccess(
      request,
      ["financeiro"],
      true,
    );
    const body = input.parse(await paymentBody(request));
    if (body.action === "balance") {
      await checked(
        service.from("cash_opening_balances").upsert({
          company_id: body.company_id,
          as_of: body.as_of,
          amount: body.amount,
          note: body.note,
          updated_by: actor.id,
          updated_at: new Date().toISOString(),
        }),
      );
    } else {
      const p = await checked(
        service
          .from("payment_requests")
          .select("company_key,qlik_work_key,status,amount")
          .eq("id", body.request_id)
          .is("deleted_at", null)
          .single(),
      );
      if (!p || !["approved", "scheduled"].includes(p.status))
        throw new PaymentError(
          "A solicitação não está mais aprovada ou agendada.",
          409,
        );
      if (body.state === "linked") {
        if (!body.cash_entry_id)
          throw new PaymentError("Selecione o lançamento correspondente.");
        const entry = await checked(
          service
            .from("operational_cash_entries")
            .select("company_id,kind,work_key,active,amount")
            .eq("id", body.cash_entry_id)
            .single(),
        );
        const company = await checked(
          service
            .from("qlik_companies")
            .select("company_key")
            .eq("id", entry.company_id)
            .single(),
        );
        if (
          company.company_key !== p.company_key ||
          !["payable", "paid"].includes(entry.kind) ||
          !entry.active ||
          p.amount === null ||
          Math.abs(Number(entry.amount) - Number(p.amount)) > 0.01 ||
          (p.qlik_work_key && entry.work_key !== p.qlik_work_key)
        )
          throw new PaymentError(
            "O lançamento precisa pertencer à mesma empresa e obra e ter o mesmo valor da solicitação.",
          );
      }
      await checked(
        service.from("cash_reconciliations").upsert({
          request_id: body.request_id,
          state: body.state,
          cash_entry_id: body.state === "linked" ? body.cash_entry_id : null,
          updated_by: actor.id,
          updated_at: new Date().toISOString(),
        }),
      );
    }
    return paymentJson({ ok: true });
  } catch (e) {
    return paymentFailure(e);
  }
}
