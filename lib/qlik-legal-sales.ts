import type { QlikCloudMetricApp, QlikMetricSnapshot } from "@/lib/qlik-cloud";

export const QLIK_LEGAL_SALES_CONNECTION_SLUG = "qlik-legal-sales";
export const QLIK_LEGAL_SALES_SOURCE = "Qlik Cloud - Vendas e Escrituração";
export const QLIK_LEGAL_SALES_AREA = "juridico-vendas-cobranca";

const QLIK_TENANT = "https://terralotusurbanismo.us.qlikcloud.com";

export const QLIK_LEGAL_SALES_APPS: ReadonlyArray<QlikCloudMetricApp> = [
  {
    entryUrl: `${QLIK_TENANT}/sense/app/91fec9e0-bcf1-4b6e-9675-fc02d9d3c804/sheet/8f9a709f-a02a-4f53-9bea-5e7d0236d7d3/state/analysis/hubUrl/%2Fanalytics%2Fcatalog`,
    metrics: [{
      metricKey: "unidades_disponiveis",
      sheetId: "8f9a709f-a02a-4f53-9bea-5e7d0236d7d3",
      targetLabel: "Estoque disponível",
      aliases: ["Estoque disponivel", "Unidades disponíveis", "Unidades disponiveis"],
      mode: "monthly",
      periodStrategy: "series",
    }],
  },
  {
    entryUrl: `${QLIK_TENANT}/sense/app/465cc478-f1b4-4969-b057-d80a623b6de8/sheet/3a8144df-05ae-4132-9e90-6e73fd51714d/state/analysis/hubUrl/%2Fanalytics%2Fcatalog%3Fspace_filter%3D60b79e806248930001408d20`,
    metrics: [
      {
        metricKey: "vendas_mes",
        sheetId: "3a8144df-05ae-4132-9e90-6e73fd51714d",
        targetLabel: "Vendas",
        aliases: ["Vendas no mês", "Vendas no mes"],
        mode: "monthly",
        periodStrategy: "date-field",
        dateField: "Data Venda",
      },
      {
        metricKey: "distratos_mes",
        sheetId: "3a8144df-05ae-4132-9e90-6e73fd51714d",
        targetLabel: "Distratos",
        aliases: ["Distratos no mês", "Distratos no mes"],
        mode: "monthly",
        periodStrategy: "date-field",
        dateField: "Data Distrato Venda",
      },
      {
        metricKey: "unidades_quitadas",
        sheetId: "cdc4d2c1-2344-49c8-a279-2b390061fa06",
        targetLabel: "Vendas quitadas",
        aliases: ["Unidades quitadas"],
        mode: "snapshot",
      },
      {
        metricKey: "unidades_sem_processo",
        sheetId: "b6e58857-ecec-46f7-bda7-e64bdc60a656",
        targetLabel: "Vendas sem proc escrituração",
        aliases: ["Vendas sem proc escrituracao", "Vendas sem processo de escrituração", "Sem processo"],
        mode: "snapshot",
      },
      {
        metricKey: "unidades_autorizadas_escrituracao",
        sheetId: "626f7856-4a17-40ee-bf06-2896e76c6083",
        targetLabel: "Vendas com aut de escritura",
        aliases: ["Vendas com autorização de escritura", "Autorizadas para escrituração"],
        mode: "snapshot",
      },
      {
        metricKey: "unidades_escrituracao_sem_registro",
        sheetId: "8b69801a-0e28-4d6f-86a9-a2b04bbd2485",
        targetLabel: "Escrituradas / não registradas",
        aliases: ["Escrituradas nao registradas", "Em escrituração sem registro"],
        mode: "snapshot",
      },
      {
        metricKey: "unidades_registradas",
        sheetId: "63544267-64b1-4568-8498-a8217f2c04a6",
        targetLabel: "Registradas",
        aliases: ["Vendas registradas", "Unidades registradas"],
        mode: "snapshot",
      },
    ],
  },
];

export const QLIK_LEGAL_SALES_METRIC_KEYS = QLIK_LEGAL_SALES_APPS
  .flatMap((app) => app.metrics.map((metric) => metric.metricKey));

export function saoPauloYearMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  if (!year || !month) throw new Error("Qlik: não foi possível determinar a competência atual.");
  return { year, month };
}

export function legalSalesReferenceMonths(now = new Date()) {
  const { year, month } = saoPauloYearMonth(now);
  return Array.from({ length: month }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}-01`);
}

function metricModes() {
  return new Map(QLIK_LEGAL_SALES_APPS.flatMap((app) => app.metrics.map((metric) => [metric.metricKey, metric.mode])));
}

export function validateLegalSalesSnapshots(snapshots: QlikMetricSnapshot[], now = new Date()) {
  const expectedMonths = legalSalesReferenceMonths(now);
  const currentMonth = expectedMonths.at(-1)!;
  const modes = metricModes();
  const expectedKeys = new Set(QLIK_LEGAL_SALES_METRIC_KEYS);
  const seen = new Set<string>();

  for (const snapshot of snapshots) {
    if (!expectedKeys.has(snapshot.metricKey)) {
      throw new Error(`Qlik: indicador inesperado na carga: “${snapshot.metricKey}”.`);
    }
    if (!Number.isFinite(snapshot.value) || snapshot.value < 0 || !Number.isInteger(snapshot.value)) {
      throw new Error(`Qlik: “${snapshot.metricKey}” deveria ser um número inteiro não negativo, mas retornou ${snapshot.value}.`);
    }
    const identity = `${snapshot.metricKey}:${snapshot.referenceMonth}`;
    if (seen.has(identity)) throw new Error(`Qlik: valor duplicado para ${identity}.`);
    seen.add(identity);
  }

  for (const metricKey of expectedKeys) {
    const mode = modes.get(metricKey);
    const requiredMonths = mode === "monthly" ? expectedMonths : [currentMonth];
    for (const referenceMonth of requiredMonths) {
      if (!seen.has(`${metricKey}:${referenceMonth}`)) {
        throw new Error(`Qlik: “${metricKey}” não retornou valor para ${referenceMonth}. Nenhum dado foi gravado.`);
      }
    }
  }

  return snapshots.slice().sort((a, b) => (
    a.referenceMonth.localeCompare(b.referenceMonth) || a.metricKey.localeCompare(b.metricKey)
  ));
}

export function toLegalSalesIndicatorRows(snapshots: QlikMetricSnapshot[], synchronizedAt: string) {
  return snapshots.map((snapshot) => ({
    area: QLIK_LEGAL_SALES_AREA,
    metric_key: snapshot.metricKey,
    reference_month: snapshot.referenceMonth,
    dimension_key: "total",
    dimension_label: null,
    value: snapshot.value,
    source: QLIK_LEGAL_SALES_SOURCE,
    notes: snapshot.mode === "monthly"
      ? "Valor mensal consultado no Qlik Cloud."
      : "Posição atual consultada no Qlik Cloud.",
    metadata: {
      connection: QLIK_LEGAL_SALES_CONNECTION_SLUG,
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
