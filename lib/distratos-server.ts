import { createHash } from "node:crypto";
import { allRows, checked } from "./operations-server";
import { paymentActor, paymentDb, PaymentError } from "./payment-server";
import { displayWorkCode, type DistratoReceipt, type DistratoUnit } from "./distratos";

export async function distratoAccess(request: Request, write = false) {
  const db = paymentDb();
  const actor = (await paymentActor(request, db))!;
  const permission = await checked(db.from("profile_departments").select("access_level").eq("user_id", actor.id).eq("department_slug", "distratos").maybeSingle());
  if (!actor.admin && (!permission || (write && permission.access_level === "viewer"))) throw new PaymentError("Você não tem permissão para acessar distratos.", 403);
  return { db, actor, canWrite: actor.admin || permission?.access_level !== "viewer" };
}

export async function loadDistratoUnit(db: ReturnType<typeof paymentDb>, contractId: string) {
  const contract = await checked(db.from("client_contracts").select("id,client_id,company_id,work_key,contract_number,block,lot").eq("id", contractId).maybeSingle());
  if (!contract || !contract.work_key || !contract.block || !contract.lot) throw new PaymentError("Selecione um contrato com obra, quadra e lote identificados no Qlik.", 422);
  const [work, company, buyer, entries, publication] = await Promise.all([
    checked(db.from("qlik_works").select("key,work_id,name,company_id").eq("key", contract.work_key).single()),
    checked(db.from("qlik_companies").select("name").eq("id", contract.company_id).single()),
    checked(db.from("client_accounts").select("name").eq("id", contract.client_id).single()),
    allRows(db, "operational_cash_entries", "id,cash_date,amount,description,company_id,work_key", { active: true, kind: "received", contract_id: contractId }),
    checked(db.from("operational_publications").select("published_at").eq("kind", "received").maybeSingle()),
  ]);
  if (!publication?.published_at) throw new PaymentError("A base de recebimentos do Qlik ainda não foi publicada.", 409);
  if (work.company_id !== contract.company_id || entries.some((e) => e.company_id !== contract.company_id || e.work_key !== contract.work_key)) throw new PaymentError("O vínculo de empresa e obra dos recebimentos precisa ser conciliado.", 409);
  if (entries.some((e) => !e.cash_date || !Number.isFinite(Number(e.amount)))) throw new PaymentError("Há recebimentos sem data ou valor válido. Corrija a origem antes de gerar.", 422);
  const receipts: DistratoReceipt[] = entries.filter((e) => Number(e.amount) !== 0).map((e) => ({ id: String(e.id), date: String(e.cash_date), amount: Number(e.amount), description: String(e.description || "Recebimento") })).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const unit: DistratoUnit = {
    contractId, contractNumber: contract.contract_number, companyId: contract.company_id, companyName: company.name,
    workKey: work.key, workCode: displayWorkCode(work.work_id), workName: work.name, block: contract.block, lot: contract.lot,
    buyerName: buyer.name, synchronizedAt: publication.published_at, receipts,
  };
  return { unit, sourceRevision: createHash("sha256").update(JSON.stringify(unit)).digest("hex") };
}
