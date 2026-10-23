import { z } from "zod";
import { distratoAccess } from "@/lib/distratos-server";
import { paymentFailure, paymentJson, paymentLimit, PaymentError } from "@/lib/payment-server";
import { checked } from "@/lib/operations-server";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    const { db, actor } = await distratoAccess(request);
    await paymentLimit(db, `distrato-sale:${actor.id}`, 20, 3600);
    const id = z.string().min(1).max(160).parse(new URL(request.url).searchParams.get("contractId"));
    const contract = await checked(db.from("client_contracts").select("id").eq("id", id).maybeSingle());
    if (!contract) throw new PaymentError("Contrato não encontrado.", 404);
    if (!process.env.QLIK_USERNAME || !process.env.QLIK_PASSWORD) throw new PaymentError("Consulta da venda indisponível. Informe o valor e a data do contrato.", 503);
    const { readOperationalQlik } = await import("@/lib/qlik-operational");
    const { qlikDate } = await import("@/lib/qlik-operational-mapping");
    const inspected = await readOperationalQlik([], true, undefined, "sales");
    const names = (inspected.fields as Array<{ qName?: string }>).map((f) => f.qName || "");
    // Exact, explicit original-price labels only; never substitute a balance,
    // current valuation, installment amount or aggregated receipts.
    const priceFields = ["Valor Venda", "Valor Total Venda", "Valor Original Venda"].filter((n) => names.includes(n));
    if (!names.includes("Data Venda") || !names.includes("%IdVenda") || priceFields.length !== 1) throw new PaymentError("Valor original ou data da venda não identificados com segurança no Qlik. Preencha conforme o contrato.", 422);
    const result = await readOperationalQlik([{
      key: "distrato-sale", fields: ["%IdVenda", "Data Venda", priceFields[0]],
      filters: [{ field: "%IdVenda", value: id }], maxRows: 2,
    }], false, undefined, "sales");
    if (result.cubes[0]?.rows.length !== 1) throw new PaymentError("A venda não retornou um único valor original. Confira o contrato.", 422);
    const row = result.cubes[0].rows[0];
    if (row[0].text !== id || row[2].number === null || row[2].number <= 0) throw new PaymentError("Os dados retornados não identificam a venda selecionada.", 422);
    return paymentJson({ saleDate: qlikDate(row[1]), saleValue: row[2].number, source: "Qlik · Data Venda / " + priceFields[0] });
  } catch (error) { return paymentFailure(error); }
}
