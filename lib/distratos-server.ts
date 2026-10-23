import { createHash } from "node:crypto";
import { allRows, checked } from "./operations-server";
import { paymentActor, paymentDb, PaymentError } from "./payment-server";
import { displayWorkCode, type DistratoReceipt, type DistratoUnit } from "./distratos";
import { paidInstallments, type InstallmentEntry } from "./distratos-prefill";
import { localToday } from "./operational-finance";

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
  const publications = () => checked(db.from("operational_publications").select("kind,published_at").in("kind", ["received", "receivable"]).order("kind"));
  const before = await publications();
  const publication = before.find((p) => p.kind === "received");
  const [work, company, buyer, entries, receivable] = await Promise.all([
    checked(db.from("qlik_works").select("key,work_id,name,company_id").eq("key", contract.work_key).single()),
    checked(db.from("qlik_companies").select("name").eq("id", contract.company_id).single()),
    checked(db.from("client_accounts").select("name").eq("id", contract.client_id).single()),
    allRows(db, "operational_cash_entries", "id,title_key,cash_date,amount,description,company_id,work_key", { active: true, kind: "received", contract_id: contractId }),
    allRows(db, "operational_cash_entries", "id,title_key,cash_date,amount,company_id,work_key", { active: true, kind: "receivable", contract_id: contractId }),
  ]);
  if (!publication?.published_at) throw new PaymentError("A base de recebimentos do Qlik ainda não foi publicada.", 409);
  if (work.company_id !== contract.company_id || [...entries, ...receivable].some((e) => e.company_id !== contract.company_id || e.work_key !== contract.work_key)) throw new PaymentError("O vínculo de empresa e obra dos recebimentos precisa ser conciliado.", 409);
  if (entries.some((e) => !e.cash_date || !Number.isFinite(Number(e.amount)))) throw new PaymentError("Há recebimentos sem data ou valor válido. Corrija a origem antes de gerar.", 422);
  const receipts: DistratoReceipt[] = entries.filter((e) => Number(e.amount) !== 0).map((e) => ({ id: String(e.id), date: String(e.cash_date), amount: Number(e.amount), description: String(e.description || "Recebimento") })).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const after = await publications();
  const paid = paidInstallments(entries as InstallmentEntry[], receivable as InstallmentEntry[], publication.published_at, before.find((p) => p.kind === "receivable")?.published_at || null, localToday(), JSON.stringify(before) === JSON.stringify(after));
  const unit: DistratoUnit = {
    contractId, contractNumber: contract.contract_number, companyId: contract.company_id, companyName: company.name,
    workKey: work.key, workCode: displayWorkCode(work.work_id), workName: work.name, block: contract.block, lot: contract.lot,
    buyerName: buyer.name, synchronizedAt: publication.published_at, receipts, paidInstallments: paid,
  };
  return { unit, sourceRevision: createHash("sha256").update(JSON.stringify(unit)).digest("hex") };
}
