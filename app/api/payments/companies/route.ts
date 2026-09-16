import { paymentDb, paymentFailure, paymentJson } from "@/lib/payment-server";
export async function GET() {
  try {
    const db = paymentDb();
    const snapshot = await db
      .from("enterprise_performance_snapshots")
      .select("id,captured_at")
      .order("captured_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (snapshot.error) throw snapshot.error;
    if (!snapshot.data)
      return paymentJson({ companies: [], synchronized_at: null });
    const companies = await db
      .from("enterprise_performance_companies")
      .select("company_key,name")
      .eq("snapshot_id", snapshot.data.id)
      .order("name")
      .limit(1000);
    if (companies.error) throw companies.error;
    return paymentJson({
      companies: companies.data,
      synchronized_at: snapshot.data.captured_at,
    });
  } catch (error) {
    return paymentFailure(error);
  }
}
