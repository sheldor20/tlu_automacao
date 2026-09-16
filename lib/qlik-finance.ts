import type {
  QlikCloudMetricApp,
  QlikCloudMetricDefinition,
  QlikCloudMetricFilter,
  QlikMetricSnapshot,
} from "@/lib/qlik-cloud";
import { legalSalesReferenceMonths, saoPauloYearMonth } from "./qlik-legal-sales.ts";

export const QLIK_FINANCE_CONNECTION_SLUG = "qlik-finance";
export const QLIK_FINANCE_SOURCE = "Qlik Cloud - Financeiro";

const QLIK_TENANT = "https://terralotusurbanismo.us.qlikcloud.com";
const APP_ID = "e3d13862-ec1f-4332-8a5b-df4c7b93fa7c";
const BALANCE_SHEET = "08b38935-ed14-4061-a170-b7fdffdfbdcf";
const DFC_SHEET = "72ebe537-eacc-4f5e-95f7-6172c3788a51";
export const QLIK_RENTAL_BALANCE_OBJECT = "883da608-a05c-442b-9304-c5bb1d8eaa5e";
const RENTAL_ACCOUNT_COUNT = 9;
const REVENUE_SHEET = "bd84bea2-0f3c-4dc6-9081-0eab08502ba3";
const EXPENSE_SHEET = "e21bae6c-5983-4ea5-a12d-ddc68f7659d0";

const GROUP_FIELDS = ["Grupo", "Grupo Empresa", "Grupo Econômico", "Grupo Economico", "Nome Grupo"] as const;
const BALANCE_DATE_FIELDS = ["Data Saldo", "Data Movimento", "Data Lançamento", "Data Lancamento", "Data Caixa", "Data Vencimento"] as const;
const REVENUE_DATE_FIELDS = ["Data Recebimento", "Data Baixa", "Data Movimento", "Data Pagamento", "Data Vencimento", "Data"] as const;
const EXPENSE_DATE_FIELDS = ["Data Pagamento", "Data Baixa", "Data Movimento", "Data Vencimento", "Data Lançamento", "Data Lancamento", "Data"] as const;

const terraLotusFilter: QlikCloudMetricFilter = {
  label: "grupo Terra Lotus",
  fieldCandidates: GROUP_FIELDS,
  contains: ["Terra Lotus", "Terra Lótus"],
};

const rentalGroupsFilter: QlikCloudMetricFilter = {
  label: "grupos Particular e Terra Lotus",
  fieldCandidates: GROUP_FIELDS,
  contains: ["Particular", "Terra Lotus", "Terra Lótus"],
};

const rentalBankAccountFilter: QlikCloudMetricFilter = {
  label: "nove contas bancárias de aluguéis do DFC",
  fieldCandidates: ["Conta Banco"],
  values: [], // Supplied by the protected connection settings on the server.
  requireAllValues: true,
};

const rentalRevenueFilter: QlikCloudMetricFilter = {
  label: "plano de contas Aluguel de imóveis",
  fieldCandidates: ["Plano de Contas", "Plano Contas", "Descrição Plano de Contas", "Descricao Plano de Contas", "CAP", "Descrição CAP", "Descricao CAP", "Fluxo Financeiro"],
  contains: ["aluguel de imóveis", "aluguel de imoveis"],
};

const rentalExpenseFilter: QlikCloudMetricFilter = {
  label: "fluxo financeiro de aluguéis",
  fieldCandidates: ["Fluxo Financeiro", "Tipo Fluxo Financeiro", "Detalhamento Fluxo Financeiro", "Descrição Fluxo Financeiro", "Descricao Fluxo Financeiro", "Cód Tipo Fluxo Financeiro"],
  contains: ["aluguel", "aluguéis", "alugueis", "alguel"],
};

