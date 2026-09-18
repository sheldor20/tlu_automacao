import type { QlikCloudMetricApp, QlikMetricSnapshot } from "./qlik-cloud";

export const WEEKLY_BANK_METRIC = "saldo_banco_semanal";
export const BANK_BALANCE_CACHE_MS = 5 * 60_000;

export type CashBankBalance = {
  amount: number;
  as_of: string;
  company_id: string;
  synchronized_at: string;
  account_count: number;
  source: "Qlik DFC";
  stale: boolean;
};

/** Reuse the validated DFC account composition, not the monthly KPI or rental filters. */
export function bankBalanceApp(
  source: QlikCloudMetricApp,
  asOf: string,
  companyIds: string[],
): QlikCloudMetricApp {
  const instant = Date.parse(`${asOf}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(instant)
    || new Date(instant).toISOString().slice(0, 10) !== asOf) {
    throw new Error("Data de saldo inválida.");
  }
  const ids = [...new Set(companyIds)].sort();
  if (!ids.length || ids.some((id) => !id.trim())) throw new Error("Selecione uma empresa válida.");
  const original = source.metrics.find((metric) => metric.metricKey === "saldo_conta_alugueis");
  if (!original?.objectId || original.aggregation !== "sum-rows" || !original.periodVariables?.length) {
    throw new Error("A referência de saldo do DFC não está configurada.");
  }
  const serial = (instant - Date.UTC(1899, 11, 30)) / 86_400_000;
  return {
    entryUrl: source.entryUrl,
    isolatedSession: true,
    metrics: [{
      metricKey: WEEKLY_BANK_METRIC,
      sheetId: original.sheetId,
      objectId: original.objectId,
      targetLabel: original.targetLabel,
      aggregation: "sum-rows",
      stateName: original.stateName,
      mode: "snapshot",
      variables: original.periodVariables.map((name) => ({ name, value: serial, label: asOf })),
      filters: [{
        label: "empresas da seleção do fluxo de caixa",
        fieldCandidates: ["%IdEmpresa"],
        values: ids,
        requireAllValues: true,
      }],
    }],
  };
}

export function verifiedBankBalance(
  snapshot: QlikMetricSnapshot,
  asOf: string,
  companyId: string,
  synchronizedAt: string,
): CashBankBalance {
  const selections = snapshot.selections;
  const count = Number(selections.account_count);
  const total = Number(selections.qlik_total);
  if (snapshot.metricKey !== WEEKLY_BANK_METRIC || !Number.isFinite(snapshot.value)
    || !selections.qlik_total?.trim() || !Number.isFinite(total)
    || !Number.isInteger(count) || count < 1
    || Math.abs(snapshot.value - total) > 0.011
    || selections.vPosicaoInicialDFC !== asOf || selections.vPosicaoFinalDFC !== asOf) {
    throw new Error("O saldo bancário não foi confirmado na composição do DFC.");
  }
  return {
    amount: snapshot.value,
    as_of: asOf,
    company_id: companyId,
    synchronized_at: synchronizedAt,
    account_count: count,
    source: "Qlik DFC",
    stale: false,
  };
}

/** Never carry an old request's amount into a different date or company. Zero is valid. */
export function bankBalanceForSelection(
  balance: CashBankBalance | null | undefined,
  asOf: string,
  companyId: string,
): CashBankBalance | null {
  return balance?.as_of === asOf && balance.company_id === companyId
    && typeof balance.amount === "number" && Number.isFinite(balance.amount)
    ? balance : null;
}
