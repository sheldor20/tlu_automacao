export type PlanPoint = { x: number; y: number };
export type PlanPath = PlanPoint[];
export type PlanMeasurementType = "linear" | "area";

const EPSILON = 1e-9;

export function pointDistance(left: PlanPoint, right: PlanPoint) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

export function pathLength(path: PlanPath) {
  return path.slice(1).reduce((total, point, index) => total + pointDistance(path[index], point), 0);
}

export function polygonArea(path: PlanPath) {
  if (path.length < 3) return 0;
  return Math.abs(path.reduce((area, point, index) => {
    const next = path[(index + 1) % path.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2);
}

export function calibrationMetersPerCoordinate(points: PlanPoint[], distanceMeters: number) {
  if (points.length !== 2 || distanceMeters <= 0) return 0;
  const coordinateDistance = pointDistance(points[0], points[1]);
  return coordinateDistance > EPSILON ? distanceMeters / coordinateDistance : 0;
}

export function plannedMeasure(
  paths: PlanPath[],
  measurementType: PlanMeasurementType,
  metersPerCoordinate: number,
) {
  if (metersPerCoordinate <= 0) return 0;
  if (measurementType === "area") {
    return paths.reduce((total, path) => total + polygonArea(path), 0) * metersPerCoordinate ** 2;
  }
  return paths.reduce((total, path) => total + pathLength(path), 0) * metersPerCoordinate;
}

function pointToSegmentDistance(point: PlanPoint, start: PlanPoint, end: PlanPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const segmentLengthSquared = dx * dx + dy * dy;
  if (segmentLengthSquared <= EPSILON) return pointDistance(point, start);
  const rawProjection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / segmentLengthSquared;
  if (rawProjection < 0 || rawProjection > 1) return Number.POSITIVE_INFINITY;
  const projection = rawProjection;
  return pointDistance(point, { x: start.x + projection * dx, y: start.y + projection * dy });
}

function pointNearPaths(point: PlanPoint, paths: PlanPath[], tolerance: number) {
  return paths.some((path) => path.slice(1).some((end, index) => pointToSegmentDistance(point, path[index], end) <= tolerance));
}

function linearCoverageRatio(plannedPaths: PlanPath[], executedPaths: PlanPath[], metersPerCoordinate: number) {
  const totalLength = plannedPaths.reduce((total, path) => total + pathLength(path), 0);
  if (totalLength <= EPSILON || !executedPaths.length) return 0;
  const sampleStep = Math.max(1 / metersPerCoordinate, totalLength / 5000);
  const tolerance = Math.max(2.5 / metersPerCoordinate, sampleStep * 1.5);
  let coveredLength = 0;

  plannedPaths.forEach((path) => {
    path.slice(1).forEach((end, index) => {
      const start = path[index];
      const length = pointDistance(start, end);
      const sampleCount = Math.max(1, Math.ceil(length / sampleStep));
      const sliceLength = length / sampleCount;
      for (let sample = 0; sample < sampleCount; sample += 1) {
        const ratio = (sample + 0.5) / sampleCount;
        const point = { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
        if (pointNearPaths(point, executedPaths, tolerance)) coveredLength += sliceLength;
      }
    });
  });

  return Math.min(1, coveredLength / totalLength);
}

function pointInPolygon(point: PlanPoint, polygon: PlanPath) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a = polygon[current];
    const b = polygon[previous];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function areaCoverageRatio(plannedPaths: PlanPath[], executedPaths: PlanPath[]) {
  const validPlanned = plannedPaths.filter((path) => path.length >= 3);
  const validExecuted = executedPaths.filter((path) => path.length >= 3);
  if (!validPlanned.length || !validExecuted.length) return 0;
  const points = validPlanned.flat();
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  if (maxX - minX <= EPSILON || maxY - minY <= EPSILON) return 0;

  const longestSide = Math.max(maxX - minX, maxY - minY);
  const columns = Math.max(40, Math.round(220 * (maxX - minX) / longestSide));
  const rows = Math.max(40, Math.round(220 * (maxY - minY) / longestSide));
  let plannedCells = 0;
  let executedCells = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const point = {
        x: minX + (column + 0.5) / columns * (maxX - minX),
        y: minY + (row + 0.5) / rows * (maxY - minY),
      };
      if (!validPlanned.some((polygon) => pointInPolygon(point, polygon))) continue;
      plannedCells += 1;
      if (validExecuted.some((polygon) => pointInPolygon(point, polygon))) executedCells += 1;
    }
  }
  return plannedCells ? Math.min(1, executedCells / plannedCells) : 0;
}

export function planProgressMetrics({
  plannedPaths,
  executedPaths,
  measurementType,
  metersPerCoordinate,
}: {
  plannedPaths: PlanPath[];
  executedPaths: PlanPath[];
  measurementType: PlanMeasurementType;
  metersPerCoordinate: number;
}) {
  const planned = plannedMeasure(plannedPaths, measurementType, metersPerCoordinate);
  const coverage = measurementType === "area"
    ? areaCoverageRatio(plannedPaths, executedPaths)
    : linearCoverageRatio(plannedPaths, executedPaths, metersPerCoordinate);
  const executed = planned * coverage;
  return {
    plannedMeasure: Number(planned.toFixed(3)),
    executedMeasure: Number(executed.toFixed(3)),
    progressPercent: Number((coverage * 100).toFixed(2)),
  };
}

export function validPlanPaths(value: unknown): value is PlanPath[] {
  if (!Array.isArray(value) || value.length > 100) return false;
  return value.every((path) => Array.isArray(path) && path.length >= 2 && path.length <= 5000 && path.every((point) => (
    typeof point === "object" && point !== null
    && Number.isFinite((point as PlanPoint).x)
    && Number.isFinite((point as PlanPoint).y)
    && (point as PlanPoint).x >= 0 && (point as PlanPoint).x <= 1
    && (point as PlanPoint).y >= 0 && (point as PlanPoint).y <= 2
  )));
}
