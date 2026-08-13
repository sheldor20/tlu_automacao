import assert from "node:assert/strict";
import test from "node:test";
import { prioritizeOverdueTasks } from "../lib/project-meeting-agenda.ts";
import type { ProjectTask } from "../lib/types.ts";

function task(index: number, dueDate: string, status: ProjectTask["status"] = "a_fazer"): ProjectTask {
  return {
    id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
    project_id: index % 2 ? "p1" : "p2",
    title: `Tarefa ${index}`,
    description: null,
    assignee_user_id: null,
    assignee_name: "Responsável",
    assignee_email: "responsavel@example.com",
    due_date: dueDate,
    status,
    position: index,
    completed_at: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

test("prioriza as dez tarefas há mais tempo atrasadas e separa as demais", () => {
  const tasks = Array.from({ length: 12 }, (_, index) => task(index + 1, `2026-07-${String(index + 1).padStart(2, "0")}`));
  const result = prioritizeOverdueTasks(tasks, [{ id: "p1", name: "Projeto A" }, { id: "p2", name: "Projeto B" }], "2026-08-13");
  assert.equal(result.top_priorities.length, 10);
  assert.equal(result.other_overdue.length, 2);
  assert.equal(result.top_priorities[0].title, "Tarefa 1");
  assert.ok(result.top_priorities[0].overdue_days > result.top_priorities[9].overdue_days);
});

test("ignora tarefas concluídas e não vencidas", () => {
  const result = prioritizeOverdueTasks([task(1, "2026-07-01", "concluida"), task(2, "2026-08-20")], [{ id: "p1", name: "Projeto A" }, { id: "p2", name: "Projeto B" }], "2026-08-13");
  assert.deepEqual(result, { top_priorities: [], other_overdue: [] });
});
