import { createHash } from "node:crypto";
import { z } from "zod";
import { operationsAccess, allRows } from "@/lib/operations-server";
import { paymentFailure, paymentJson, PaymentError } from "@/lib/payment-server";
import { localToday } from "@/lib/operational-finance";
import { QLIK_FINANCE_APPS } from "@/lib/qlik-finance";
import { scrapeQlikCloudMetrics } from "@/lib/qlik-cloud";
import {
  BANK_BALANCE_CACHE_MS,
  WEEKLY_BANK_METRIC,
  bankBalanceApp,
  verifiedBankBalance,
  type CashBankBalance,
} from "@/lib/cash-bank-balance";

export const runtime = "nodejs";
export const maxDuration = 300;
const inFlight = new Map<string, Promise<CashBankBalance>>();

export async function GET(request: Request) {
  try {
    // Authorization precedes both cache reads and expensive Qlik access.
    const { db, service } = await operationsAccess(request, ["financeiro"]);
    const params = new URL(request.url).searchParams;
    const date = z.iso.date().parse(params.get("date") || localToday());
    const companyId = z.string().max(200).parse(params.get("company_id") || "");
    const refresh = z.coerce.number().finite().min(0).parse(params.get("refresh") || 0);
    if (date > localToday()) {
      throw new PaymentError("O Qlik não possui saldo bancário realizado para uma data futura. Use um saldo manual para esse cenário.", 422);
    }
    const companies = await allRows(db, "qlik_companies", "id");
    const ids = (companies as Array<{ id: string }>).map((c) => c.id).filter((id) => !companyId || id === companyId).sort();
    if (!ids.length) throw new PaymentError("Empresa não encontrada no catálogo financeiro.", 404);
    const scope = createHash("sha256").update(JSON.stringify(ids)).digest("hex");
    const key = `${date}:${scope}`;
    const { data: cached, error: cacheError } = await service.from("cash_bank_balance_snapshots")
      .select("amount,synchronized_at,account_count")
      .eq("as_of", date).eq("scope_hash", scope).maybeSingle();
    if (cacheError) throw new PaymentError("Não foi possível consultar o saldo bancário. Tente atualizar novamente.", 503);
    const cachedBalance: CashBankBalance | null = cached && cached.amount !== null && Number.isFinite(Number(cached.amount))
      ? { amount: Number(cached.amount), synchronized_at: cached.synchronized_at,
          account_count: Number(cached.account_count), as_of: date, company_id: companyId, source: "Qlik DFC", stale: false }
      : null;
    const age = cachedBalance ? Date.now() - Date.parse(cachedBalance.synchronized_at) : Infinity;
    // A refresh always checks Qlik after the short coalescing window; normal navigation uses a five-minute cache.
    if (cachedBalance && age >= 0 && age < BANK_BALANCE_CACHE_MS
      && (Date.parse(cachedBalance.synchronized_at) >= refresh || age < 30_000)) {
      return paymentJson(cachedBalance);
    }
    let task = inFlight.get(key);
    if (!task) {
      task = (async () => {
        const configuration = await service.from("data_connections").select("active").eq("slug", "qlik-finance").maybeSingle();
        if (configuration.error || !configuration.data?.active) throw new Error("A conexão financeira está pausada ou indisponível.");
        const source = QLIK_FINANCE_APPS.find((app) => app.metrics.some((m) => m.metricKey === "saldo_conta_alugueis"));
        const username = process.env.QLIK_USERNAME;
        const password = process.env.QLIK_PASSWORD;
        if (!source || !username || !password) throw new Error("Fonte de saldo Qlik indisponível.");
        const snapshots = await scrapeQlikCloudMetrics({
          username, password, apps: [bankBalanceApp(source, date, ids)],
          year: Number(date.slice(0, 4)), throughMonth: Number(date.slice(5, 7)),
        });
        const snapshot = snapshots.find((item) => item.metricKey === WEEKLY_BANK_METRIC);
        if (!snapshot) throw new Error("A composição bancária não retornou saldo.");
        const result = verifiedBankBalance(snapshot, date, companyId, new Date().toISOString());
        const { error } = await service.from("cash_bank_balance_snapshots").upsert({
          as_of: date, scope_hash: scope, company_ids: ids, amount: result.amount,
          account_count: result.account_count, synchronized_at: result.synchronized_at,
          source_app_id: snapshot.appId, source_sheet_id: snapshot.sheetId, source_object_id: snapshot.objectId,
        }, { onConflict: "as_of,scope_hash" });
        if (error) throw new Error("Não foi possível guardar o saldo bancário validado.");
        return result;
      })();
      inFlight.set(key, task);
    }
    try {
      // The same scope may be requested as one company or as the entire one-company catalog.
      return paymentJson({ ...await task, company_id: companyId });
    } catch {
      if (cachedBalance) return paymentJson({ ...cachedBalance, stale: true });
      throw new PaymentError("O saldo do Qlik não pôde ser atualizado. Entradas e saídas continuam disponíveis; nenhum saldo foi estimado.", 503);
    } finally {
      if (inFlight.get(key) === task) inFlight.delete(key);
    }
  } catch (error) {
    return paymentFailure(error);
  }
}
