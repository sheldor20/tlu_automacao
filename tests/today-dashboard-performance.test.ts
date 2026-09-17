import assert from "node:assert/strict";
import test from "node:test";
import { migrate, projectDatabase } from "./helpers/project-database.ts";

test("carregamento compacto preserva tarefas, alertas e permissões em todas as visões", async (t) => {
  const db = await projectDatabase();
  t.after(() => db.close());
  for (const migration of ["20260916202418_today_alert_department_permissions.sql", "20260916203610_resolve_today_alerts.sql", "20260917120504_today_dashboard_performance.sql"]) await migrate(db, migration);
  const admin = "11111111-1111-4111-8111-111111111111";
  const user = "22222222-2222-4222-8222-222222222222";
  const other = "33333333-3333-4333-8333-333333333333";
  const leader = "44444444-4444-4444-8444-444444444444";
  for (const id of [admin, user, other, leader]) await db.query("insert into auth.users(id,email) values($1,$2)", [id, `${id}@example.test`]);
  await db.query("update public.profiles set is_admin=(user_id=$1)", [admin]);
  await db.exec("delete from public.profile_departments");
  await db.query("insert into public.profile_departments(user_id,department_slug) values($1,'projetos'),($1,'alugueis'),($2,'projetos'),($3,'projetos')", [user, other, leader]);
  await db.query("insert into public.profile_reporting_lines(leader_user_id,report_user_id) values($1,$2)", [leader, user]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: admin, role: "authenticated" })]);
  const task = (await db.query<{ id: string }>("insert into public.project_tasks(title,due_date,assignee_user_id,assignee_name,assignee_email,created_by) values('Minha tarefa',current_date-1,$1,'Pessoa',$2,$3) returning id", [user, `${user}@example.test`, admin])).rows[0].id;
  const subtaskParent = (await db.query<{ id: string }>("insert into public.project_tasks(title,due_date,assignee_user_id,assignee_name,assignee_email,created_by) values('Tarefa por subtarefa',current_date+1,$1,'Outra',$2,$3) returning id", [other, `${other}@example.test`, admin])).rows[0].id;
  const subtask = (await db.query<{ id: string }>("insert into public.project_subtasks(task_id,title) values($1,'Minha subtarefa') returning id", [subtaskParent])).rows[0].id;
  await db.query("insert into public.project_subtask_assignees(subtask_id,user_id,assignee_name,assignee_email) values($1,$2,'Pessoa',$3)", [subtask, user, `${user}@example.test`]);
  await db.query("insert into public.rentals(name,property_address,lessor_type,lessor_name,status,created_by) values('Reforma','Rua de teste','pf','Locador','aguardando_reforma',$1)", [admin]);

  type Snapshot = { current_user_id: string; selected_user_id: string; departments: string[]; tasks: { id: string; assignees: unknown[] }[]; alerts: { id: string; occurrence_key: string; resolved_at: string | null }[] };
  const snapshot = async (target: string | null = null) => (await db.query<{ data: Snapshot }>("select public.today_dashboard($1) data", [target])).rows[0].data;
  async function asUser(id: string, fn: () => Promise<void>) {
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, role: "authenticated" })]);
    await db.exec("set role authenticated");
    try { await fn(); } finally { await db.exec("reset role"); }
  }
  await asUser(user, async () => {
    const result = await snapshot();
    assert.equal(result.current_user_id, user);
    assert.equal(result.selected_user_id, user);
    assert.deepEqual(result.tasks.map((row) => row.id).sort(), [task, subtaskParent].sort());
    assert.ok(result.tasks.every((row) => Array.isArray(row.assignees)));
    assert.deepEqual(result.alerts, (await db.query("select * from public.today_alerts($1)", [user])).rows);
    assert.equal((await snapshot(other)).selected_user_id, user, "an inaccessible selection falls back to self");
    const alert = result.alerts.find((item) => item.id === `overdue-${task}`)!;
    await db.query("select public.resolve_today_alert($1,$2)", [alert.id, alert.occurrence_key]);
    assert.ok((await snapshot()).alerts.find((item) => item.id === alert.id)?.resolved_at);
    const access = (await db.query<{ data: { profile: { active: boolean; is_admin: boolean }; departments: string[] } }>("select public.current_user_app_access() data")).rows[0].data;
    assert.equal(access.profile.active, true);
    assert.equal(access.profile.is_admin, false);
    assert.deepEqual(access.departments.sort(), ['alugueis', 'projetos']);
  });
  await asUser(leader, async () => {
    const result = await snapshot(user);
    assert.equal(result.selected_user_id, user);
    assert.deepEqual(result.departments, ['projetos']);
    assert.ok(result.alerts.every((item) => !item.id.endsWith('-reforma')));
  });
  await asUser(admin, async () => assert.equal((await snapshot(user)).selected_user_id, user));
  await db.query("delete from public.profile_departments where user_id=$1", [user]);
  await asUser(user, async () => {
    const result = await snapshot();
    assert.deepEqual(result.departments, []);
    assert.deepEqual(result.tasks, []);
    assert.deepEqual(result.alerts, []);
  });
  await db.query("update public.profiles set active=false where user_id=$1", [user]);
  await asUser(user, async () => assert.rejects(() => snapshot(), /profile_not_available/));
  await db.exec("set role anon");
  try {
    await assert.rejects(() => snapshot(), /permission denied/);
    await assert.rejects(() => db.query("select public.current_user_app_access()"), /permission denied/);
  } finally { await db.exec("reset role"); }
});
