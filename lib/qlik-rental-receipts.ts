import type { QlikCloudMetricApp, QlikMetricSnapshot } from "./qlik-cloud";

export const RENTAL_RECEIPTS_CONNECTION = "qlik-rental-receipts";
export const RENTAL_RECEIPTS_APP = "e3d13862-ec1f-4332-8a5b-df4c7b93fa7c";
export const RENTAL_RECEIPTS_SHEET = "bd84bea2-0f3c-4dc6-9081-0eab08502ba3";
export const RENTAL_RECEIPTS_CODE_FIELD = "Cód Unidade Negócio";
export const RENTAL_RECEIPTS_OBJECT = "b92ac856-4098-44d8-bc83-a21a48e68db5";
export type RentalQlikMonth = { source_code: string; reference_month: string; received_amount: number };

export function rentalReceiptApps(settings: Record<string, unknown>): QlikCloudMetricApp[] {
  if (settings.mapping_verified !== true) throw new Error("Valide os recebimentos por Cód Unidade Negócio antes de ativar a carga.");
  return [{ entryUrl: `https://terralotusurbanismo.us.qlikcloud.com/sense/app/${RENTAL_RECEIPTS_APP}/sheet/${RENTAL_RECEIPTS_SHEET}/state/analysis`, isolatedSession: true, metrics: [{
    metricKey: "rental_received", sheetId: RENTAL_RECEIPTS_SHEET, objectId: RENTAL_RECEIPTS_OBJECT,
    targetLabel: "Recebimentos por imóvel", mode: "snapshot", measureIndex: 0,
    variables: [{ name: "vQtdDias", value: 99999999, label: "Tudo" }, { name: "vDesembolsoFinanceiro", value: "Normal", label: "Com Desembolso" }],
    companyDateBreakdown: { companyField: RENTAL_RECEIPTS_CODE_FIELD, dateField: "Período" },
  }] }];
}

export function parseRentalReceiptSnapshots(snapshots: QlikMetricSnapshot[]) {
  let sourceTotal: number | null = null;
  const dailyKeys = new Set<string>();
  const monthlyCents = new Map<string, number>();
  const codes = new Set<string>();
  let observed = 0;
  for (const item of snapshots) {
    if (item.appId !== RENTAL_RECEIPTS_APP || item.sheetId !== RENTAL_RECEIPTS_SHEET || item.objectId !== RENTAL_RECEIPTS_OBJECT) throw new Error("Origem dos recebimentos diferente da planilha validada.");
    if (item.metricKey === "performance_company") { if (item.companyName?.trim()) codes.add(item.companyName.trim()); continue; }
    if (!Number.isFinite(item.value) || Math.abs(item.value) >= 1e12) throw new Error("Valor inválido nos recebimentos do Qlik.");
    if (item.metricKey === "rental_received:total") {
      if (sourceTotal !== null) throw new Error("Total de recebimentos duplicado.");
      sourceTotal = item.value; continue;
    }
    if (item.metricKey !== "rental_received") throw new Error("Medida de recebimentos não reconhecida.");
    const code = item.companyName?.trim(), date = item.cashDate;
    if (!code || code === "-" || code.length > 200) throw new Error("Recebimento sem código de unidade de negócio.");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(0, 4)) < 1900 || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("Recebimento sem data válida; a carga anterior foi preservada.");
    const dailyKey = JSON.stringify([code, date]);
    if (dailyKeys.has(dailyKey)) throw new Error("Recebimento duplicado na leitura do Qlik.");
    dailyKeys.add(dailyKey);
    const monthKey = JSON.stringify([code, `${date.slice(0, 7)}-01`]);
    monthlyCents.set(monthKey, (monthlyCents.get(monthKey) || 0) + Math.round(item.value * 100));
    observed += item.value;
  }
  if (sourceTotal === null || !dailyKeys.size || Math.abs(Math.round(sourceTotal * 100) - Math.round(observed * 100)) > 2) throw new Error("Carga vazia, incompleta ou total divergente dos recebimentos no Qlik.");
  const rows: RentalQlikMonth[] = [...monthlyCents].map(([key, cents]) => {
    const [source_code, reference_month] = JSON.parse(key) as [string, string];
    if (!codes.has(source_code)) throw new Error("Código do recebimento ausente do catálogo de unidades de negócio.");
    return { source_code, reference_month, received_amount: cents / 100 };
  });
  return { rows, sourceTotal, dailyRows: dailyKeys.size };
}
