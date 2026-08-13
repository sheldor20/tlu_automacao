import assert from "node:assert/strict";
import test from "node:test";
import {
  legalSalesReferenceMonths,
  QLIK_LEGAL_SALES_APPS,
  QLIK_LEGAL_SALES_METRIC_KEYS,
  toLegalSalesIndicatorRows,
  validateLegalSalesSnapshots,
} from "../lib/qlik-legal-sales.ts";
import type { QlikMetricSnapshot } from "../lib/qlik-cloud.ts";

const now = new Date("2026-08-13T12:00:00-03:00");
const monthly = new Set([
  "unidades_disponiveis",
  "vendas_mes",
  "distratos_mes",
  "unidades_quitadas",
  "unidades_autorizadas_escrituracao",
]);

function createSnapshots(): QlikMetricSnapshot[] {
  return QLIK_LEGAL_SALES_METRIC_KEYS.flatMap((metricKey, metricIndex) => {
    const months = monthly.has(metricKey) ? legalSalesReferenceMonths(now) : ["2026-08-01"];
    return months.map((referenceMonth, monthIndex) => ({
      metricKey,
      mode: monthly.has(metricKey) ? "monthly" : "snapshot",
      referenceMonth,
      value: metricIndex * 100 + monthIndex,
      appId: "app",
      sheetId: "sheet",
      objectId: `object-${metricKey}`,
      objectTitle: metricKey,
      targetLabel: metricKey,
      selections: monthly.has(metricKey)
        ? { Ano: "2026", Mês: String(monthIndex + 1) }
        : {} as Record<string, string>,
    }));
  });
}

test("gera as competências de janeiro ao mês vigente em São Paulo", () => {
  assert.deepEqual(legalSalesReferenceMonths(now), [
    "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01",
    "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01",
  ]);
});

test("usa os campos de data reais para vendas e distratos", () => {
  const metrics = QLIK_LEGAL_SALES_APPS.flatMap((app) => app.metrics);
  const vendas = metrics.find((metric) => metric.metricKey === "vendas_mes");
  const distratos = metrics.find((metric) => metric.metricKey === "distratos_mes");
  assert.deepEqual([vendas?.periodStrategy, vendas?.dateField], ["date-field", "Data Venda"]);
  assert.deepEqual([distratos?.periodStrategy, distratos?.dateField], ["date-field", "Data Distrato Venda"]);
});

test("monta o histórico acumulado de quitadas e autorizadas pelos campos de data", () => {
  const metrics = QLIK_LEGAL_SALES_APPS.flatMap((app) => app.metrics);
  const quitadas = metrics.find((metric) => metric.metricKey === "unidades_quitadas");
  const autorizadas = metrics.find((metric) => metric.metricKey === "unidades_autorizadas_escrituracao");
  assert.deepEqual([quitadas?.periodStrategy, quitadas?.dateField], ["date-through-month", "Último Recebimento"]);
  assert.deepEqual([autorizadas?.periodStrategy, autorizadas?.dateField], ["date-through-month", "Data Autorização Escritura"]);
});

test("exige as cinco séries mensais, mantém posições atuais e deriva sem processo no histórico", () => {
  const snapshots = createSnapshots();
  const validated = validateLegalSalesSnapshots(snapshots, now);
  assert.equal(validated.length, 50);
  assert.equal(validated.filter((snapshot) => snapshot.metricKey === "unidades_sem_processo").length, 8);
  assert.throws(
    () => validateLegalSalesSnapshots(snapshots.filter((snapshot) => !(
      snapshot.metricKey === "vendas_mes" && snapshot.referenceMonth === "2026-04-01"
    )), now),
    /vendas_mes.*2026-04-01.*nenhum dado foi gravado/i,
  );
});

test("recusa contagens negativas ou fracionárias", () => {
  const snapshots = createSnapshots();
  snapshots[0].value = 1.5;
  assert.throws(() => validateLegalSalesSnapshots(snapshots, now), /inteiro não negativo/i);
});

test("converte a leitura em linhas auditáveis do painel", () => {
  const row = toLegalSalesIndicatorRows(createSnapshots().slice(0, 1), "2026-08-13T15:00:00.000Z")[0];
  assert.equal(row.area, "juridico-vendas-cobranca");
  assert.equal(row.metric_key, "unidades_disponiveis");
  assert.equal(row.metadata.qlik_object_id, "object-unidades_disponiveis");
  assert.equal(row.metadata.synchronized_at, "2026-08-13T15:00:00.000Z");
});