const balanceMetric = (
  metricKey: string,
  filters: ReadonlyArray<QlikCloudMetricFilter>,
): QlikCloudMetricDefinition => ({
  metricKey,
  sheetId: BALANCE_SHEET,
  targetLabel: "Saldo",
  aliases: ["Saldo bancário", "Saldo bancario", "Saldo atual", "Saldo da conta"],
  mode: "monthly",
  periodStrategy: "date-last-day",
  dateField: BALANCE_DATE_FIELDS[0],
  dateFieldCandidates: BALANCE_DATE_FIELDS.slice(1),
  filters,
});

const revenueMetric = (
  metricKey: string,
  filters: ReadonlyArray<QlikCloudMetricFilter>,
): QlikCloudMetricDefinition => ({
  metricKey,
  sheetId: REVENUE_SHEET,
  targetLabel: "Receita",
  aliases: ["Receitas", "Recebido", "Total recebido", "Valor recebido", "Receita total"],
  mode: "monthly",
  periodStrategy: "date-field",
  dateField: REVENUE_DATE_FIELDS[0],
  dateFieldCandidates: REVENUE_DATE_FIELDS.slice(1),
  filters,
});

const expenseMetric = (
  metricKey: string,
  filters: ReadonlyArray<QlikCloudMetricFilter>,
): QlikCloudMetricDefinition => ({
  metricKey,
  sheetId: EXPENSE_SHEET,
  targetLabel: "Pagamentos 💰",
  aliases: ["Pagamentos", "Despesa", "Despesas", "Gasto", "Total pago", "Valor pago", "Despesa total", "IN: Desembolso Financeiro"],
  mode: "monthly",
  periodStrategy: "date-field",
  dateField: EXPENSE_DATE_FIELDS[0],
  dateFieldCandidates: EXPENSE_DATE_FIELDS.slice(1),
  filters,
});

export const QLIK_FINANCE_APPS: ReadonlyArray<QlikCloudMetricApp> = [{
  entryUrl: `${QLIK_TENANT}/sense/app/${APP_ID}/sheet/${DFC_SHEET}/state/analysis`,
  isolatedSession: true,
  metrics: [{
    metricKey: "saldo_conta_alugueis",
    sheetId: DFC_SHEET,
    objectId: QLIK_RENTAL_BALANCE_OBJECT,
    targetLabel: "Composição Saldo Inicial | Contas",
    mode: "monthly",
    periodStrategy: "month-end-variables",
    periodVariables: ["vPosicaoInicialDFC", "vPosicaoFinalDFC"],
    stateName: "<estado alternativo 01>",
    aggregation: "sum-rows",
    filters: [{ label: "Caixa Econômica Federal", fieldCandidates: ["Cód Banco"], values: ["104"], requireAllValues: true }, rentalBankAccountFilter],
  }],
}, {
  entryUrl: `${QLIK_TENANT}/sense/app/${APP_ID}/sheet/${BALANCE_SHEET}/state/analysis/hubUrl/%2Fanalytics%2Fcatalog`,
  isolatedSession: true,
  metrics: [
    balanceMetric("valor_caixa", [terraLotusFilter]),
    revenueMetric("receita_alugueis_mes", [rentalGroupsFilter, rentalRevenueFilter]),
    revenueMetric("receita_consolidada", [terraLotusFilter]),
    expenseMetric("despesa_alugueis_mes", [rentalGroupsFilter, rentalExpenseFilter]),
    expenseMetric("despesa_consolidada", [terraLotusFilter]),
    {
      metricKey: "receita_plano_contas",
      sheetId: REVENUE_SHEET,
      targetLabel: "Receitas por plano de contas",
      aliases: ["Receita por plano de contas", "Plano de contas", "Fluxo Financeiro", "CAP"],
      mode: "breakdown",
      periodStrategy: "date-field",
      dateField: REVENUE_DATE_FIELDS[0],
      dateFieldCandidates: REVENUE_DATE_FIELDS.slice(1),
      filters: [terraLotusFilter],
    },
    {
      metricKey: "despesa_plano_contas",
      sheetId: EXPENSE_SHEET,
      objectId: "HgngyL",
      targetLabel: "Despesas por plano de contas",
      aliases: ["Despesa por plano de contas", "Plano de contas", "Fluxo Financeiro", "Pagamentos 💰", "CAP"],
      mode: "breakdown",
      periodStrategy: "date-field",
      dateField: EXPENSE_DATE_FIELDS[0],
      dateFieldCandidates: EXPENSE_DATE_FIELDS.slice(1),
      filters: [terraLotusFilter],
    },
  ],
}];

