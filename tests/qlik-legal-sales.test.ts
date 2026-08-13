import assert from "node:assert/strict";
import test from "node:test";
import {
  lastClosedSaoPauloYearMonth,
  legalSalesClosedReferenceMonths,
  QLIK_LEGAL_SALES_APPS,
  QLIK_LEGAL_SALES_METRIC_KEYS,
  QLIK_LEGAL_SALES_SCRAPE_BATCHES,
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
  "unidades_sem_processo",
  "unidades_autorizadas_escrituracao",
  "unidades_escrituracao_sem_registro",
  "unidades_registradas",
]);

function createSnapshots(): QlikMetricSnapshot[] {
  return QLIK_LEGAL_SALES_METRIC_KEYS.flatMap((metricKey, metricIndex) => {
    const months = monthly.has(metricKey) ? legalSalesClosedReferenceMonths(now) : ["2026-07-01"];
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

test("gera somente as competências até o último mês fechado em São Paulo", () => {
  assert.deepEqual(lastClosedSaoPauloYearMonth(now), { year: 2026, month: 7 });
  assert.deepEqual(legalSalesClosedReferenceMonths(now), [
    "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01",
    "2026-05-01", "2026-06-01", "2026-07-01",
  ]);
  assert.deepEqual(lastClosedSaoPauloYearMonth(new Date("2027-01-10T12:00:00-03:00")), { year: 2026, month: 12 });
});

test("usa os campos de data reais para vendas e distratos", () => {
  const metrics = QLIK_LEGAL_SALES_APPS.flatMap((app) => app.metrics);
  const vendas = metrics.find((metric) => metric.metricKey === "vendas_mes");
  const distratos = metrics.find((metric) => metric.metricKey === "distratos_mes");
  assert.deepEqual([vendas?.periodStrategy, vendas?.dateField], ["date-field", "Data Venda"]);
  assert.deepEqual([distratos?.periodStrategy, distratos?.dateField], ["date-field", "Data Distrato Venda"]);
});

test("divide a leitura em sessões curtas sem perder ou duplicar indicadores", () => {
  assert.ok(QLIK_LEGAL_SALES_SCRAPE_BATCHES.length > QLIK_LEGAL_SALES_APPS.length);
  assert.ok(QLIK_LEGAL_SALES_SCRAPE_BATCHES.every((app) => app.metrics.length >= 1 && app.metrics.length <= 2));
  assert.deepEqual(
    QLIK_LEGAL_SALES_SCRAPE_BATCHES.flatMap((app) => app.metrics.map((metric) => metric.metricKey)).sort(),
    [...QLIK_LEGAL_SALES_METRIC_KEYS].sort(),
  );
});

test("consulta as cinco posições de escritura no último dia útil disponível de cada mês", () => {
  const metrics = QLIK_LEGAL_SALES_APPS.flatMap((app) => app.metrics);
  const quitadas = metrics.find((metric) => metric.metricKey === "unidades_quitadas");
  const semProcesso = metrics.find((metric) => metric.metricKey === "unidades_sem_processo");
  const autorizadas = metrics.find((metric) => metric.metricKey === "unidades_autorizadas_escrituracao");
  const emEscrituracao = metrics.find((metric) => metric.metricKey === "unidades_escrituracao_sem_registro");
  const registradas = metrics.find((metric) => metric.metricKey === "unidades_registradas");
  for (const metric of [quitadas, semProcesso, autorizadas, emEscrituracao, registradas]) {
    assert.equal(metric?.periodStrategy, "date-through-business-day");
    assert.equal(metric?.dateField, "Data Posição");
    assert.equal(metric?.exactDateField, true);
  }
});

test("exige as oito séries mensais somente até o mês fechado", () => {
  const snapshots = createSnapshots();
  const validated = validateLegalSalesSnapshots(snapshots, now);
  assert.equal(validated.length, 56);
  assert.equal(validated.filter((snapshot) => snapshot.metricKey === "unidades_sem_processo").length, 7);
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

test("bloqueia a sincronização se as cinco posições do fechamento vierem zeradas", () => {
  const deedKeys = new Set([
    "unidades_quitadas",
    "unidades_sem_processo",
    "unidades_autorizadas_escrituracao",
    "unidades_escrituracao_sem_registro",
    "unidades_registradas",
  ]);
  const snapshots = createSnapshots().map((snapshot) => (
    snapshot.referenceMonth === "2026-07-01" && deedKeys.has(snapshot.metricKey)
      ? { ...snapshot, value: 0 }
      : snapshot
  ));
  assert.throws(() => validateLegalSalesSnapshots(snapshots, now), /cinco posições.*zeradas.*não substituir/i);
});

test("converte a leitura em linhas auditáveis do painel", () => {
  const row = toLegalSalesIndicatorRows(createSnapshots().slice(0, 1), "2026-08-13T15:00:00.000Z")[0];
  assert.equal(row.area, "juridico-vendas-cobranca");
  assert.equal(row.metric_key, "unidades_disponiveis");
  assert.equal(row.metadata.qlik_object_id, "object-unidades_disponiveis");
  assert.equal(row.metadata.synchronized_at, "2026-08-13T15:00:00.000Z");
});
