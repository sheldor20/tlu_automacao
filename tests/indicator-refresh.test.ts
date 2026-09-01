import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  INDICATOR_REFRESH_JOBS,
  indicatorRefreshJobsForArea,
} from "../lib/indicator-refresh.ts";

const serverRoute = readFileSync(new URL("../app/api/indicators/refresh/route.ts", import.meta.url), "utf8");
const clientRefresh = readFileSync(new URL("../lib/indicator-refresh-client.ts", import.meta.url), "utf8");
const dashboardBridge = readFileSync(new URL("../components/management-dashboard-refresh.tsx", import.meta.url), "utf8");

test("mapeia cada painel somente para as fontes que alimentam seus indicadores", () => {
  assert.deepEqual(
    INDICATOR_REFRESH_JOBS.empresa.map((job) => job.path),
    ["/api/cron/qlik/finance"],
  );
  assert.deepEqual(
    INDICATOR_REFRESH_JOBS["financas-compras"].map((job) => job.path),
    ["/api/cron/qlik/finance"],
  );
  assert.deepEqual(
    INDICATOR_REFRESH_JOBS["juridico-vendas-cobranca"].map((job) => job.path),
    ["/api/cron/qlik/legal-sales", "/api/cron/qlik/delinquency"],
  );
  assert.deepEqual(
    INDICATOR_REFRESH_JOBS["rh-marketing-clientes"].map((job) => job.path),
    ["/api/cron/nps", "/api/cron/instagram-followers"],
  );
});

test("painéis operacionais sem cron apenas releem a base", () => {
  assert.deepEqual(INDICATOR_REFRESH_JOBS["novos-negocios"], []);
  assert.deepEqual(INDICATOR_REFRESH_JOBS["obras-engenharia"], []);
});

test("rejeita áreas desconhecidas", () => {
  assert.equal(indicatorRefreshJobsForArea("area-inexistente"), null);
  assert.equal(indicatorRefreshJobsForArea(null), null);
});

test("mantém o segredo das crons somente no servidor e autentica o acionamento manual", () => {
  assert.match(serverRoute, /process\.env\.CRON_SECRET/);
  assert.match(serverRoute, /sessionClient\.auth\.getUser\(token\)/);
  assert.match(serverRoute, /profile_indicator_areas/);
  assert.doesNotMatch(clientRefresh, /CRON_SECRET/);
  assert.match(clientRefresh, /Authorization: `Bearer \$\{token\}`/);
});

test("intercepta somente o botão de atualização do painel e depois relê o dashboard", () => {
  assert.match(dashboardBridge, /management-sync-actions button/);
  assert.match(dashboardBridge, /lucide-refresh-cw/);
  assert.match(dashboardBridge, /refreshManagementIndicators\(area\)/);
  assert.match(dashboardBridge, /refreshButton\.click\(\)/);
});