export function rentalBankAccountsFromSettings(settings: unknown): string[] {
  const accounts = settings && typeof settings === "object" && !Array.isArray(settings)
    ? (settings as Record<string, unknown>).rental_bank_accounts : null;
  if (!Array.isArray(accounts) || accounts.length !== RENTAL_ACCOUNT_COUNT
    || accounts.some((account) => typeof account !== "string" || !/^\d+-[\dA-Z]+$/.test(account))
    || new Set(accounts).size !== RENTAL_ACCOUNT_COUNT) {
    throw new Error("Qlik Financeiro: configure as nove contas de aluguéis em rental_bank_accounts na conexão protegida.");
  }
  return accounts;
}

export function financeAppsForSettings(settings: unknown): QlikCloudMetricApp[] {
  const accounts = rentalBankAccountsFromSettings(settings);
  return QLIK_FINANCE_APPS.map((app) => ({
    ...app,
    metrics: app.metrics.map((metric) => metric.metricKey !== "saldo_conta_alugueis" ? metric : {
      ...metric,
      filters: metric.filters?.map((filter) => filter === rentalBankAccountFilter ? { ...filter, values: accounts } : filter),
    }),
  }));
}

export const QLIK_FINANCE_BASE_METRIC_KEYS = QLIK_FINANCE_APPS.flatMap((app) => app.metrics.map((metric) => metric.metricKey));
export const QLIK_FINANCE_COMPANY_METRIC_KEYS = [
  "receita_consolidada",
  "despesa_consolidada",
  "resultado_gerencial",
  "valor_caixa",
  "caixa_disponivel",
  "receita_plano_contas",
  "despesa_plano_contas",
] as const;
export const QLIK_FINANCE_RENTAL_METRIC_KEYS = [
  "saldo_conta_alugueis",
  "receita_alugueis_mes",
  "despesa_alugueis_mes",
] as const;

type FinanceMetricOverrides = Record<string, Record<string, number>>;

export function applyFinanceMetricOverrides(
  snapshots: QlikMetricSnapshot[],
  overrides: unknown,
) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return snapshots;
  const metricOverrides = overrides as FinanceMetricOverrides;
  return snapshots.map((snapshot) => {
    // This balance is now reconciled against the DFC account composition;
    // legacy manual totals must not replace the verified source amount.
    if (snapshot.metricKey === "saldo_conta_alugueis") return snapshot;
    const overrideValue = metricOverrides[snapshot.metricKey]?.[snapshot.referenceMonth];
    if (typeof overrideValue !== "number" || !Number.isFinite(overrideValue)) return snapshot;
    return {
      ...snapshot,
      value: overrideValue,
      selections: {
        ...snapshot.selections,
        ajuste_validado: "valor financeiro validado manualmente",
        valor_qlik_original: String(snapshot.value),
        valor_validado: String(overrideValue),
      },
    };
  });
}

