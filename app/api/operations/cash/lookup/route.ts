import { z } from "zod";
import { operationsAccess, checked } from "@/lib/operations-server";
import { paymentJson, paymentFailure } from "@/lib/payment-server";
import { addDays } from "@/lib/operational-finance";
export async function GET(request: Request) {
  try {
    const { db } = await operationsAccess(request, ["financeiro"]);
    const p = new URL(request.url).searchParams;
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .parse(p.get("page") || 0);
    let q = db
      .from("operational_cash_entries")
      .select("*", { count: "exact" })
      .eq("active", true)
      .order("amount", { ascending: false })
      .order("id")
      .range(page * 100, page * 100 + 99);
    if (p.get("company_key")) {
      const company = await checked(
        db
          .from("qlik_companies")
          .select("id")
          .eq("company_key", p.get("company_key"))
          .single(),
      );
      q = q.eq("company_id", company.id);
    }
    if (p.get("company_id")) q = q.eq("company_id", p.get("company_id"));
    if (p.get("work_key")) q = q.eq("work_key", p.get("work_key"));
    if (p.get("date")) {
      const date = z.iso.date().parse(p.get("date"));
      const week = z.coerce
        .number()
        .int()
        .min(-1)
        .max(12)
        .parse(p.get("week") || 0);
      q = q.in("kind", ["receivable", "payable"]);
      if (week < 0) q = q.or(`cash_date.lt.${date},cash_date.is.null`);
      else
        q = q
          .gte("cash_date", addDays(date, week * 7))
          .lte("cash_date", addDays(date, week * 7 + 6));
    } else q = q.in("kind", ["paid", "payable"]);
    const search = z
      .string()
      .max(150)
      .parse(p.get("q") || "")
      .replace(/[^\p{L}\p{N} .-]/gu, "");
    if (search)
      q = q.or(
        `description.ilike.*${search}*,counterparty.ilike.*${search}*,title_key.ilike.*${search}*`,
      );
    const result = await q;
    if (result.error) throw result.error;
    return paymentJson({ entries: result.data, total: result.count || 0 });
  } catch (e) {
    return paymentFailure(e);
  }
}
