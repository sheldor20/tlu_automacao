import assert from "node:assert/strict";
import test from "node:test";
import { withProjectProgress } from "../lib/project-progress.ts";
import type { Project, ProjectTask } from "../lib/types.ts";

const project = {
  id: "project-1",
  category: "operational",
  name: "Projeto legado",
} as Project;

const tasks = [
  { id: "task-1", project_id: "project-1", status: "concluida", due_date: "2026-08-01" },
  { id: "task-2", project_id: "project-1", status: "em_andamento", due_date: "2026-08-20" },
  { id: "task-3", project_id: "other-project", status: "a_fazer", due_date: "2026-08-10" },
] as ProjectTask[];

test("calcula o progresso dos projetos diretamente a partir das atividades", () => {
  const result = withProjectProgress(project, tasks, "2026-08-31");

  assert.equal(result.total_tasks, 2);
  assert.equal(result.completed_tasks, 1);
  assert.equal(result.overdue_tasks, 1);
  assert.equal(result.progress_percent, 50);
});