export function validateFinanceSnapshots(snapshots: QlikMetricSnapshot[], now = new Date(), rentalAccounts: readonly string[] = []) {
  const expenseKeys = new Set(["despesa_alugueis_mes", "despesa_consolidada", "despesa_plano_contas"]);
  const normalizedSnapshots = snapshots.map((snapshot) => (
    expenseKeys.has(snapshot.metricKey) ? { ...snapshot, value: Math.abs(snapshot.value) } : snapshot
  ));
  const expectedMonths = legalSalesReferenceMonths(now);
  const expectedBaseKeys = new Set(QLIK_FINANCE_BASE_METRIC_KEYS);
  const seen = new Set<string>();
  for (const snapshot of normalizedSnapshots) {
    if (!expectedBaseKeys.has(snapshot.metricKey)) throw new Error(`Qlik Financeiro: indicador inesperado “${snapshot.metricKey}”.`);
    if (!Number.isFinite(snapshot.value)) throw new Error(`Qlik Financeiro: “${snapshot.metricKey}” retornou ${snapshot.value}.`);
    if (snapshot.metricKey === "saldo_conta_alugueis") validateRentalBalanceSnapshot(snapshot, rentalAccounts);
    const identity = `${snapshot.metricKey}:${snapshot.referenceMonth}:${snapshot.dimensionKey || "total"}`;
    if (seen.has(identity)) throw new Error(`Qlik Financeiro: valor duplicado para ${identity}.`);
    seen.add(identity);
  }

  const monthlyKeys = QLIK_FINANCE_APPS.flatMap((app) => app.metrics)
    .filter((metric) => metric.mode === "monthly")
    .map((metric) => metric.metricKey);
  for (const metricKey of monthlyKeys) {
    for (const referenceMonth of expectedMonths) {
      if (!seen.has(`${metricKey}:${referenceMonth}:total`)) {
        throw new Error(`Qlik Financeiro: “${metricKey}” não retornou ${referenceMonth}. Nenhum dado foi gravado.`);
      }
    }
  }

  const { year, month } = saoPauloYearMonth(now);
  const closedMonth = month > 1 ? month - 1 : 12;
  const closedYear = month > 1 ? year : year - 1;
  const closedReference = `${closedYear}-${String(closedMonth).padStart(2, "0")}-01`;
  for (const metricKey of ["receita_plano_contas", "despesa_plano_contas"]) {
    if (!normalizedSnapshots.some((snapshot) => snapshot.metricKey === metricKey && snapshot.referenceMonth === closedReference && snapshot.dimensionKey)) {
      throw new Error(`Qlik Financeiro: “${metricKey}” não retornou a composição do mês fechado ${closedReference}.`);
    }
  }

  const enriched = normalizedSnapshots.slice();
  const currentReferenceMonth = expectedMonths.at(-1);
  const previousClosedReferenceMonth = expectedMonths.length > 1
    ? expectedMonths.at(-2)
    : currentReferenceMonth;
  for (const referenceMonth of expectedMonths) {
    const revenue = normalizedSnapshots.find((snapshot) => snapshot.metricKey === "receita_consolidada" && snapshot.referenceMonth === referenceMonth);
    const expense = normalizedSnapshots.find((snapshot) => snapshot.metricKey === "despesa_consolidada" && snapshot.referenceMonth === referenceMonth);
    if (revenue && expense) {
      enriched.push({
        ...revenue,
        metricKey: "resultado_gerencial",
        targetLabel: "Resultado gerencial calculado",
        value: revenue.value - expense.value,
        selections: { cálculo: "receita consolidada - despesa consolidada", competência: referenceMonth },
      });
    }

    const cash = normalizedSnapshots.find((snapshot) => snapshot.metricKey === "valor_caixa" && snapshot.referenceMonth === referenceMonth);
    const rentalReferenceMonth = referenceMonth === currentReferenceMonth
      ? previousClosedReferenceMonth
      : referenceMonth;
    const rentalCash = normalizedSnapshots.find((snapshot) => (
      snapshot.metricKey === "saldo_conta_alugueis" && snapshot.referenceMonth === rentalReferenceMonth
    ));
    if (cash && rentalCash) {
      enriched.push({
        ...cash,
        metricKey: "caixa_disponivel",
        targetLabel: "Caixa disponível calculado",
        value: cash.value - rentalCash.value,
        selections: {
          cálculo: "valor em caixa atual - saldo da conta de aluguéis do último mês fechado",
          competência: referenceMonth,
          valor_caixa: String(cash.value),
          saldo_conta_alugueis: String(rentalCash.value),
          saldo_conta_alugueis_competência: rentalCash.referenceMonth,
        },
      });
    }
  }
  return enriched.sort((a, b) => a.referenceMonth.localeCompare(b.referenceMonth) || a.metricKey.localeCompare(b.metricKey));
}

