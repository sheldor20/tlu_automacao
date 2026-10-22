import test from "node:test";
import assert from "node:assert/strict";
import { migrate, projectDatabase } from "./helpers/project-database.ts";

test("banco real: migração aditiva preserva legado, bloqueia novas escritas e mantém herança/permissões", async (t) => {
  const db = await projectDatabase();
  t.after(() => db.close());
  for (const file of [
    "20260916132107_enterprise_performance.sql",
    "20260916180238_payment_requests.sql",
    "20260916180335_payment_access_policies.sql",
    "20260916180924_payment_email_order.sql",
    "20260916192138_payment_finalized_status.sql",
    "20260916194044_payment_materials_optional_fields.sql",
    "20260916203112_payment_edit_delete.sql",
    "20260917133227_finance_clients_collections.sql",
  ])
    await migrate(db, file);
  const admin = "11111111-1111-4111-8111-111111111111",
    member = "22222222-2222-4222-8222-222222222222",
    outsider = "33333333-3333-4333-8333-333333333333";
  for (const id of [admin, member, outsider])
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      id,
      `${id}@example.test`,
    ]);
  await db.query("update profiles set is_admin=(user_id=$1)", [admin]);
  await db.exec("delete from profile_departments");
  await db.query(
    "insert into profile_departments(user_id,department_slug,access_level) values($1,'obras','member')",
    [member],
  );
  await db.exec(
    "insert into qlik_companies(id,name,company_key) values('test','Empresa teste','test'); insert into qlik_works(key,company_id,work_id,name) values('test|001','test','001','Unidade A'),('test|002','test','002','Unidade B'),('test|003','test','003','Unidade C');",
  );
  const work = (
    await db.query<{ id: string }>(
      "insert into constructions(name,start_date,created_by,qlik_work_key) values('Obra teste','2026-01-01',$1,'test|001') returning id",
      [admin],
    )
  ).rows[0].id;
  async function createBusiness(name: string) {
    const project = (
      await db.query<{ id: string }>(
        "insert into projects(name,start_date,owner_name,owner_email,objective,created_by,owner_user_id) values('Projeto teste','2026-01-01','Teste','test@example.test','Objetivo teste',$1,$1) returning id",
        [admin],
      )
    ).rows[0].id;
    return (
      await db.query<{ id: string }>(
        "insert into businesses(project_id,name,start_date,address,city,state,created_by,qlik_work_key) values($1,$2,'2026-01-01','Rua teste','Teste','SP',$3,'test|001') returning id",
        [project, name, admin],
      )
    ).rows[0].id;
  }
  const business = await createBusiness("Negócio teste");
  const inherited = (
    await db.query<{ id: string }>(
      "insert into constructions(name,start_date,created_by,source_business_id) values('Obra herdada','2026-01-01',$1,$2) returning id",
      [admin, business],
    )
  ).rows[0].id;
  const stage = (
    await db.query<{ id: string }>(
      "insert into construction_macro_stages(construction_id,name,created_by) values($1,'Etapa teste',$2) returning id",
      [work, admin],
    )
  ).rows[0].id;
  await db.query(
    "insert into construction_budgets(construction_id,reference_month,planned_amount,realized_amount,created_by) values($1,'2026-09-01',100,80,$2)",
    [work, admin],
  );
  await db.query(
    "insert into construction_commitments(construction_id,supplier,description,due_date,amount,created_by) values($1,'Fornecedor','Compromisso','2026-10-01',25,$2)",
    [work, admin],
  );
  await db.query(
    "insert into construction_cost_estimates(construction_id,remaining_uncommitted,updated_by) values($1,50,$2)",
    [work, admin],
  );
  await db.query(
    "insert into construction_stage_finances(construction_id,macro_stage_id,planned_budget,updated_by) values($1,$2,100,$3)",
    [work, stage, admin],
  );
  const policies = await db.query(
    "select tablename,policyname,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname",
  );
  const grants = await db.query(
    "select relname,relacl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by relname",
  );
  await migrate(db, "20261022143304_construction_qlik_monthly_readonly.sql");
  assert.deepEqual(
    (
      await db.query(
        "select tablename,policyname,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname",
      )
    ).rows,
    policies.rows,
  );
  assert.deepEqual(
    (
      await db.query(
        "select relname,relacl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by relname",
      )
    ).rows,
    grants.rows,
  );
  assert.deepEqual(
    (
      await db.query(
        "select qlik_work_key,qlik_additional_work_keys from constructions where id=$1",
        [work],
      )
    ).rows[0],
    { qlik_work_key: "test|001", qlik_additional_work_keys: [] },
  );
  await db.query(
    "update constructions set qlik_additional_work_keys=array['test|002'] where id=$1",
    [work],
  );
  for (const bad of [
    "array['missing|1']",
    "array['test|001']",
    "array['test|002','test|002']",
    "array[null]::text[]",
    "array[['test|002','test|003']]",
  ])
    await assert.rejects(
      () =>
        db.query(
          `update constructions set qlik_additional_work_keys=${bad} where id=$1`,
          [work],
        ),
      /construction_qlik/,
    );
  await db.exec("update qlik_works set active=false where key='test|003'");
  await assert.rejects(
    () =>
      db.query(
        "update constructions set qlik_additional_work_keys=array['test|003'] where id=$1",
        [work],
      ),
    /unavailable/,
  );
  await assert.rejects(
    () =>
      db.query(
        "update constructions set qlik_work_key='test|002' where id=$1",
        [inherited],
      ),
    /inherited_link/,
  );
  await db.query(
    "update constructions set qlik_additional_work_keys=array['test|002'] where id=$1",
    [inherited],
  );
  await db.query("update businesses set qlik_work_key='test|002' where id=$1", [
    business,
  ]);
  assert.deepEqual(
    (
      await db.query(
        "select qlik_work_key,qlik_additional_work_keys from constructions where id=$1",
        [inherited],
      )
    ).rows[0],
    { qlik_work_key: "test|002", qlik_additional_work_keys: [] },
  );
  // A new construction must still inherit the principal from its business.
  const secondBusiness = await createBusiness("Segundo negócio");
  const newWork = (
    await db.query<{ qlik_work_key: string }>(
      "insert into constructions(name,start_date,created_by,source_business_id) values('Nova herdada','2026-01-01',$1,$2) returning qlik_work_key",
      [admin, secondBusiness],
    )
  ).rows[0];
  assert.equal(newWork.qlik_work_key, "test|001");
  for (const table of [
    "construction_budgets",
    "construction_commitments",
    "construction_cost_estimates",
    "construction_stage_finances",
  ]) {
    assert.equal(
      (await db.query<{ n: number }>(`select count(*)::int n from ${table}`))
        .rows[0].n,
      1,
    );
    await assert.rejects(
      () => db.exec(`delete from ${table}`),
      /construction_finance_read_only/,
    );
    await assert.rejects(
      () => db.exec(`update ${table} set construction_id=construction_id`),
      /construction_finance_read_only/,
    );
    await assert.rejects(
      () => db.exec(`insert into ${table} select * from ${table}`),
      /construction_finance_read_only/,
    );
  }
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: member, role: "authenticated" }),
  ]);
  await db.exec("set role authenticated");
  assert.equal(
    (await db.query("select * from construction_budgets")).rows.length,
    1,
  );
  await assert.rejects(
    () =>
      db.query(
        "insert into construction_budgets(construction_id,reference_month,planned_amount,realized_amount) values($1,'2026-10-01',1,1)",
        [work],
      ),
    /construction_finance_read_only/,
  );
  // No business module access: keep inherited key and edit this construction's extra units.
  await db.query(
    "update constructions set qlik_additional_work_keys=array['test|001'] where id=$1",
    [inherited],
  );
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: outsider, role: "authenticated" }),
  ]);
  await db.exec("set role authenticated");
  assert.equal((await db.query("select * from constructions")).rows.length, 0);
  assert.equal(
    (await db.query("select * from construction_budgets")).rows.length,
    0,
  );
  await db.exec("reset role");
  assert.equal(
    (
      await db.query<{ realized_amount: string }>(
        "select realized_amount from construction_budgets",
      )
    ).rows[0].realized_amount,
    "80.00",
  );
});
