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
  label: "conta bancária de aluguéis",
  fieldCandidates: [
    "Descrição Conta Banco", "Descricao Conta Banco", "Nome Conta Banco", "Conta Banco Descrição", "Conta Banco Descricao",
    "Descrição Conta Bancária", "Descricao Conta Bancaria", "Nome da Conta", "Conta Bancária", "Conta Bancaria", "Conta",
  ],
  contains: ["aluguel", "aluguéis", "alugueis", "alguel"],
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
  entryUrl: `${QLIK_TENANT}/sense/app/${APP_ID}/sheet/${BALANCE_SHEET}/state/analysis/hubUrl/%2Fanalytics%2Fcatalog`,
  metrics: [
    balanceMetric("saldo_conta_alugueis", [rentalGroupsFilter, rentalBankAccountFilter]),
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

export const QLIK_FINANCE_BASE_METRIC_KEYS = QLIK_FINANCE_APPS.flatMap((app) => app.metrics.map((metric) => metric.metricKey));
export const QLIK_FINANCE_COMPANY_METRIC_KEYS = [
  "receita_consolidada",
  "despesa_consolidada",
  "resultado_gerencial",
  "valor_caixa",
  "receita_plano_contas",
  "despesa_plano_contas",
] as const;
export const QLIK_FINANCE_RENTAL_METRIC_KEYS = [
  "saldo_conta_alugueis",
  "receita_alugueis_mes",
  "despesa_alugueis_mes",
] as const;

export function validateFinanceSnapshots(snapshots: QlikMetricSnapshot[], now = new Date()) {
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
  for (const referenceMonth of expectedMonths) {
    const revenue = normalizedSnapshots.find((snapshot) => snapshot.metricKey === "receita_consolidada" && snapshot.referenceMonth === referenceMonth);
    const expense = normalizedSnapshots.find((snapshot) => snapshot.metricKey === "despesa_consolidada" && snapshot.referenceMonth === referenceMonth);
    if (!revenue || !expense) continue;
    enriched.push({
      ...revenue,
      metricKey: "resultado_gerencial",
      targetLabel: "Resultado gerencial calculado",
      value: revenue.value - expense.value,
      selections: { cálculo: "receita consolidada - despesa consolidada", competência: referenceMonth },
    });
  }
  return enriched.sort((a, b) => a.referenceMonth.localeCompare(b.referenceMonth) || a.metricKey.localeCompare(b.metricKey));
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
    notes: snapshot.mode === "breakdown"
      ? "Composição do mês anterior fechado consultada no Qlik Cloud."
      : snapshot.metricKey === "resultado_gerencial"
        ? "Calculado por receita mensal menos despesa mensal."
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
