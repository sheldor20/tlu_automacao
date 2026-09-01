export const MANAGEMENT_INDICATOR_AREAS = [
  "empresa",
  "juridico-vendas-cobranca",
  "rh-marketing-clientes",
  "financas-compras",
  "novos-negocios",
  "obras-engenharia",
] as const;

export type ManagementIndicatorArea = typeof MANAGEMENT_INDICATOR_AREAS[number];

export type IndicatorRefreshJob = {
  key: "qlik-finance" | "qlik-legal-sales" | "qlik-delinquency" | "nps" | "instagram-followers";
  label: string;
  path: string;
};

const financeJob: IndicatorRefreshJob = {
  key: "qlik-finance",
  label: "Qlik Financeiro",
  path: "/api/cron/qlik/finance",
};

const legalSalesJob: IndicatorRefreshJob = {
  key: "qlik-legal-sales",
  label: "Qlik Vendas e Pós-vendas",
  path: "/api/cron/qlik/legal-sales",
};

const delinquencyJob: IndicatorRefreshJob = {
  key: "qlik-delinquency",
  label: "Qlik Inadimplência",
  path: "/api/cron/qlik/delinquency",
};

const npsJob: IndicatorRefreshJob = {
  key: "nps",
  label: "NPS de clientes",
  path: "/api/cron/nps",
};

const instagramJob: IndicatorRefreshJob = {
  key: "instagram-followers",
  label: "Seguidores do Instagram",
  path: "/api/cron/instagram-followers",
};

export const INDICATOR_REFRESH_JOBS: Record<ManagementIndicatorArea, readonly IndicatorRefreshJob[]> = {
  empresa: [financeJob],
  "juridico-vendas-cobranca": [legalSalesJob, delinquencyJob],
  "rh-marketing-clientes": [npsJob, instagramJob],
  "financas-compras": [financeJob],
  "novos-negocios": [],
  "obras-engenharia": [],
};

export function isManagementIndicatorArea(value: unknown): value is ManagementIndicatorArea {
  return typeof value === "string"
    && (MANAGEMENT_INDICATOR_AREAS as readonly string[]).includes(value);
}

export function indicatorRefreshJobsForArea(area: unknown): readonly IndicatorRefreshJob[] | null {
  return isManagementIndicatorArea(area) ? INDICATOR_REFRESH_JOBS[area] : null;
}
