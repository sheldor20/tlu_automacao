import assert from "node:assert/strict";
import test from "node:test";
import { migrate, projectDatabase } from "./helpers/project-database.ts";

test("Hoje respeita departamentos, acesso ao item e revogação na lista e no contador", async (t) => {
  const db = await projectDatabase();
  t.after(() => db.close());
  const admin = "11111111-1111-4111-8111-111111111111";
  const user = "22222222-2222-4222-8222-222222222222";
  const leader = "33333333-3333-4333-8333-333333333333";
  const outsider = "44444444-4444-4444-8444-444444444444";
  for (const [id, name] of [[admin, "Admin"], [user, "Pessoa"], [leader, "Lider"], [outsider, "Outra"]]) {
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [id, `${name}@example.test`, JSON.stringify({ full_name: name })]);
  }
  await db.query("update public.profiles set is_admin = (user_id = $1)", [admin]);
  await db.exec("delete from public.profile_departments");
  await db.query("insert into public.profile_departments(user_id,department_slug) values($1,'projetos'),($2,'projetos'),($3,'projetos')", [user, leader, outsider]);
  await db.query("insert into public.profile_project_permissions(user_id,access_scope) values($1,'assigned_tasks')", [user]);
  await db.query("insert into public.profile_reporting_lines(report_user_id,leader_user_id) values($1,$2)", [user, leader]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: admin, role: "authenticated" })]);
  const taskIds: Record<string, string> = {};
  for (const category of ["operational", "governance"]) {
    taskIds[category] = (await db.query<{ id: string }>(`
      insert into public.project_tasks(title,category,due_date,assignee_user_id,assignee_name,assignee_email,created_by)
      values($1,$2,current_date-1,$3,'Pessoa','pessoa@example.test',$4) returning id
    `, [`Tarefa ${category}`, category, user, admin])).rows[0].id;
  }
  const hiddenTask = (await db.query<{ id: string }>(`
    insert into public.project_tasks(title,due_date,assignee_user_id,assignee_name,assignee_email,created_by)
    values('Tarefa de outra pessoa',current_date-1,$1,'Outra','outra@example.test',$2) returning id
  `, [outsider, admin])).rows[0].id;
  // Existing notifications can remain after a task loses access or disappears.
  for (const id of [hiddenTask, "55555555-5555-4555-8555-555555555555"]) {
    await db.query("insert into public.user_notifications(recipient_user_id,notification_type,entity_id,title,message) values($1,'task_assigned',$2,'Aviso antigo','Conteúdo restrito')", [user, id]);
  }
  await db.query("insert into public.rentals(name,property_address,lessor_type,lessor_name,status,created_by) values('Imóvel em reforma','Rua de teste','pf','Locador','aguardando_reforma',$1)", [admin]);
  await db.query("insert into public.constructions(name,start_date,status,responsible_user_id,created_by) values('Obra de teste',current_date-30,'em_andamento',$1,$2)", [user, admin]);

  async function asUser(id: string, work: () => Promise<void>) {
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, role: "authenticated" })]);
    await db.exec("set role authenticated");
    try { await work(); } finally { await db.exec("reset role"); }
  }
  const count = async () => Number((await db.query<{ count: number }>("select public.current_user_today_alert_count() as count")).rows[0].count);
  const access = async (id = user) => (await db.query<{ departments: string[] }>("select public.today_department_access($1) as departments", [id])).rows[0].departments;
  const notifications = async () => (await db.query<{ entity_id: string }>("select entity_id from public.user_notifications where recipient_user_id=$1 order by entity_id", [user])).rows.map((row) => row.entity_id);

  await asUser(user, async () => assert.equal((await notifications()).length, 4, "reproduz o vazamento antes da correção"));
  await migrate(db, "20260916202418_today_alert_department_permissions.sql");

  await t.test("somente Projetos: oculta Governança, Aluguéis, Obras e itens inacessíveis", async () => {
    await asUser(user, async () => {
      assert.deepEqual(await access(), ["projetos"]);
      assert.deepEqual(await notifications(), [taskIds.operational]);
      assert.equal(await count(), 2, "tarefa atrasada + atribuição permitida");
      assert.equal((await db.query("select * from public.rentals")).rows.length, 0);
    });
  });
  await t.test("administrador consultando pessoa sem Aluguéis não herda suas próprias áreas", async () => {
    await asUser(admin, async () => {
      assert.deepEqual(await access(), ["projetos"]);
      assert.ok((await access(admin)).includes("alugueis"));
      assert.deepEqual(await notifications(), [taskIds.operational]);
    });
  });
  await t.test("liderança respeita a interseção das áreas; terceiros não consultam permissões", async () => {
    await db.query("insert into public.profile_departments(user_id,department_slug) values($1,'alugueis')", [user]);
    await asUser(leader, async () => assert.deepEqual(await access(), ["projetos"]));
    await asUser(outsider, async () => assert.deepEqual(await access(), []));
    await db.query("delete from public.profile_departments where user_id=$1 and department_slug='alugueis'", [user]);
  });
  await t.test("notificação permitida continua podendo ser marcada como lida", async () => {
    await asUser(user, async () => {
      const updated = await db.query("update public.user_notifications set read_at=now() where entity_id=$1 returning id", [taskIds.operational]);
      assert.equal(updated.rows.length, 1);
      assert.equal(await count(), 1);
    });
    await db.query("update public.user_notifications set read_at=null where entity_id=$1", [taskIds.operational]);
  });
  await t.test("somente Governança: mostra sua atribuição e seu atraso", async () => {
    await db.query("update public.profile_departments set department_slug='governanca' where user_id=$1", [user]);
    await asUser(user, async () => {
      assert.deepEqual(await notifications(), [taskIds.governance]);
      assert.equal(await count(), 2);
    });
  });
  await t.test("cada área adiciona apenas seus alertas; revogação remove lista e contador", async () => {
    await db.query("insert into public.profile_departments(user_id,department_slug) values($1,'alugueis'),($1,'obras'),($1,'projetos')", [user]);
    await asUser(user, async () => assert.equal(await count(), 6));
    await db.query("delete from public.profile_departments where user_id=$1", [user]);
    await asUser(user, async () => {
      assert.deepEqual(await access(), []);
      assert.deepEqual(await notifications(), []);
      assert.equal(await count(), 0);
    });
  });
  await t.test("permissões de usuário inativo e sessão anônima falham fechadas", async () => {
    await db.query("update public.profiles set active=false where user_id=$1", [user]);
    await asUser(admin, async () => assert.deepEqual(await access(), []));
    await asUser(user, async () => { assert.deepEqual(await access(), []); assert.equal(await count(), 0); });
    await db.exec("set role anon");
    try { await assert.rejects(() => access(), /permission denied/); } finally { await db.exec("reset role"); }
  });
});
