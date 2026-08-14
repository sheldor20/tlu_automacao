"use client";

import { buildConstructionGantt } from "@/lib/construction-gantt";
import { dateBr } from "@/lib/format";
import type { Construction, MacroStage } from "@/lib/types";
import { CalendarRange } from "lucide-react";

export function ConstructionGantt({ construction, macros }: { construction: Construction; macros: MacroStage[] }) {
  const gantt = buildConstructionGantt(construction, macros);
  const chartWidth = Math.max(760, gantt.months.length * 118);
  const monthGrid = { gridTemplateColumns: `repeat(${gantt.months.length}, minmax(118px, 1fr))` };

  return (
    <section className="content-card construction-gantt-card detail-tab-panel">
      <div className="content-card-head">
        <div><h2>Cronograma da obra</h2><p>Visão Gantt das etapas e microetapas; datas são opcionais e podem ser preenchidas gradualmente.</p></div>
        <span className="gantt-period"><CalendarRange size={16} /> {dateBr(gantt.start_date)} a {dateBr(gantt.end_date)}</span>
      </div>
      {gantt.rows.length ? (
        <div className="construction-gantt-scroll">
          <div className="construction-gantt" style={{ minWidth: `${chartWidth + 300}px` }}>
            <div className="gantt-header-label">Etapa / microetapa</div>
            <div className="gantt-months" style={monthGrid}>
              {gantt.months.map((month) => <span key={month.key}>{month.label}</span>)}
            </div>
            {gantt.rows.map((row) => (
              <div className={`gantt-row gantt-row-${row.kind}`} key={row.id}>
                <div className="gantt-row-label">
                  <strong>{row.label}</strong>
                  <span>{row.start_date ? `${dateBr(row.start_date)} — ${dateBr(row.end_date)}` : "Datas não informadas"}{row.derived ? " · período derivado" : ""}</span>
                </div>
                <div className="gantt-track">
                  <div className="gantt-grid-lines" style={monthGrid}>{gantt.months.map((month) => <span key={month.key} />)}</div>
                  {row.left_percent != null && row.width_percent != null ? (
                    <div
                      className="gantt-bar"
                      style={{ left: `${row.left_percent}%`, width: `${row.width_percent}%` }}
                      title={`${row.label}: ${dateBr(row.start_date)} a ${dateBr(row.end_date)} · ${row.progress_percent.toFixed(0)}%`}
                    >
                      <span style={{ width: `${Math.max(0, Math.min(100, row.progress_percent))}%` }} />
                      <strong>{row.progress_percent.toFixed(0)}%</strong>
                    </div>
                  ) : <span className="gantt-undated">Preencha o período na edição</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : <div className="mini-empty">Cadastre etapas para montar o cronograma da obra.</div>}
    </section>
  );
}
