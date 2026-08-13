import assert from "node:assert/strict";
import test from "node:test";
import { sumMetricSeries } from "../lib/management-metrics.ts";

test("soma somente competências disponíveis e preserva ausência total", () => {
  assert.equal(sumMetricSeries([64288.22, 0, 156840, 76400.64, 258249.39, 7246, 0]), 563024.25);
  assert.equal(sumMetricSeries([null, null]), null);
});
