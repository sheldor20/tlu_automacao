import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260831120000_governance_multi_assignee_subtasks.sql", import.meta.url), "utf8");
const shell = readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");
const projectsPage = readFileSync(new URL("../app/(app)/projetos/page.tsx", import.meta.url), "utf8");
const taskBoard = readFileSync(new URL("../components/project-task-board.tsx", import.meta.url), "utf8");

test("separa projetos operacionais e de governança com acesso próprio", () => {
  assert.match(migration, /values \('governanca', 'Governança', 4\)/);
  assert.match(migration, /category in \('operational', 'governance'\)/);
  assert.match(migration, /when 'governance' then public\.has_department_access\('governanca'\)/);
  assert.match(shell, /href: "\/governanca", label: "Governança"/);
  assert.match(projectsPage, /eq\("category", category\)/);
});

test("normaliza vários responsáveis de atividade e subtarefa", () => {
  assert.match(migration, /create table if not exists public\.project_task_assignees/);
  assert.match(migration, /create table if not exists public\.project_subtasks/);
  assert.match(migration, /create table if not exists public\.project_subtask_assignees/);
  assert.match(migration, /create or replace function public\.save_project_task/);
  assert.match(migration, /p_assignee_ids uuid\[\]/);
  assert.match(migration, /p_subtasks jsonb/);
});

test("mostra, edita, conclui e exclui atividades e subitens", () => {
  assert.match(taskBoard, /onEditTask/);
  assert.match(taskBoard, /onToggleSubtask/);
  assert.match(taskBoard, /onDeleteTask/);
  assert.match(migration, /create or replace function public\.set_project_subtask_completed/);
  assert.match(migration, /delete from public\.project_subtasks subtask/);
});

test("recria as opções de projetos sem conflito de tipo de retorno", () => {
  assert.match(migration, /drop function if exists public\.business_project_options\(\);\s*create function public\.business_project_options\(\)/);
  assert.match(migration, /archived_at timestamptz,\s*owner_name text/);
  assert.match(migration, /grant execute on function public\.business_project_options\(\) to authenticated/);
});
