import assert from "node:assert/strict";
import test from "node:test";
import { monthsThroughLastClosed } from "../lib/management-period.ts";

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
