import assert from "node:assert/strict";
import test from "node:test";
import { creationMigration, migrate, projectDatabase } from "./helpers/project-database.ts";

const creator = "11111111-1111-4111-8111-111111111111";
const owner = "22222222-2222-4222-8222-222222222222";

test("criação de projetos respeita as permissões reais do banco", async (t) => {
  const db = await projectDatabase();
  t.after(() => db.close());
  await db.query("insert into auth.users (id, email) values ($1, 'creator@example.test'), ($2, 'owner@example.test')", [creator, owner]);
  await db.query("insert into public.profile_departments (user_id, department_slug) values ($1, 'projetos'), ($1, 'governanca'), ($2, 'projetos'), ($2, 'governanca')", [creator, owner]);
  await db.query("insert into public.profile_project_permissions (user_id, access_scope) values ($1, 'full'), ($2, 'full')", [creator, owner]);

  async function asUser(userId: string, work: () => Promise<void>) {
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    await db.exec("set role authenticated");
    try { await work(); } finally { await db.exec("reset role"); }
  }
  async function create(category: string | null = "operational", responsible = creator, template: string | null = null) {
    const { rows } = await db.query<{ id: string }>(
      "select public.create_project_from_template('Projeto de teste', $1::uuid, '2026-09-15'::date, $2::uuid, $3) as id",
      [responsible, template, category],
    );
    return rows[0].id;
  }

  await t.test("reproduz o bloqueio anterior para usuário liberado no Adm", async () => {
    await asUser(creator, async () => {
      const { rows } = await db.query<{ allowed: boolean }>("select public.can_create_project('operational') as allowed");
      assert.equal(rows[0].allowed, true);
      await assert.rejects(() => create(), /new row violates row-level security policy for table "projects"/);
    });
  });
  await migrate(db, creationMigration);

  for (const category of ["operational", "governance"]) {
    await t.test(`cria e abre ${category} com o próprio criador como responsável`, async () => {
      await asUser(creator, async () => {
        const id = await create(category);
        const { rows } = await db.query("select owner_user_id, created_by, category from public.projects where id = $1", [id]);
        assert.deepEqual(rows, [{ owner_user_id: creator, created_by: creator, category }]);
        const members = await db.query("select user_id from public.project_members where project_id = $1", [id]);
        assert.deepEqual(members.rows, [{ user_id: creator }]);
      });
    });
  }

  await t.test("mantém criador e responsável escolhido envolvidos", async () => {
    await asUser(creator, async () => {
      const id = await create("governance", owner);
      const project = await db.query("select owner_user_id from public.projects where id = $1", [id]);
      assert.deepEqual(project.rows, [{ owner_user_id: owner }]);
      const members = await db.query<{ user_id: string }>("select user_id from public.project_members where project_id = $1 order by user_id", [id]);
      assert.deepEqual(members.rows.map((row) => row.user_id), [creator, owner]);
    });
  });

  await t.test("a assinatura antiga também cria projetos para outro responsável", async () => {
    await asUser(creator, async () => {
      const { rows } = await db.query<{ id: string }>(
        "select public.create_project_from_template('Cliente antigo', $1::uuid, current_date) as id", [owner],
      );
      const project = await db.query("select category, owner_user_id from public.projects where id = $1", [rows[0].id]);
      assert.deepEqual(project.rows, [{ category: "operational", owner_user_id: owner }]);
    });
  });

  const template = "33333333-3333-4333-8333-333333333333";
  await db.query("insert into public.project_templates (id, name) values ($1, 'Modelo de regressão')", [template]);
  await db.query(`insert into public.project_template_tasks (template_id, title, due_offset_days, position, assignee_user_id)
    values ($1, 'Responsável do projeto', 3, 0, null), ($1, 'Responsável específico', 7, 1, $2)`, [template, creator]);

  for (const category of ["operational", "governance"]) {
    await t.test(`cria tarefas do modelo em ${category} com responsáveis e prazos corretos`, async () => {
      await asUser(creator, async () => {
        const id = await create(category, owner, template);
        const { rows } = await db.query(`select title, assignee_user_id, due_date::text, category
          from public.project_tasks where project_id = $1 order by position`, [id]);
        assert.deepEqual(rows, [
          { title: "Responsável do projeto", assignee_user_id: owner, due_date: "2026-09-18", category },
          { title: "Responsável específico", assignee_user_id: creator, due_date: "2026-09-22", category },
        ]);
        const assignees = await db.query("select user_id from public.project_task_assignees where task_id in (select id from public.project_tasks where project_id = $1) order by user_id", [id]);
        assert.deepEqual(assignees.rows, [{ user_id: creator }, { user_id: owner }]);
      });
    });
  }

  await t.test("reverte projeto e envolvidos se uma tarefa do modelo falhar", async () => {
    await db.query("update public.project_template_tasks set assignee_user_id = $1 where template_id = $2", [owner, template]);
    await db.query("update public.profiles set active = false where user_id = $1", [owner]);
    const before = await db.query("select (select count(*) from public.projects) as projects, (select count(*) from public.project_members) as members, (select count(*) from public.project_tasks) as tasks");
    await asUser(creator, async () => {
      await assert.rejects(() => create("operational", creator, template), /profile_not_available/);
    });
    const after = await db.query("select (select count(*) from public.projects) as projects, (select count(*) from public.project_members) as members, (select count(*) from public.project_tasks) as tasks");
    assert.deepEqual(after.rows, before.rows);
    await db.query("update public.profiles set active = true where user_id = $1", [owner]);
  });

  await t.test("valida responsável, modelo, nome e categoria", async () => {
    await db.query("update public.project_templates set is_active = false where id = $1", [template]);
    await asUser(creator, async () => {
      await assert.rejects(() => create("operational", template), /profile_not_available/);
      await assert.rejects(() => create("operational", creator, template), /project_template_not_available/);
      await assert.rejects(() => create("invalid"), /department_access_required/);
      await assert.rejects(() => create(null), /department_access_required/);
      await assert.rejects(() => db.query("select public.create_project_from_template(' ', $1::uuid, current_date, null, 'operational')", [creator]), /invalid_project_name/);
    });
  });

  await t.test("usuário sem envolvimento não lê, altera ou exclui projetos alheios", async () => {
    let id = "";
    await asUser(owner, async () => { id = await create("operational", owner); });
    await asUser(creator, async () => {
      assert.deepEqual((await db.query("select id from public.projects where id = $1", [id])).rows, []);
      assert.equal((await db.query("update public.projects set name = 'Não permitido' where id = $1", [id])).affectedRows, 0);
      assert.equal((await db.query("delete from public.projects where id = $1", [id])).affectedRows, 0);
    });
  });

  await t.test("o vínculo do criador continua revogável pela lista de envolvidos", async () => {
    let id = "";
    await asUser(creator, async () => { id = await create("operational", owner); });
    await asUser(owner, async () => {
      await db.query("delete from public.project_members where project_id = $1 and user_id = $2", [id, creator]);
    });
    await asUser(creator, async () => {
      assert.deepEqual((await db.query("select id from public.projects where id = $1", [id])).rows, []);
    });
  });

  await t.test("gestão completa em Governança não libera a área de Projetos", async () => {
    await db.query("delete from public.profile_departments where user_id = $1 and department_slug = 'projetos'", [creator]);
    await asUser(creator, async () => {
      await assert.rejects(() => create(), /department_access_required/);
      assert.ok(await create("governance", owner));
    });
    await db.query("insert into public.profile_departments (user_id, department_slug) values ($1, 'projetos')", [creator]);
  });

  await t.test("somente envolvimento e usuário inativo continuam bloqueados", async () => {
    await db.query("update public.profile_project_permissions set access_scope = 'assigned_tasks' where user_id = $1", [creator]);
    await asUser(creator, async () => {
      await assert.rejects(() => create(), /department_access_required/);
      await assert.rejects(() => create("governance"), /department_access_required/);
    });
    await db.query("update public.profile_project_permissions set access_scope = 'full' where user_id = $1", [creator]);
    await db.query("update public.profiles set active = false where user_id = $1", [creator]);
    await asUser(creator, async () => {
      await assert.rejects(() => create(), /department_access_required/);
    });
    await db.query("update public.profiles set active = true where user_id = $1", [creator]);
  });

  await t.test("administrador continua criando sem departamentos explícitos", async () => {
    await db.query("update public.profiles set is_admin = true where user_id = $1", [creator]);
    await db.query("delete from public.profile_departments where user_id = $1", [creator]);
    await asUser(creator, async () => { assert.ok(await create("governance", owner)); });
  });

  await t.test("as duas assinaturas usam RLS e negam execução anônima", async () => {
    const { rows } = await db.query(`select prosecdef, has_function_privilege('anon', oid, 'execute') as anon_execute,
      has_function_privilege('authenticated', oid, 'execute') as authenticated_execute
      from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_project_from_template'`);
    assert.equal(rows.length, 2);
    for (const row of rows) assert.deepEqual(row, { prosecdef: false, anon_execute: false, authenticated_execute: true });
    await db.exec("set role anon");
    try {
      await assert.rejects(() => create(), /permission denied for function create_project_from_template/);
    } finally { await db.exec("reset role"); }
  });
});
