import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260821110000_team_hierarchy_private_work_and_today_alerts.sql", import.meta.url),
  "utf8",
);

test("restringe projetos a envolvidos, administradores e líderes diretos", () => {
  assert.match(migration, /create or replace function public\.has_project_access/);
  assert.match(migration, /public\.user_is_involved_in_project\(p_project_id, auth\.uid\(\)\)/);
  assert.match(migration, /line\.leader_user_id = auth\.uid\(\)/);
});

test("não libera tarefas avulsas para usuários globais", () => {
  assert.match(migration, /create policy project_tasks_read[\s\S]*public\.can_read_project_task\(project_id, assignee_user_id\)/);
  assert.match(migration, /p_assignee_user_id = auth\.uid\(\)/);
  assert.match(migration, /public\.is_direct_leader_of\(p_assignee_user_id\)/);
});

test("impede hierarquia circular e relação consigo mesmo", () => {
  assert.match(migration, /reporting_line_no_self_leadership/);
  assert.match(migration, /prevent_reporting_line_cycle/);
  assert.match(migration, /reporting_line_cycle/);
});

test("gera alerta persistente quando outra pessoa atribui uma tarefa", () => {
  assert.match(migration, /create table if not exists public\.user_notifications/);
  assert.match(migration, /create trigger notify_task_assignment_after_write/);
  assert.match(migration, /'task_assigned'/);
});

test("usa a periodicidade configurável no próximo vencimento da vistoria", () => {
  assert.match(migration, /inspection_interval_days integer not null default 15/);
  assert.match(migration, /coalesce\(i\.last_inspection_at, c\.start_date\) \+ c\.inspection_interval_days/);
});

test("calcula o badge do Hoje somente para o usuário autenticado", () => {
  assert.match(migration, /create or replace function public\.current_user_today_alert_count\(\)/);
  assert.match(migration, /notification\.recipient_user_id = auth\.uid\(\)/);
  assert.match(migration, /task\.assignee_user_id = auth\.uid\(\)/);
  assert.match(migration, /work\.responsible_user_id = auth\.uid\(\)/);
});
