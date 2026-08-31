import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260831120000_governance_multi_assignee_subtasks.sql", import.meta.url), "utf8");
const progressViewFix = readFileSync(new URL("../supabase/migrations/20260831184500_rebuild_project_progress_summary.sql", import.meta.url), "utf8");
const shell = readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");
const projectsPage = readFileSync(new URL("../app/(app)/projetos/page.tsx", import.meta.url), "utf8");
const projectDetailPage = readFileSync(new URL("../app/(app)/projetos/[id]/page.tsx", import.meta.url), "utf8");
const businessPage = readFileSync(new URL("../app/(app)/novos-negocios/page.tsx", import.meta.url), "utf8");
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

test("move projetos e suas atividades entre Projetos e Governança", () => {
  assert.match(migration, /create or replace function public\.move_project_to_category/);
  assert.match(migration, /if not public\.has_project_full_access\(p_project_id\)/);
  assert.match(migration, /if not public\.can_create_project\(p_category\)/);
  assert.match(migration, /update public\.projects\s+set category = p_category/);
  assert.match(migration, /update public\.project_tasks\s+set category = p_category/);
  assert.match(projectsPage, /Mover para \{targetLabel\}/);
  assert.match(projectDetailPage, /move_project_to_category/);
});

test("preserva a identificação de negócios ligados a projetos movidos", () => {
  assert.match(migration, /or exists \(\s*select 1 from public\.businesses business/);
  assert.match(migration, /owner_name text,\s*category text/);
  assert.match(businessPage, /options\.filter\(\(project\) => project\.category === "operational"/);
});

test("reconstrói a visão de progresso com a categoria e mantém as telas resilientes", () => {
  assert.match(progressViewFix, /drop view if exists public\.project_progress_summary/);
  assert.match(progressViewFix, /select\s+project\.\*/);
  assert.match(progressViewFix, /grant select on public\.project_progress_summary to authenticated/);
  assert.match(projectsPage, /from\("projects"\)\.select\("\*"\)\.eq\("category", category\)/);
  assert.match(projectDetailPage, /from\("projects"\)\.select\("\*"\)\.eq\("id", params\.id\)\.eq\("category", category\)/);
});
