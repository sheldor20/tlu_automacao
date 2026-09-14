import type { QlikCloudMetricApp, QlikMetricSnapshot } from "./qlik-cloud.ts";
import { projectVgv } from "./vgv-projection.ts";

export const QLIK_VGV_CONNECTION = "qlik-vgv";
export const QLIK_VGV_SOURCE = "Qlik Cloud — VGV projetado Terra Lotus";
const tenant = "https://terralotusurbanismo.us.qlikcloud.com";
const financeApp = "e3d13862-ec1f-4332-8a5b-df4c7b93fa7c";
const financeSheet = "32a488c2-14d8-4bde-ba4f-35211d75376b";
const delinquencyApp = "ce523abd-dce7-40f5-bd1c-93a23ffa4faa";
const delinquencySheet = "09d28f42-6159-480c-b251-43e1aa39265a";
const receivablesObject = "f8bff9fa-91db-4f60-8c0b-2e91cfdc1134";
const groupFilter = [{ label: "Grupo Empresa", fieldCandidates: ["Grupo Empresa"], values: ["Terra Lótus"] }];

export const QLIK_VGV_APPS: readonly QlikCloudMetricApp[] = [
  { entryUrl: `${tenant}/sense/app/${financeApp}/sheet/${financeSheet}/state/analysis`, metrics: [
    { metricKey: "vgv_total_receber", sheetId: financeSheet, objectId: receivablesObject, targetLabel: "Contas A Receber", mode: "snapshot", requireScalar: true, filters: groupFilter },
    { metricKey: "vgv_recebimentos_por_data", sheetId: financeSheet, objectId: receivablesObject, targetLabel: "Contas A Receber", mode: "snapshot", requireScalar: true, filters: groupFilter, breakdownDateField: "Data Vencimento" },
  ] },
  { entryUrl: `${tenant}/sense/app/${delinquencyApp}/sheet/${delinquencySheet}/state/analysis`, metrics: [
    // The second measure is the percentage shown below the monetary delinquency KPI.
    { metricKey: "vgv_inadimplencia_atual", sheetId: delinquencySheet, objectId: "sUJvzf", targetLabel: "Inadimplência", mode: "snapshot", measureIndex: 1 },
  ] },
];

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
  const total = snapshots.filter((row) => row.metricKey === "vgv_total_receber");
  const rate = snapshots.filter((row) => row.metricKey === "vgv_inadimplencia_atual");
  const dates = snapshots.filter((row) => row.metricKey === "vgv_recebimentos_por_data");
  if (total.length !== 1 || rate.length !== 1 || !dates.length) throw new Error("Qlik: a carga de VGV está incompleta.");
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  for (const row of [...total, ...dates]) {
    if (!Object.entries(row.selections).some(([field, value]) => normalize(field) === "grupo empresa" && normalize(value) === "terra lotus")) {
      throw new Error("Qlik: o filtro Grupo Empresa = Terra Lótus não foi confirmado.");
    }
  }
  const firstYear = Number(referenceDate.slice(0, 4));
  const receipts = new Map<number, number>([[firstYear, 0]]);
  let overdue = 0;
  for (const row of dates) {
    if (!row.dimensionKey || !/^\d{4}-\d{2}-\d{2}$/.test(row.dimensionKey) || !Number.isFinite(row.value) || row.value < 0) {
      throw new Error("Qlik: vencimento ou recebimento inválido.");
    }
    if (row.dimensionKey < referenceDate) overdue += row.value;
    else {
      const year = Number(row.dimensionKey.slice(0, 4));
      receipts.set(year, (receipts.get(year) || 0) + row.value);
    }
  }
  const projection = projectVgv(total[0].value, qlikPercentage(rate[0]), [...receipts].map(([year, value]) => ({ year, value })), firstYear, overdue);
  const metadata = {
    synchronized_at: synchronizedAt, reference_date: referenceDate, group: "Terra Lótus",
    overdue: projection.overdue, date_field: "Data Vencimento",
    delinquency_scope: "Visão geral de Multi Análises | Inadimplência, sem seleções adicionais",
    sources: [total[0], rate[0]].map((row) => ({ app_id: row.appId, sheet_id: row.sheetId, object_id: row.objectId, selections: row.selections })),
  };
  const base = { area: "novos-negocios", reference_month: `${referenceDate.slice(0, 7)}-01`, source: QLIK_VGV_SOURCE, notes: "Carteira atual; saldo vencido preservado sem data presumida de recuperação.", metadata };
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
