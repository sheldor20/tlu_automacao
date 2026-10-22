import { paymentDb, paymentFailure, paymentJson } from "@/lib/payment-server";
import { operationsAccess, allRows, checked } from "@/lib/operations-server";
import { z } from "zod";
export async function GET(request: Request) {
  try {
    const constructionId = new URL(request.url).searchParams.get(
      "construction_id",
    );
    if (constructionId !== null) {
      const id = z.uuid().parse(constructionId);
      const { db } = await operationsAccess(request, ["obras"]);
      await checked(
        db.from("constructions").select("id").eq("id", id).single(),
      );
      const [companies, works] = await Promise.all([
        allRows(db, "qlik_companies", "id,name,company_key,synchronized_at"),
        allRows(db, "qlik_works", "key,company_id,work_id,name,active", {
          active: true,
        }),
      ]);
      return paymentJson({ companies, works });
    }
    const db = paymentDb();
    const [companies, works] = await Promise.all([
      db
        .from("qlik_companies")
        .select("id,name,company_key,synchronized_at")
        .order("name")
        .limit(1000),
      db
        .from("qlik_works")
        .select("key,company_id,work_id,name,active")
        .eq("active", true)
        .order("name")
        .limit(5000),
    ]);
    if (companies.error) throw companies.error;
    if (works.error) throw works.error;
    return paymentJson({ companies: companies.data, works: works.data });
  } catch (e) {
    return paymentFailure(e);
  }
}
