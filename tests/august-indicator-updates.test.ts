import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("../components/management-dashboard.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260901183000_august_manual_indicator_updates.sql", import.meta.url), "utf8");

test("mantém os gráficos da Empresa até o último mês fechado", () => {
  assert.match(dashboard, /const closedMonths = monthsThroughLastClosed\(months\)/);
  assert.match(dashboard, /labels=\{chartMonths\.map\(\(month\) => month\.label\)\}/);
  assert.match(dashboard, /values: chartRevenue/);
  assert.match(dashboard, /values: chartCash/);
});

test("atualiza os seguidores de agosto para 3499", () => {
  assert.match(migration, /'instagram_seguidores'[\s\S]*date '2026-08-01'[\s\S]*3499/);
  assert.match(migration, /on conflict \(area, metric_key, reference_month, dimension_key\)/);
});

test("captura a disponibilidade de agosto no cadastro de aluguéis", () => {
  assert.match(migration, /'imoveis_disponiveis'[\s\S]*date '2026-08-01'[\s\S]*\n\s*7,/);
  assert.match(migration, /"derived_from":"rentals\.status=desocupado"/);
  assert.match(migration, /"captured_value":7/);
});
