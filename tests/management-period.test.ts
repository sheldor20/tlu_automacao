import assert from "node:assert/strict";
import test from "node:test";
import { monthsThroughLastClosed, previousClosedMonth } from "../lib/management-period.ts";

test("oculta o mês atual e os meses futuros dos gráficos gerenciais", () => {
  const months = [
    { label: "jan", isCurrent: false },
    { label: "fev", isCurrent: false },
    { label: "mar", isCurrent: true },
    { label: "abr", isCurrent: false },
  ];

  assert.deepEqual(monthsThroughLastClosed(months).map((month) => month.label), ["jan", "fev"]);
});

test("mantém toda a série quando não há mês atual no recorte", () => {
  const months = [{ label: "jan", isCurrent: false }, { label: "fev", isCurrent: false }];
  assert.deepEqual(monthsThroughLastClosed(months), months);
});

test("seleciona somente o mês fechado imediatamente anterior", () => {
  const months = [
    { key: "2026-07-01", label: "jul", isCurrent: false },
    { key: "2026-08-01", label: "ago", isCurrent: false },
    { key: "2026-09-01", label: "set", isCurrent: true },
    { key: "2026-10-01", label: "out", isCurrent: false },
  ];

  assert.deepEqual(previousClosedMonth(months, 2026), months[1]);
});

test("usa dezembro do ano anterior quando o mês atual é janeiro", () => {
  const months = [
    { key: "2026-01-01", label: "jan", isCurrent: true },
    { key: "2026-02-01", label: "fev", isCurrent: false },
  ];

  assert.deepEqual(previousClosedMonth(months, 2026), {
    key: "2025-12-01",
    label: "dez",
    isCurrent: false,
  });
});
