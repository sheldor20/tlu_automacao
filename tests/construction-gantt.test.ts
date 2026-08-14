import assert from "node:assert/strict";
import test from "node:test";
import { buildConstructionGantt } from "../lib/construction-gantt.ts";
import type { MacroStage } from "../lib/types.ts";

const macro = {
  id: "macro-1",
  construction_id: "work-1",
  name: "Infraestrutura",
  description: null,
  start_date: null,
  end_date: null,
  weight_percent: 100,
  position: 0,
  progress_percent: 25,
  micro_stages: [
    {
      id: "micro-1",
      macro_stage_id: "macro-1",
      name: "Drenagem",
      description: null,
      start_date: "2026-08-10",
      end_date: "2026-08-20",
      progress_percent: 25,
      position: 0,
      supplies: [],
      last_evidence_id: null,
      updated_at: "2026-08-01T00:00:00Z",
    },
  ],
} satisfies MacroStage;

test("deriva a faixa da etapa a partir das microetapas quando necessário", () => {
  const gantt = buildConstructionGantt({ start_date: "2026-08-01", expected_end_date: "2026-09-30" }, [macro]);
  const macroRow = gantt.rows[0];
  assert.equal(macroRow.start_date, "2026-08-10");
  assert.equal(macroRow.end_date, "2026-08-20");
  assert.equal(macroRow.derived, true);
  assert.ok(Number(macroRow.width_percent) > 0);
});

test("mantém etapas sem datas no cronograma sem inventar um período", () => {
  const gantt = buildConstructionGantt({ start_date: "2026-08-01", expected_end_date: null }, [{ ...macro, micro_stages: [] }]);
  assert.equal(gantt.rows[0].start_date, null);
  assert.equal(gantt.rows[0].left_percent, null);
  assert.ok(gantt.months.length >= 1);
});
