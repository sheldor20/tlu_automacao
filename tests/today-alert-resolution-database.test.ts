import assert from "node:assert/strict";
import test from "node:test";
import { migrate, projectDatabase } from "./helpers/project-database.ts";

type Alert = { id: string; occurrence_key: string; category: string; resolved_at: string | null; href: string };

test("resolver alertas persiste por usuário, atualiza contagem e respeita novas ocorrências", async (t) => {
  const db = await projectDatabase();
  t.after(() => db.close());
  await migrate(db, "20260916202418_today_alert_department_permissions.sql");
  await migrate(db, "20260916203610_resolve_today_alerts.sql");
  const admin = "11111111-1111-4111-8111-111111111111";
  const user = "22222222-2222-4222-8222-222222222222";
  const other = "33333333-3333-4333-8333-333333333333";
  const denied = "44444444-4444-4444-8444-444444444444";
  for (const [id, name] of [[admin, "Admin"], [user, "Pessoa"], [other, "Outra"], [denied, "Sem acesso"]]) {
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [id, `${id}@example.test`, JSON.stringify({ full_name: name })]);
  }
  await db.query("update public.profiles set is_admin=(user_id=$1)", [admin]);
  await db.exec("delete from public.profile_departments");
  await db.query("insert into public.profile_departments(user_id,department_slug) values($1,'projetos'),($1,'governanca'),($1,'obras'),($1,'alugueis'),($2,'alugueis')", [user, other]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: admin, role: "authenticated" })]);
  const task = (await db.query<{ id: string }>("insert into public.project_tasks(title,due_date,assignee_user_id,assignee_name,assignee_email,created_by) values('Tarefa vencida',current_date-1,$1,'Pessoa',$2,$3) returning id", [user, `${user}@example.test`, admin])).rows[0].id;
  const governance = (await db.query<{ id: string }>("insert into public.project_tasks(title,category,status,due_date,assignee_user_id,assignee_name,assignee_email,created_by) values('Governança concluída','governance','concluida',current_date-1,$1,'Pessoa',$2,$3) returning id", [user, `${user}@example.test`, admin])).rows[0].id;
  const work = (await db.query<{ id: string }>("insert into public.constructions(name,start_date,status,responsible_user_id,created_by) values('Obra teste',current_date-30,'em_andamento',$1,$2) returning id", [user, admin])).rows[0].id;
  const rental = (await db.query<{ id: string }>("insert into public.rentals(name,property_address,lessor_type,lessor_name,status,created_by) values('Imóvel em reforma','Rua de teste','pf','Locador','aguardando_reforma',$1) returning id", [admin])).rows[0].id;
  await db.query("insert into public.rentals(name,property_address,lessor_type,lessor_name,status,lease_start_date,lease_end_date,created_by) values('Contrato de teste','Rua de teste','pf','Locador','alugado',current_date-interval '1 year',current_date+30,$1)", [admin]);
  async function asUser(id: string, work: () => Promise<void>) {
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, role: "authenticated" })]);
    await db.exec("set role authenticated");
    try { await work(); } finally { await db.exec("reset role"); }
  }
  const list = async (target = user) => (await db.query<Alert>("select * from public.today_alerts($1)", [target])).rows;
  const count = async () => (await db.query<{ n: number }>("select public.current_user_today_alert_count() n")).rows[0].n;
  const resolve = (alert: Alert) => db.query("select public.resolve_today_alert($1,$2)", [alert.id, alert.occurrence_key]);
  const reopen = (alert: Alert) => db.query("select public.reopen_today_alert($1,$2)", [alert.id, alert.occurrence_key]);
  let initial: Alert[] = [];
  await asUser(user, async () => { initial = await list(); });
  const renovation = initial.find((alert) => alert.id === `${rental}-reforma`)!;
  const overdue = initial.find((alert) => alert.id === `overdue-${task}`)!;
  const inspection = initial.find((alert) => alert.id === `inspection-${work}`)!;
  assert.ok(renovation && overdue && inspection);

  await t.test("todos os tipos podem ser resolvidos e reabertos, sem concluir o item", async () => {
    await asUser(user, async () => {
      assert.equal(initial.length, 7);
      assert.equal(await count(), initial.length);
      assert.ok(initial.some((alert) => alert.href === "/governanca#quadro-tarefas"));
      for (const alert of initial) {
        const before = await count();
        await resolve(alert);
        await resolve(alert); // retry/double-click is idempotent
        assert.equal(await count(), before - 1);
        assert.ok((await list()).find((row) => row.id === alert.id)?.resolved_at);
      }
      assert.equal(await count(), 0);
      assert.equal((await list()).filter((alert) => !alert.resolved_at).length, 0);
      assert.equal((await db.query<{ status: string }>("select status from public.project_tasks where id=$1", [task])).rows[0].status, "a_fazer");
      assert.equal((await db.query<{ status: string }>("select status from public.rentals where id=$1", [rental])).rows[0].status, "aguardando_reforma");
      await reopen(renovation);
      assert.equal(await count(), 1);
      await resolve(renovation);
    });
    await asUser(user, async () => assert.equal(await count(), 0, "persiste em outra sessão"));
  });
  await t.test("resolução é individual; administrador vê o estado mas não resolve por outra pessoa", async () => {
    await asUser(other, async () => {
      assert.equal((await list(other)).filter((alert) => !alert.resolved_at).length, 3);
      await assert.rejects(() => db.query("insert into public.today_alert_resolutions(user_id,alert_id,occurrence_key) values($1,$2,$3)", [user, renovation.id, renovation.occurrence_key]), /row-level security/);
      assert.equal((await db.query("delete from public.today_alert_resolutions where user_id=$1 returning *", [user])).rows.length, 0);
    });
    await asUser(admin, async () => {
      assert.ok((await list(user)).every((alert) => alert.resolved_at));
      await assert.rejects(() => resolve(overdue), /today_alert_not_available/);
    });
  });
  await t.test("chaves inventadas, alertas inacessíveis e gravação do horário são bloqueados", async () => {
    await asUser(user, async () => {
      await assert.rejects(() => resolve({ ...overdue, id: "inventado" }), /today_alert_not_available/);
      await assert.rejects(() => db.query("insert into public.today_alert_resolutions(user_id,alert_id,occurrence_key) values($1,'inventado','0')", [user]), /row-level security/);
      await assert.rejects(() => db.query("update public.today_alert_resolutions set resolved_at=now()"), /permission denied/);
    });
    await asUser(denied, async () => {
      assert.deepEqual(await list(denied), []);
      assert.equal(await count(), 0);
      await assert.rejects(() => resolve(renovation), /today_alert_not_available/);
    });
    await db.exec("set role anon");
    try { await assert.rejects(() => resolve(renovation), /permission denied/); } finally { await db.exec("reset role"); }
  });
  await t.test("alterações sem nova ocorrência não reabrem o alerta de reforma", async () => {
    await db.query("update public.rentals set notes='Atualização cadastral' where id=$1", [rental]);
    await asUser(user, async () => assert.ok((await list()).find((alert) => alert.id === renovation.id)?.resolved_at));
    await db.query("update public.rentals set status='desocupado' where id=$1", [rental]);
    await db.query("update public.rentals set status='aguardando_reforma' where id=$1", [rental]);
    await asUser(user, async () => {
      const next = (await list()).find((alert) => alert.id === renovation.id)!;
      assert.equal(next.resolved_at, null);
      assert.notEqual(next.occurrence_key, renovation.occurrence_key);
      await assert.rejects(() => resolve(renovation), /today_alert_not_available/);
    });
  });
  await t.test("mudança de prazo, reabertura e nova atribuição voltam a alertar", async () => {
    await db.query("update public.project_tasks set due_date=current_date-2 where id=$1", [task]);
    await asUser(user, async () => {
      const next = (await list()).find((alert) => alert.id === overdue.id)!;
      assert.equal(next.resolved_at, null);
      await resolve(next);
    });
    await db.query("update public.project_tasks set status='concluida' where id=$1", [task]);
    await db.query("update public.project_tasks set status='a_fazer' where id=$1", [task]);
    await db.query("update public.user_notifications set created_at=created_at+interval '1 second' where entity_id=$1", [governance]);
    await asUser(user, async () => {
      assert.equal((await list()).find((alert) => alert.id === overdue.id)?.resolved_at, null);
      assert.ok((await list()).some((alert) => alert.category === "notification" && !alert.resolved_at));
    });
  });
  await t.test("nova vistoria e contrato alterado geram novas ocorrências", async () => {
    await db.query("update public.constructions set inspection_interval_days=10 where id=$1", [work]);
    await db.exec("update public.rentals set lease_end_date=lease_end_date+1 where status='alugado'");
    await asUser(user, async () => {
      const rows = await list();
      assert.equal(rows.find((alert) => alert.id === inspection.id)?.resolved_at, null);
      assert.ok(rows.some((alert) => alert.id.endsWith('-renovacao') && !alert.resolved_at));
      assert.equal(await count(), rows.filter((alert) => !alert.resolved_at).length);
    });
  });
  await t.test("revogar departamento ou desativar usuário impede novas resoluções", async () => {
    await db.query("delete from public.profile_departments where user_id=$1 and department_slug='alugueis'", [user]);
    await asUser(user, async () => {
      assert.ok((await list()).every((alert) => alert.category !== 'rental'));
      await assert.rejects(() => reopen(renovation), /today_alert_not_available/);
    });
    await db.query("update public.profiles set active=false where user_id=$1", [user]);
    await asUser(user, async () => { assert.deepEqual(await list(), []); assert.equal(await count(), 0); });
  });
});
