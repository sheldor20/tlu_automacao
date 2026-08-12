"use client";

import { useId } from "react";

type ChartValue = number | null;

export type ChartSeries = {
  label: string;
  color: string;
  values: ChartValue[];
};

function compactNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function dataLabel(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    notation: Math.abs(value) >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function latestDataIndex(series: ChartSeries[]) {
  return series.reduce<number>((latest, item) => item.values.reduce<number>(
    (seriesLatest, value, index) => value === null ? seriesLatest : Math.max(seriesLatest, index),
    latest,
  ), -1);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function chartBounds(series: ChartSeries[]) {
  const values = series.flatMap((item) => item.values).filter((value): value is number => value !== null);
  if (!values.length) return { min: 0, max: 1, hasData: false };
  const minValue = Math.min(...values, 0);
  const maxValue = Math.max(...values, 0);
  if (minValue === maxValue) return { min: 0, max: Math.max(1, maxValue), hasData: true };
  return { min: minValue, max: maxValue, hasData: true };
}

export function TrendChart({
  labels,
  series,
  emptyLabel = "Aguardando dados mensais",
  fixedRange,
}: {
  labels: string[];
  series: ChartSeries[];
  emptyLabel?: string;
  fixedRange?: { min: number; max: number };
}) {
  const gradientId = useId().replace(/:/g, "");
  const width = 820;
  const height = 280;
  const padding = { left: 54, right: 24, top: 44, bottom: 42 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const calculatedBounds = chartBounds(series);
  const bounds = fixedRange
    ? { min: fixedRange.min, max: fixedRange.max, hasData: calculatedBounds.hasData }
    : calculatedBounds;
  const range = bounds.max - bounds.min || 1;
  const x = (index: number) => padding.left + (labels.length <= 1 ? chartWidth / 2 : index * chartWidth / (labels.length - 1));
  const y = (value: number) => padding.top + (bounds.max - value) * chartHeight / range;
  const ticks = Array.from({ length: 5 }, (_, index) => bounds.min + range * index / 4).reverse();
  const latestIndex = latestDataIndex(series);
  const monthSpacing = labels.length > 1 ? chartWidth / (labels.length - 1) : chartWidth;

  return (
    <div className="management-chart-wrap">
      <svg className="management-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={series.map((item) => item.label).join(" e ")}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={series[0]?.color || "#405343"} stopOpacity=".22" />
            <stop offset="1" stopColor={series[0]?.color || "#405343"} stopOpacity="0" />
          </linearGradient>
        </defs>
        {latestIndex >= 0 ? (
          <rect
            x={clamp(x(latestIndex) - monthSpacing * .42, padding.left, width - padding.right - monthSpacing * .84)}
            y={padding.top - 26}
            width={monthSpacing * .84}
            height={chartHeight + 31}
            rx="9"
            className="chart-current-band"
          />
        ) : null}
        {ticks.map((tick, index) => {
          const tickY = padding.top + index * chartHeight / 4;
          return (
            <g key={`${tick}-${index}`}>
              <line x1={padding.left} x2={width - padding.right} y1={tickY} y2={tickY} className="chart-grid-line" />
              <text x={padding.left - 10} y={tickY + 4} textAnchor="end" className="chart-axis-value">{compactNumber(tick)}</text>
            </g>
          );
        })}
        {labels.map((label, index) => (
          <text key={`${label}-${index}`} x={x(index)} y={height - 14} textAnchor="middle" className={`chart-axis-label${index === latestIndex ? " chart-axis-label-current" : ""}`}>{label}</text>
        ))}
        {bounds.hasData && series[0] ? (() => {
          const areaPoints = series[0].values
            .map((value, index) => value === null ? null : { value, index })
            .filter((point): point is { value: number; index: number } => Boolean(point));
          if (areaPoints.length < 2) return null;
          const areaPath = areaPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.index)} ${y(point.value)}`).join(" ");
          return <path d={`${areaPath} L ${x(areaPoints.at(-1)!.index)} ${height - padding.bottom} L ${x(areaPoints[0].index)} ${height - padding.bottom} Z`} fill={`url(#${gradientId})`} />;
        })() : null}
        {series.map((item, seriesIndex) => {
          const validPoints = item.values.map((value, index) => value === null ? null : { value, index }).filter((point): point is { value: number; index: number } => Boolean(point));
          const path = validPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.index)} ${y(point.value)}`).join(" ");
          const currentPoint = validPoints.at(-1);
          return (
            <g key={item.label}>
              {path ? <path d={path} fill="none" stroke={item.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /> : null}
              {validPoints.map((point) => {
                const isCurrent = currentPoint?.index === point.index;
                const label = `${isCurrent ? "Atual " : ""}${dataLabel(point.value)}`;
                const labelWidth = Math.max(24, label.length * 6.2 + 12);
                const labelX = isCurrent
                  ? clamp(x(point.index), padding.left + labelWidth / 2, width - padding.right - labelWidth / 2)
                  : x(point.index);
                const preferredLabelY = y(point.value) + (seriesIndex % 2 === 0 ? -12 : 19);
                const labelY = clamp(preferredLabelY, padding.top - 14, padding.top + chartHeight + 20);
                return (
                  <g key={`${item.label}-${point.index}`}>
                    {isCurrent ? <rect x={labelX - labelWidth / 2} y={labelY - 12} width={labelWidth} height="18" rx="9" className="chart-current-value-bg" /> : null}
                    <text x={labelX} y={labelY + 1} textAnchor="middle" className={isCurrent ? "chart-data-label chart-data-label-current" : "chart-data-label"}>{label}</text>
                    <circle cx={x(point.index)} cy={y(point.value)} r={isCurrent ? 6 : 4} fill={isCurrent ? item.color : "white"} stroke={item.color} strokeWidth="3">
                      <title>{`${item.label}: ${point.value.toLocaleString("pt-BR")}`}</title>
                    </circle>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      {!bounds.hasData ? <div className="chart-empty-state"><span />{emptyLabel}</div> : null}
      <div className="chart-legend">
        {series.map((item) => <span key={item.label}><i style={{ background: item.color }} />{item.label}</span>)}
      </div>
    </div>
  );
}

export function GroupedBarChart({
  labels,
  series,
  emptyLabel = "Aguardando dados mensais",
}: {
  labels: string[];
  series: ChartSeries[];
  emptyLabel?: string;
}) {
  const width = 820;
  const height = 280;
  const padding = { left: 54, right: 24, top: 44, bottom: 42 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const bounds = chartBounds(series);
  const max = Math.max(bounds.max, 1);
  const groupWidth = chartWidth / Math.max(labels.length, 1);
  const usableWidth = Math.min(groupWidth * .72, 64);
  const barWidth = usableWidth / Math.max(series.length, 1);
  const latestIndex = latestDataIndex(series);

  return (
    <div className="management-chart-wrap">
      <svg className="management-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={series.map((item) => item.label).join(" e ")}>
        {latestIndex >= 0 ? <rect x={padding.left + groupWidth * latestIndex + groupWidth * .08} y={padding.top - 26} width={groupWidth * .84} height={chartHeight + 31} rx="9" className="chart-current-band" /> : null}
        {Array.from({ length: 5 }, (_, index) => {
          const value = max * (4 - index) / 4;
          const lineY = padding.top + index * chartHeight / 4;
          return <g key={index}><line x1={padding.left} x2={width - padding.right} y1={lineY} y2={lineY} className="chart-grid-line" /><text x={padding.left - 10} y={lineY + 4} textAnchor="end" className="chart-axis-value">{compactNumber(value)}</text></g>;
        })}
        {labels.map((label, labelIndex) => {
          const center = padding.left + groupWidth * labelIndex + groupWidth / 2;
          return (
            <g key={`${label}-${labelIndex}`}>
              {series.map((item, seriesIndex) => {
                const value = item.values[labelIndex];
                if (value === null) return null;
                const barHeight = Math.max(2, Math.max(0, value) / max * chartHeight);
                const barX = center - usableWidth / 2 + seriesIndex * barWidth;
                const barY = padding.top + chartHeight - barHeight;
                return (
                  <g key={item.label}>
                    <rect x={barX} y={barY} width={Math.max(barWidth - 3, 2)} height={barHeight} rx="4" fill={item.color} opacity={labelIndex === latestIndex ? 1 : .82}><title>{`${item.label}: ${value.toLocaleString("pt-BR")}`}</title></rect>
                    <text x={barX + Math.max(barWidth - 3, 2) / 2} y={clamp(barY - 6 - seriesIndex * 10, padding.top - 10, padding.top + chartHeight - 6)} textAnchor="middle" className={`chart-data-label${labelIndex === latestIndex ? " chart-data-label-current-bar" : ""}`}>{dataLabel(value)}</text>
                  </g>
                );
              })}
              <text x={center} y={height - 14} textAnchor="middle" className={`chart-axis-label${labelIndex === latestIndex ? " chart-axis-label-current" : ""}`}>{label}</text>
            </g>
          );
        })}
      </svg>
      {!bounds.hasData ? <div className="chart-empty-state"><span />{emptyLabel}</div> : null}
      <div className="chart-legend">
        {series.map((item) => <span key={item.label}><i style={{ background: item.color }} />{item.label}</span>)}
      </div>
    </div>
  );
}
