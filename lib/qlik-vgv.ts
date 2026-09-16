import type { QlikCloudMetricApp, QlikMetricSnapshot } from "./qlik-cloud.ts";
import { projectVgv } from "./vgv-projection.ts";

export const QLIK_VGV_CONNECTION = "qlik-vgv";
export const QLIK_VGV_SOURCE = "Qlik Cloud — VGV projetado Terra Lotus";
const tenant = "https://terralotusurbanismo.us.qlikcloud.com";
const financeApp = "e3d13862-ec1f-4332-8a5b-df4c7b93fa7c";
export const QLIK_VGV_DFC_SHEET = "72ebe537-eacc-4f5e-95f7-6172c3788a51";
const financeSheet = QLIK_VGV_DFC_SHEET;
const delinquencyApp = "ce523abd-dce7-40f5-bd1c-93a23ffa4faa";
const delinquencySheet = "09d28f42-6159-480c-b251-43e1aa39265a";
export const QLIK_VGV_DFC_OBJECT = "e700f385-3486-49eb-ac6b-e9ab723b253e";
const receivablesObject = QLIK_VGV_DFC_OBJECT;
const groupFilter = [
  { label: "Grupo Empresa", fieldCandidates: ["Grupo Empresa"], values: ["Terra Lótus"], requireAllValues: true },
];

const QLIK_VGV_APPS: readonly QlikCloudMetricApp[] = [
  { entryUrl: `${tenant}/sense/app/${financeApp}/sheet/${financeSheet}/state/analysis`, isolatedSession: true, metrics: [
    { metricKey: "vgv_total_receber", sheetId: financeSheet, objectId: receivablesObject, targetLabel: "(+) Previsto Entrada", mode: "snapshot", aggregation: "grand-total", filters: groupFilter },
    { metricKey: "vgv_recebimentos_por_data", sheetId: financeSheet, objectId: receivablesObject, targetLabel: "(+) Previsto Entrada", mode: "snapshot", aggregation: "grand-total", filters: groupFilter, breakdownDateField: "Período" },
  ] },
  { entryUrl: `${tenant}/sense/app/${delinquencyApp}/sheet/${delinquencySheet}/state/analysis`, metrics: [
    // The second measure is the percentage shown below the monetary delinquency KPI.
    { metricKey: "vgv_inadimplencia_atual", sheetId: delinquencySheet, objectId: "sUJvzf", targetLabel: "Inadimplência", mode: "snapshot", measureIndex: 1 },
  ] },
];

export function vgvPeriod(referenceDate: string) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(referenceDate) || !Number.isFinite(Date.parse(referenceDate))
    || new Date(referenceDate).toISOString().slice(0, 10) !== referenceDate) throw new Error("Qlik: data de referência inválida.");
  return { start: referenceDate.slice(0, 7) + "-01", end: "2200-12-31" };
}

export function vgvAppsForDate(referenceDate: string): QlikCloudMetricApp[] {
  const period = vgvPeriod(referenceDate);
  const serial = (date: string) => (Date.parse(date + "T00:00:00Z") - Date.UTC(1899, 11, 30)) / 86_400_000;
  return QLIK_VGV_APPS.map((app, index) => index !== 0 ? app : {
    ...app, metrics: app.metrics.map((metric) => ({ ...metric, variables: [
      { name: "vPosicaoInicialDFC", value: serial(period.start), text: period.start.split("-").reverse().join("/"), label: period.start },
      { name: "vPosicaoFinalDFC", value: serial(period.end), text: period.end.split("-").reverse().join("/"), label: period.end },
      { name: "vApresentaPrevisoes", value: "Sim" },
      { name: "vFiltroInterCompany", value: "*" },
    ] })),
  });
}

export function qlikPercentage(snapshot: Pick<QlikMetricSnapshot, "value" | "valueText">) {
  if (!snapshot.valueText?.includes("%")) throw new Error("Qlik: a medida de inadimplência não está formatada como percentual.");
  const displayed = Number(snapshot.valueText.replace(/\s|%/g, "").replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(displayed)) throw new Error("Qlik: percentual de inadimplência inválido.");
  const tolerance = 0.0051;
  // Qlik usually stores a fraction; verify the display before applying its scale.
  if (Math.abs(snapshot.value * 100 - displayed) <= tolerance) return snapshot.value * 100;
  if (Math.abs(snapshot.value - displayed) <= tolerance) return snapshot.value;
  throw new Error("Qlik: o valor numérico e a apresentação do percentual não conferem.");
}

