import type { QlikCloudMetricApp, QlikCloudMetricDefinition, QlikMetricSnapshot } from "./qlik-cloud";
import { PERFORMANCE_FIELDS, roundMoney, validCashDate, type PerformanceField } from "./enterprise-performance.ts";

export const PERFORMANCE_CONNECTION = "qlik-enterprise-performance";
export const PERFORMANCE_APP = "e3d13862-ec1f-4332-8a5b-df4c7b93fa7c";
export const PERFORMANCE_SHEETS = {
  received: "bd84bea2-0f3c-4dc6-9081-0eab08502ba3",
  paid: "96551230-06b0-4e0f-9881-890030e2992a",
  payable: "96551230-06b0-4e0f-9881-890030e2992a",
  receivable: "32a488c2-14d8-4bde-ba4f-35211d75376b",
};

export function performanceMetricApps(settings: Record<string, unknown>): QlikCloudMetricApp[] {
  if (settings.mapping_verified !== true) throw new Error("A conexão de performance aguarda validação das medidas e datas nas planilhas do Qlik.");
  if (typeof settings.company_field !== "string" || !settings.company_field.trim()) throw new Error("Configure o campo Empresa do Qlik.");
  const sources = settings.sources as Record<string, { object_id?: unknown; date_field?: unknown; measure_index?: unknown }> | undefined;
  const metrics: QlikCloudMetricDefinition[] = PERFORMANCE_FIELDS.map((kind) => {
    const source = sources?.[kind];
    if (!source || typeof source.object_id !== "string" || !source.object_id.trim() || typeof source.date_field !== "string" || !source.date_field.trim()) {
      throw new Error(`Valide o objeto e o campo de data de ${kind} no Qlik antes de ativar a conexão.`);
    }
    const index = source.measure_index === undefined ? 0 : Number(source.measure_index);
    if (!Number.isInteger(index) || index < 0) throw new Error("Índice de medida inválido na configuração de performance.");
    return {
      metricKey: kind, sheetId: PERFORMANCE_SHEETS[kind], objectId: source.object_id,
      targetLabel: kind, mode: "snapshot", measureIndex: index,
      companyDateBreakdown: { companyField: settings.company_field as string, dateField: source.date_field },
    };
  });
  return [{ entryUrl: `https://terralotusurbanismo.us.qlikcloud.com/sense/app/${PERFORMANCE_APP}/sheet/${PERFORMANCE_SHEETS.received}/state/analysis`, isolatedSession: true, metrics }];
}

export type PerformanceSyncFlow = { company_key: string; cash_date: string | null; kind: PerformanceField; amount: number };

export function validatedPerformanceSnapshot(snapshots: QlikMetricSnapshot[]) {
  const companies = new Map<string, { company_key: string; name: string }>();
  const flows = new Map<string, PerformanceSyncFlow>();
  const totals = new Map<PerformanceField, number>();
  const sources: Record<string, { object_id: string; sheet_id: string; total: number }> = {};
  for (const item of snapshots) {
    if (item.metricKey === "performance_company") {
      const name = item.companyName?.trim();
      if (!name || name.length > 500) throw new Error("Empresa inválida na origem Qlik.");
      companies.set(name, { company_key: name, name });
      continue;
    }
    const totalKind = item.metricKey.endsWith(":total") ? item.metricKey.slice(0, -6) : null;
    const kind = (totalKind || item.metricKey) as PerformanceField;
    if (!PERFORMANCE_FIELDS.includes(kind)) throw new Error("Medida desconhecida na carga de performance.");
    if (!Number.isFinite(item.value) || Math.abs(item.value) > 1e15) throw new Error("Valor financeiro inválido na origem Qlik.");
    if (item.appId !== PERFORMANCE_APP || item.sheetId !== PERFORMANCE_SHEETS[kind]) throw new Error("Origem financeira diferente da planilha configurada.");
    if (totalKind) {
      if (totals.has(kind)) throw new Error("Total duplicado na carga de performance.");
      totals.set(kind, item.value);
      sources[kind] = { object_id: item.objectId, sheet_id: item.sheetId, total: roundMoney(item.value) };
      continue;
    }
    if (!item.companyName?.trim()) throw new Error("Existe valor financeiro sem empresa. A carga não será publicada.");
    if (item.cashDate !== null && !validCashDate(item.cashDate)) throw new Error("Data inválida na carga de performance.");
    const company = item.companyName.trim();
    const key = JSON.stringify([company, item.cashDate, kind]);
    const current = flows.get(key);
    if (current) throw new Error("Linha duplicada na leitura da origem Qlik.");
    flows.set(key, { company_key: company, cash_date: item.cashDate!, kind, amount: roundMoney(item.value) });
  }
  if (!companies.size) throw new Error("O Qlik não retornou empresas para o filtro.");
  for (const row of flows.values()) if (!companies.has(row.company_key)) throw new Error("Empresa financeira ausente do catálogo Qlik.");
  for (const kind of PERFORMANCE_FIELDS) {
    const expected = totals.get(kind);
    if (expected === undefined) throw new Error(`Leitura incompleta: falta o total de ${kind}.`);
    const observed = roundMoney([...flows.values()].filter((row) => row.kind === kind).reduce((sum, row) => sum + row.amount, 0));
    if (Math.abs(observed - roundMoney(expected)) > 0.02) throw new Error(`O total de ${kind} não confere com o Qlik. A última carga válida será preservada.`);
  }
  return { companies: [...companies.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")), flows: [...flows.values()], metadata: { sources, company_count: companies.size, date_basis: "source", reconciled: true } };
}
