import { after } from "next/server";
import {
  createPayment,
  paymentActor,
  paymentDb,
  paymentFailure,
  paymentJson,
} from "@/lib/payment-server";
import { dispatchPaymentEmails } from "@/lib/payment-email";

export const runtime = "nodejs";
export const maxDuration = 240;
export async function POST(request: Request) {
  try {
    const result = await createPayment(request);
    after(async () => {
      try {
        await dispatchPaymentEmails();
      } catch {
        console.error("Payment notifications remain queued");
      }
    });
    return paymentJson(result, 201);
  } catch (error) {
    return paymentFailure(error);
  }
}
export async function GET(request: Request) {
  try {
    const db = paymentDb(),
      actor = (await paymentActor(request, db))!;
    const url = new URL(request.url);
    const mode = url.searchParams.get("scope") === "management";
    const page = Math.max(
      0,
      Math.min(100000, Number(url.searchParams.get("page")) || 0),
    );
    let query = db
      .from("payment_requests")
      .select(
        "id,protocol,type,title,company_name,company_key,requester_name,amount,budget_max,due_date,status,created_at,source",
        { count: "exact" },
      )
      .order("created_at", { ascending: false });
    if (!mode || !actor.manager)
      query = query.eq("requester_user_id", actor.id);
    const status = url.searchParams.get("status"),
      type = url.searchParams.get("type"),
      company = url.searchParams.get("company");
    if (status) query = query.eq("status", status);
    if (type) query = query.eq("type", type);
    if (company) query = query.eq("company_key", company);
    const search = url.searchParams.get("search")?.trim();
    if (search) {
      if (/^(PAG-)?\d+$/i.test(search))
        query = query.eq("protocol", Number(search.replace(/^PAG-/i, "")));
      else
        query = query.ilike(
          "title",
          `%${search.replace(/[%_\\]/g, "").slice(0, 100)}%`,
        );
    }
    const { data, error, count } = await query.range(page * 40, page * 40 + 39);
    if (error) throw error;
    return paymentJson({
      rows: data,
      count,
      can_manage: actor.manager,
      actor: { name: actor.name, email: actor.email },
    });
  } catch (error) {
    return paymentFailure(error);
  }
}
