import { createHash } from "node:crypto";
import { z } from "zod";
import { distratoInputSchema, calculateDistrato, distratoTerm, type DistratoDocument } from "@/lib/distratos";
import { correctDistratoValues } from "@/lib/distratos-juriscalc";
import { distratoAccess, loadDistratoUnit } from "@/lib/distratos-server";
import { allRows, checked } from "@/lib/operations-server";
import { paymentBody, paymentFailure, paymentJson, paymentLimit, PaymentError } from "@/lib/payment-server";
import { localToday } from "@/lib/operational-finance";
import { assertFruitionMonths } from "@/lib/distratos-prefill";

export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    const { db, canWrite } = await distratoAccess(request);
    const params = new URL(request.url).searchParams;
    const contractId = params.get("contractId");
    if (contractId) {
      z.string().max(160).parse(contractId);
      const [source, history] = await Promise.all([
        loadDistratoUnit(db, contractId),
        checked(db.from("distrato_documents").select("id,created_at,draft,input,calculation").eq("contract_id", contractId).order("created_at", { ascending: false }).limit(20)),
      ]);
      return paymentJson({ ...source, history, canWrite });
    }
    const workKey = params.get("workKey");
    if (workKey) {
      z.string().max(160).parse(workKey);
      const contracts = await allRows(db, "client_contracts", "id,client_id,contract_number,block,lot", { work_key: workKey });
      const ids = [...new Set(contracts.map((c) => String(c.client_id)))];
      const clients: Array<{ id: string; name: string }> = [];
      for (let i = 0; i < ids.length; i += 100) clients.push(...await checked(db.from("client_accounts").select("id,name").in("id", ids.slice(i, i + 100))));
      const names = new Map(clients.map((c) => [c.id, c.name]));
      return paymentJson({ contracts: contracts.filter((c) => c.block && c.lot).map((c) => ({ ...c, buyerName: names.get(String(c.client_id)) || "Cliente sem nome" })), canWrite });
    }
    const [works, companies] = await Promise.all([
      allRows(db, "qlik_works", "key,company_id,work_id,name", { active: true }),
      allRows(db, "qlik_companies", "id,name"),
    ]);
    return paymentJson({ works, companies, canWrite });
  } catch (error) { return paymentFailure(error); }
}
export async function POST(request: Request) {
  try {
    const { db, actor } = await distratoAccess(request, true);
    const input = distratoInputSchema.parse(await paymentBody(request));
    if (input.correctionDate > localToday() || input.saleDate < "1994-07-01") throw new PaymentError("Use uma data de venda a partir de julho de 1994 e uma data de cálculo até hoje.", 422);
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const previous = await checked(db.from("distrato_documents").select("*").eq("id", input.requestId).maybeSingle());
    if (previous) {
      if (previous.created_by !== actor.id || previous.request_hash !== hash) throw new PaymentError("Este envio já foi usado com outros dados. Gere um novo cálculo.", 409);
      return paymentJson({ document: previous });
    }
    await paymentLimit(db, `distrato:${actor.id}`, 30, 3600);
    const { unit, sourceRevision } = await loadDistratoUnit(db, input.contractId);
    if (sourceRevision !== input.sourceRevision) throw new PaymentError("A base deste lote mudou. Selecione a unidade novamente para conferir os recebimentos.", 409);
    try { assertFruitionMonths(input.fruitionMonths, unit.paidInstallments); }
    catch (error) { throw new PaymentError((error as Error).message, 422); }
    if (!unit.receipts.length) throw new PaymentError("Esta unidade não tem recebimentos publicados no Qlik.", 422);
    if (unit.receipts.length > 4000) throw new PaymentError("A unidade excedeu o limite de 4.000 lançamentos. Solicite a conferência da origem.", 422);
    let correction;
    try { correction = await correctDistratoValues(unit.receipts, input.saleDate, input.saleValue, input.correctionDate); }
    catch (error) { throw new PaymentError(error instanceof Error ? error.message : "Não foi possível atualizar os valores no TJDFT.", 502); }
    const after = await loadDistratoUnit(db, input.contractId);
    if (after.sourceRevision !== sourceRevision) throw new PaymentError("Os recebimentos mudaram durante o cálculo. Confira a unidade e gere novamente.", 409);
    const calculation = calculateDistrato(input, correction.values[0], correction.values.slice(1));
    const { term, draft } = distratoTerm(input, unit, calculation);
    const record: DistratoDocument = { id: input.requestId, created_at: new Date().toISOString(), created_by: actor.id, input, unit, correction, calculation, term, draft };
    const saved = await db.from("distrato_documents").insert({ ...record, contract_id: input.contractId, request_hash: hash }).select("*").single();
    if (saved.error?.code === "23505") {
      const concurrent = await checked(db.from("distrato_documents").select("*").eq("id", input.requestId).single());
      if (concurrent.created_by !== actor.id || concurrent.request_hash !== hash) throw new PaymentError("Este envio já foi usado com outros dados.", 409);
      return paymentJson({ document: concurrent });
    }
    if (saved.error) throw saved.error;
    return paymentJson({ document: saved.data }, 201);
  } catch (error) { return paymentFailure(error); }
}
