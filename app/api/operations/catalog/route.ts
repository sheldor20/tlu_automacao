import { paymentDb, paymentFailure, paymentJson } from "@/lib/payment-server";
export async function GET() {
  try {
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