export function validateRentalBalanceSnapshot(snapshot: QlikMetricSnapshot, rentalAccounts: readonly string[]) {
  const fail = () => { throw new Error(`Qlik Financeiro: composição das contas de aluguéis inválida em ${snapshot.referenceMonth}. Nenhum dado foi gravado.`); };
  if (snapshot.objectId !== QLIK_RENTAL_BALANCE_OBJECT) fail();
  const selected = new Set((snapshot.selections["Conta Banco"] || "").split(" | "));
  if (rentalAccounts.length !== RENTAL_ACCOUNT_COUNT || new Set(rentalAccounts).size !== RENTAL_ACCOUNT_COUNT
    || selected.size !== RENTAL_ACCOUNT_COUNT || rentalAccounts.some((account) => !selected.has(account))) fail();
  let rows: Array<{ dimensions: string[]; value: number }>;
  try { rows = JSON.parse(snapshot.selections.account_balances || "null"); } catch { return fail(); }
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > RENTAL_ACCOUNT_COUNT) return fail();
  const seen = new Set<string>();
  let sum = 0;
  for (const row of rows) {
    if (!Array.isArray(row?.dimensions) || typeof row.value !== "number" || !Number.isFinite(row.value)) return fail();
    const account = row.dimensions[1]?.split(" - ")[0];
    if (!selected.has(account) || seen.has(account) || row.dimensions[0] !== "104 - BCO CX EC FEDERAL SA") return fail();
    seen.add(account);
    sum += row.value;
  }
  const roundedSum = Math.round(sum * 100) / 100;
  const total = Number(snapshot.selections.qlik_total);
  if (!snapshot.selections.qlik_total || !Number.isFinite(total) || Math.abs(roundedSum - total) > 0.011 || Math.abs(roundedSum - snapshot.value) > 0.001) fail();
}

export function toFinanceIndicatorRows(snapshots: QlikMetricSnapshot[], synchronizedAt: string) {
  const rentalKeys = new Set<string>(QLIK_FINANCE_RENTAL_METRIC_KEYS);
  return snapshots.map((snapshot) => ({
    area: rentalKeys.has(snapshot.metricKey) ? "financas-compras" : "empresa",
    metric_key: snapshot.metricKey,
    reference_month: snapshot.referenceMonth,
    dimension_key: snapshot.dimensionKey || "total",
    dimension_label: snapshot.dimensionLabel || null,
    value: snapshot.value,
    source: QLIK_FINANCE_SOURCE,
    notes: snapshot.metricKey === "saldo_conta_alugueis"
      ? "Soma das nove contas de aluguéis na composição do saldo inicial do DFC; período no fechamento do mês (ou hoje no mês em aberto), conferida com o total do Qlik."
      : snapshot.selections.ajuste_validado
      ? "Valor validado manualmente; o retorno original do Qlik permanece nos metadados."
      : snapshot.mode === "breakdown"
      ? "Composição do mês anterior fechado consultada no Qlik Cloud."
      : snapshot.metricKey === "resultado_gerencial"
        ? "Calculado por receita mensal menos despesa mensal."
        : snapshot.metricKey === "caixa_disponivel"
          ? "Calculado por valor em caixa atual menos saldo da conta de aluguéis do último mês fechado."
        : "Valor mensal consultado no Qlik Cloud.",
    metadata: {
      connection: QLIK_FINANCE_CONNECTION_SLUG,
      qlik_app_id: snapshot.appId,
      qlik_sheet_id: snapshot.sheetId,
      qlik_object_id: snapshot.objectId,
      qlik_object_title: snapshot.objectTitle,
      qlik_target_label: snapshot.targetLabel,
      selections: snapshot.selections,
      synchronized_at: synchronizedAt,
    },
  }));
}
