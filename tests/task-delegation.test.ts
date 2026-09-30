import assert from "node:assert/strict";
import test from "node:test";
import { migrate, projectDatabase } from "./helpers/project-database.ts";

const author = "11111111-1111-4111-8111-111111111111";
const assignee = "22222222-2222-4222-8222-222222222222";
const outsider = "33333333-3333-4333-8333-333333333333";
const blocked = "44444444-4444-4444-8444-444444444444";
const inactive = "55555555-5555-4555-8555-555555555555";

test("delegação avulsa mantém acesso restrito e a privacidade de 1:1", async t => {
  const db = await projectDatabase();
  t.after(() => db.close());
  await db.exec("alter table storage.objects add column owner_id text;");
  for (const name of ["20260916175736_ra_edit_delete_definitions.sql", "20260916180941_ra_delete_item_task.sql", "20260916183159_task_files_comments_activity.sql", "20260916202418_today_alert_department_permissions.sql", "20260928212742_tlu_meeting_rites.sql"]) await migrate(db, name);
  for (const id of [author, assignee, outsider, blocked, inactive]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [id, `${id}@example.test`]);
  }
  await db.query("update public.profiles set is_admin=false,active=(user_id <> $1)", [inactive]);
  await db.query("insert into public.profile_departments(user_id,department_slug) select user_id,slug from public.profiles cross join (values('projetos'),('governanca'),('pauta-ra')) d(slug) where user_id <> $1", [blocked]);
  await db.exec("insert into public.profile_project_permissions(user_id,access_scope) select user_id,'assigned_tasks' from public.profiles;");
  async function asUser<T>(id: string | null, work: () => Promise<T>) {
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, role: "authenticated" })]);
    await db.exec("set role authenticated");
    try { return await work(); } finally { await db.exec("reset role"); }
  }
  async function save({ id = null, project = null, category = "operational", assigned = [assignee], subtasks = [] }: { id?: string | null; project?: string | null; category?: string; assigned?: string[]; subtasks?: object[] } = {}) {
    return (await db.query<{ id: string }>("select public.save_project_task($1,$2,$3,'Uniformes de novas colaboradoras','Alinhar a entrega',current_date,'a_fazer',$4,$5) id", [id, project, category, assigned, JSON.stringify(subtasks)])).rows[0].id;
  }

  await t.test("reproduz task_access_required antes da correção", async () => {
    await asUser(author, () => assert.rejects(() => save(), /task_access_required/));
  });
  await migrate(db, "20260930142104_fix_standalone_task_delegation.sql");
  let task = "";
  await t.test("cria para outra pessoa sem adicionar a autora como responsável", async () => {
    task = await asUser(author, () => save());
    await asUser(author, async () => {
      const row = (await db.query<{ created_by: string; assignee_user_id: string }>("select created_by,assignee_user_id from public.project_tasks where id=$1", [task])).rows[0];
      assert.deepEqual(row, { created_by: author, assignee_user_id: assignee });
      assert.deepEqual((await db.query("select user_id from public.project_task_assignees where task_id=$1", [task])).rows, [{ user_id: assignee }]);
      assert.equal((await db.query<{ scope: string }>("select public.project_permission_scope() scope")).rows[0].scope, "assigned_tasks");
      await db.query("insert into public.project_task_activity(task_id,kind,body) values($1,'comment','Acompanhamento da entrega')", [task]);
    });
    await asUser(assignee, async () => {
      assert.equal((await db.query("select id from public.project_tasks where id=$1", [task])).rows.length, 1);
      assert.equal((await db.query("select id from public.user_notifications where entity_id=$1", [task])).rows.length, 1);
    });
  });
  await t.test("autora edita, reatribui, cria subtarefas e altera o status", async () => {
    await asUser(author, async () => {
      await save({ id: task, assigned: [outsider], subtasks: [{ title: "Conferir tamanhos", position: 0, assignee_user_ids: [outsider] }] });
      assert.equal((await db.query("select id from public.project_subtasks where task_id=$1", [task])).rows.length, 1);
      assert.equal((await db.query("update public.project_tasks set status='em_andamento' where id=$1 returning id", [task])).rows.length, 1);
    });
    await asUser(assignee, async () => assert.equal((await db.query("select id from public.project_tasks where id=$1", [task])).rows.length, 0));
  });
  await t.test("terceiros não leem, editam ou apagam tarefas alheias", async () => {
    await asUser(assignee, async () => {
      await assert.rejects(() => save({ id: task }), /task_access_required/);
      assert.equal((await db.query("update public.project_tasks set title='Indevido' where id=$1 returning id", [task])).rows.length, 0);
      assert.equal((await db.query("delete from public.project_tasks where id=$1 returning id", [task])).rows.length, 0);
      assert.equal((await db.query("select id from public.project_task_activity where task_id=$1", [task])).rows.length, 0);
    });
  });
  await t.test("aceita governança e vários responsáveis", async () => {
    await asUser(author, async () => {
      const id = await save({ category: "governance", assigned: [assignee, outsider] });
      assert.equal((await db.query("select user_id from public.project_task_assignees where task_id=$1", [id])).rows.length, 2);
    });
  });
  await t.test("preserva autenticação, departamento, perfil ativo e acesso a projetos", async () => {
    await asUser(null, () => assert.rejects(() => save(), /authentication_required/));
    await asUser(blocked, () => assert.rejects(() => save(), /department_access_required/));
    await asUser(inactive, () => assert.rejects(() => save(), /department_access_required/));
    await asUser(author, () => assert.rejects(() => save({ assigned: [inactive] }), /profile_not_available/));
    await asUser(author, () => assert.rejects(() => save({ project: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }), /project_access_required/));
    await db.query("delete from public.profile_departments where user_id=$1 and department_slug='projetos'", [author]);
    await asUser(author, async () => {
      assert.equal((await db.query("select id from public.project_tasks where id=$1", [task])).rows.length, 0);
      await assert.rejects(() => save({ id: task }), /department_access_required/);
    });
    await db.query("insert into public.profile_departments(user_id,department_slug) values($1,'projetos')", [author]);
  });
  await t.test("autoria nunca contorna a restrição de uma tarefa privada de 1:1", async () => {
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: assignee, role: "authenticated" })]);
    const id = (await db.query<{ id: string }>("insert into public.project_tasks(title,category,assignee_user_id,assignee_name,assignee_email,due_date,created_by,private_meeting_leader_id,private_meeting_report_id) values('Conversa privada','operational',$1,'Responsável',$2,current_date,$3,$1,$4) returning id", [assignee, `${assignee}@example.test`, author, outsider])).rows[0].id;
    await asUser(author, async () => {
      assert.equal((await db.query("select id from public.project_tasks where id=$1", [id])).rows.length, 0);
      await assert.rejects(() => save({ id }), /task_access_required/);
    });
    await asUser(assignee, async () => assert.equal((await db.query("select id from public.project_tasks where id=$1", [id])).rows.length, 1));
  });
  await t.test("autora pode excluir a tarefa avulsa que delegou", async () => {
    await asUser(author, async () => assert.equal((await db.query("delete from public.project_tasks where id=$1 returning id", [task])).rows.length, 1));
  });
  await t.test("visitantes não podem chamar os endpoints de tarefas", async () => {
    await db.exec("set role anon");
    try {
      await assert.rejects(() => save(), /permission denied/);
      await assert.rejects(() => db.query("select public.can_read_project_task($1)", [task]), /permission denied/);
      await assert.rejects(() => db.query("select public.can_manage_project_task($1)", [task]), /permission denied/);
    } finally { await db.exec("reset role"); }
  });
});