export function vgvIndicatorRows(snapshots: QlikMetricSnapshot[], synchronizedAt: string, referenceDate: string) {
  const period = vgvPeriod(referenceDate);
  const total = snapshots.filter((row) => row.metricKey === "vgv_total_receber");
  const rate = snapshots.filter((row) => row.metricKey === "vgv_inadimplencia_atual");
  const dates = snapshots.filter((row) => row.metricKey === "vgv_recebimentos_por_data");
  if (total.length !== 1 || rate.length !== 1 || !dates.length) throw new Error("Qlik: a carga de VGV está incompleta.");
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  for (const row of [...total, ...dates]) {
    if (!Object.entries(row.selections).some(([field, value]) => normalize(field) === "grupo empresa" && normalize(value) === "terra lotus")) {
      throw new Error("Qlik: o filtro Grupo Empresa = Terra Lótus não foi confirmado.");
    }
    if (row.sheetId !== QLIK_VGV_DFC_SHEET || row.objectId !== QLIK_VGV_DFC_OBJECT
      || row.selections.vPosicaoInicialDFC !== period.start || row.selections.vPosicaoFinalDFC !== period.end
      || row.selections.vApresentaPrevisoes !== "Sim" || row.selections.vFiltroInterCompany !== "*") {
      throw new Error("Qlik: a origem ou o período do Previsto de Entrada não foi confirmado.");
    }
  }
  const firstYear = Number(referenceDate.slice(0, 4));
  const receipts = new Map<number, number>([[firstYear, 0]]);
  for (const row of dates) {
    if (!row.dimensionKey || !/^\d{4}-\d{2}-\d{2}$/.test(row.dimensionKey) || !Number.isFinite(row.value) || row.value < 0) {
      throw new Error("Qlik: período ou entrada prevista inválida.");
    }
    if (row.dimensionKey < period.start || row.dimensionKey > period.end) {
      throw new Error("Qlik: entrada prevista fora do período solicitado.");
    }
    const year = Number(row.dimensionKey.slice(0, 4));
    receipts.set(year, (receipts.get(year) || 0) + row.value);
  }
  const projection = projectVgv(total[0].value, qlikPercentage(rate[0]), [...receipts].map(([year, value]) => ({ year, value })), firstYear);
  const metadata = {
    synchronized_at: synchronizedAt, reference_date: referenceDate, group: "Terra Lótus",
    overdue: projection.overdue, date_field: "Período", period_start: period.start, period_end: period.end,
    finance_view: "Detalhamento Fluxo de Caixa Realizado + Projetado (DFC)",
    finance_measure: "(+) Previsto Entrada", financial_group: "Todos os agrupadores e fluxos financeiros",
    delinquency_scope: "Visão geral de Multi Análises | Inadimplência, sem seleções adicionais",
    sources: [total[0], rate[0]].map((row) => ({ app_id: row.appId, sheet_id: row.sheetId, object_id: row.objectId, selections: row.selections })),
  };
  const base = { area: "novos-negocios", reference_month: `${referenceDate.slice(0, 7)}-01`, source: QLIK_VGV_SOURCE, notes: "Entradas previstas no DFC desde o início do mês até 31/12/2200; saldo anual conciliado com o total da coluna azul.", metadata };
  const rows = [
    { ...base, metric_key: "vgv_total_receber", dimension_key: "total", value: projection.total },
    { ...base, metric_key: "vgv_inadimplencia_atual", dimension_key: "total", value: projection.delinquencyPercent },
    { ...base, metric_key: "vgv_projetado_liquido", dimension_key: "total", value: projection.adjustedTotal },
    ...projection.points.map((point) => ({ ...base, metric_key: "vgv_saldo_anual", dimension_key: String(point.year), dimension_label: String(point.year), value: point.closingBalance,
      metadata: { ...metadata, receipts: point.receipts, opening_balance: point.openingBalance, adjusted_balance: point.adjustedClosingBalance },
    })),
  ];
  return { rows, projection };
}
