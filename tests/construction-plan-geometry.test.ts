import assert from "node:assert/strict";
import test from "node:test";
import {
  calibrationMetersPerCoordinate,
  planProgressMetrics,
  plannedMeasure,
  polygonArea,
  type PlanPath,
} from "../lib/construction-plan-geometry.ts";

test("calibra e mede um eixo linear em metros", () => {
  const metersPerCoordinate = calibrationMetersPerCoordinate([{ x: 0, y: 0 }, { x: 0.1, y: 0 }], 10);
  assert.equal(metersPerCoordinate, 100);
  assert.equal(plannedMeasure([[{ x: 0, y: 0 }, { x: 0.5, y: 0 }]], "linear", metersPerCoordinate), 50);
});

test("não conta duas vezes traçados executados sobrepostos", () => {
  const planned: PlanPath[] = [[{ x: 0, y: 0.1 }, { x: 1, y: 0.1 }]];
  const executed: PlanPath[] = [
    [{ x: 0, y: 0.1 }, { x: 0.5, y: 0.1 }],
    [{ x: 0.25, y: 0.1 }, { x: 0.5, y: 0.1 }],
  ];
  const metrics = planProgressMetrics({ plannedPaths: planned, executedPaths: executed, measurementType: "linear", metersPerCoordinate: 100 });
  assert.ok(metrics.progressPercent >= 49 && metrics.progressPercent <= 51);
  assert.ok(metrics.executedMeasure >= 49 && metrics.executedMeasure <= 51);
});

test("mede área executada dentro do polígono planejado", () => {
  const planned: PlanPath[] = [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]];
  const executed: PlanPath[] = [[{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }]];
  assert.equal(polygonArea(planned[0]), 1);
  const metrics = planProgressMetrics({ plannedPaths: planned, executedPaths: executed, measurementType: "area", metersPerCoordinate: 10 });
  assert.equal(metrics.plannedMeasure, 100);
  assert.ok(metrics.progressPercent >= 49 && metrics.progressPercent <= 51);
});
