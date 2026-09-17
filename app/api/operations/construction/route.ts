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
    const { db, service, canWrite } = await operationsAccess(request, [
      "obras",
    ]);
    const id = z.uuid().parse(new URL(request.url).searchParams.get("id"));
    const work = await checked(
      db
        .from("constructions")
        .select("id,name,source_business_id,qlik_work_key,planned_budget")
        .eq("id", id)
        .single(),
    );
    const [commitments, estimate, entries, stages, mappings, stageBudgets] =
      await Promise.all([
        allRows(db, "construction_commitments", "*", { construction_id: id }),
        checked(
          db
            .from("construction_cost_estimates")
            .select("*")
            .eq("construction_id", id)
            .maybeSingle(),
        ),
        work.qlik_work_key
          ? allRows(db, "operational_cash_entries", "*", {
              work_key: work.qlik_work_key,
              active: true,
              kind: ["paid", "payable"],
            })
          : Promise.resolve([]),
        checked(
          db
            .from("construction_macro_stages")
            .select("id,name,weight_percent,progress_percent")
            .eq("construction_id", id)
            .order("position"),
        ),
        allRows(db, "construction_stage_mappings", "*", {
          construction_id: id,
        }),
        allRows(db, "construction_stage_finances", "*", {
          construction_id: id,
        }),
      ]);
    const payments = work.qlik_work_key
      ? await checked(
          service
            .from("payment_requests")
            .select("id,title,status,amount,qlik_work_key")
            .eq("qlik_work_key", work.qlik_work_key)
            .is("deleted_at", null)
            .limit(5000),
        )
      : [];
    const reconciliations = payments.length
      ? await checked(
          service
            .from("cash_reconciliations")
            .select("request_id,state,cash_entry_id")
            .in(
              "request_id",
              payments.map((p) => p.id),
            ),
        )
      : [];
    return paymentJson({
      mappings,
      stageBudgets,
      reconciliations,
      work,
      commitments,
      estimate,
      entries,
      stages,
      payments,
      canWrite,
    });
  } catch (e) {
    return paymentFailure(e);
  }
}
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("stage_budget"),
    id: z.uuid(),
    macro_stage_id: z.uuid(),
    planned_budget: z.number().nonnegative().max(1e12),
    remaining_uncommitted: z.number().nonnegative().max(1e12).nullable(),
  }),
  z.object({
    action: z.literal("stage_mapping"),
    id: z.uuid(),
    macro_stage_id: z.uuid(),
    source_category: z.string().min(1).max(500),
  }),
  z.object({
    action: z.literal("link"),
    id: z.uuid(),
    work_key: z.string().nullable(),
  }),
  z.object({
    action: z.literal("estimate"),
    id: z.uuid(),
    remaining_uncommitted: z.number().finite().nonnegative().max(1e12),
    note: z.string().max(3000),
  }),
  z.object({
    action: z.literal("commitment"),
    id: z.uuid(),
    commitment_id: z.uuid().optional(),
    macro_stage_id: z.uuid().nullable(),
    supplier: z.string().trim().min(1).max(300),
    description: z.string().trim().min(1).max(1000),
    due_date: z.iso.date(),
    amount: z.number().finite().positive().max(1e12),
    status: z.enum(["committed", "paid", "cancelled"]),
    payment_request_id: z.uuid().nullable(),
    cash_entry_id: z.string().nullable(),
  }),
]);
export async function POST(request: Request) {
  try {
    const { db, service, actor } = await operationsAccess(
      request,
      ["obras"],
      true,
    );
    const b = schema.parse(await paymentBody(request));
    const work = await checked(
      db
        .from("constructions")
        .select("id,source_business_id,qlik_work_key")
        .eq("id", b.id)
        .single(),
    );
    if (b.action === "stage_budget" || b.action === "stage_mapping") {
      const stage = await checked(
        db
          .from("construction_macro_stages")
          .select("construction_id")
          .eq("id", b.macro_stage_id)
          .single(),
      );
      if (stage.construction_id !== b.id)
        throw new PaymentError("Etapa de outra obra.");
      const base = {
        construction_id: b.id,
        macro_stage_id: b.macro_stage_id,
        updated_by: actor.id,
        updated_at: new Date().toISOString(),
      };
      if (b.action === "stage_budget")
        await checked(
          service.from("construction_stage_finances").upsert({
            ...base,
            planned_budget: b.planned_budget,
            remaining_uncommitted: b.remaining_uncommitted,
          }),
        );
      else
        await checked(
          service
            .from("construction_stage_mappings")
            .upsert({ ...base, source_category: b.source_category }),
        );
    } else if (b.action === "link") {
      if (b.work_key)
        await checked(
          service
            .from("qlik_works")
            .select("key")
            .eq("key", b.work_key)
            .eq("active", true)
            .single(),
        );
      if (work.source_business_id)
        await checked(
          service
            .from("businesses")
            .update({ qlik_work_key: b.work_key })
            .eq("id", work.source_business_id),
        );
      await checked(
        service
          .from("constructions")
          .update({ qlik_work_key: b.work_key })
          .eq("id", b.id),
      );
    } else if (b.action === "estimate")
      await checked(
        service.from("construction_cost_estimates").upsert({
          construction_id: b.id,
          remaining_uncommitted: b.remaining_uncommitted,
          note: b.note,
          updated_by: actor.id,
          updated_at: new Date().toISOString(),
        }),
      );
    else {
      if (!work.qlik_work_key)
        throw new PaymentError(
          "Vincule a obra ao Qlik antes de cadastrar compromissos.",
        );
      if (b.macro_stage_id) {
        const stage = await checked(
          db
            .from("construction_macro_stages")
            .select("construction_id")
            .eq("id", b.macro_stage_id)
            .single(),
        );
        if (stage.construction_id !== b.id)
          throw new PaymentError("Etapa de outra obra.");
      }
      if (b.payment_request_id) {
        const p = await checked(
          service
            .from("payment_requests")
            .select("qlik_work_key,amount")
            .eq("id", b.payment_request_id)
            .is("deleted_at", null)
            .single(),
        );
        if (
          p.qlik_work_key !== work.qlik_work_key ||
          p.amount === null ||
          Math.abs(Number(p.amount) - b.amount) > 0.01
        )
          throw new PaymentError(
            "A solicitação deve pertencer à mesma obra e ter o mesmo valor do compromisso.",
          );
      }
      if (b.cash_entry_id) {
        const c = await checked(
          db
            .from("operational_cash_entries")
            .select("work_key,kind,active,amount")
            .eq("id", b.cash_entry_id)
            .single(),
        );
        if (
          c.work_key !== work.qlik_work_key ||
          !["payable", "paid"].includes(c.kind) ||
          !c.active ||
          Math.abs(Number(c.amount) - b.amount) > 0.01
        )
          throw new PaymentError("Lançamento de outra obra ou inválido.");
      }
      const data = {
        construction_id: b.id,
        macro_stage_id: b.macro_stage_id,
        supplier: b.supplier,
        description: b.description,
        due_date: b.due_date,
        amount: b.amount,
        status: b.status,
        payment_request_id: b.payment_request_id,
        cash_entry_id: b.cash_entry_id,
      };
      if (b.commitment_id)
        await checked(
          service
            .from("construction_commitments")
            .update(data)
            .eq("id", b.commitment_id)
            .eq("construction_id", b.id)
            .select("id")
            .single(),
        );
      else
        await checked(
          service
            .from("construction_commitments")
            .insert({ ...data, created_by: actor.id }),
        );
    }
    return paymentJson({ ok: true });
  } catch (e) {
    return paymentFailure(e);
  }
}
