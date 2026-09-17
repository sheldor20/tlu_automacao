import test from "node:test";
import assert from "node:assert/strict";
import { migrate, projectDatabase } from "./helpers/project-database.ts";
test("planejador: migração, agregação real e acesso restrito", async (t) => {
  const db = await projectDatabase();
  t.after(() => db.close());
  for (const migration of [
    "20260916132107_enterprise_performance.sql",
    "20260916180238_payment_requests.sql",
    "20260916180335_payment_access_policies.sql",
    "20260916180924_payment_email_order.sql",
    "20260916192138_payment_finalized_status.sql",
    "20260916194044_payment_materials_optional_fields.sql",
    "20260916203112_payment_edit_delete.sql",
    "20260917133227_finance_clients_collections.sql",
    "20260917133652_operations_source_catalog.sql",
    "20260917133845_operations_catalog_publish_guard.sql",
    "20260917134314_operations_import_timeout.sql",
    "20260917134801_operations_batched_ingestion.sql",
    "20260917135639_operations_collection_classification.sql",
  ])
    await migrate(db, migration);

  await migrate(db, "20260917140745_five_year_budget.sql");
  const admin = "11111111-1111-4111-8111-111111111111",
    viewer = "22222222-2222-4222-8222-222222222222",
    outsider = "33333333-3333-4333-8333-333333333333";
  for (const id of [admin, viewer, outsider])
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      id,
      id + "@example.test",
    ]);
  await db.query("update profiles set is_admin=(user_id=$1)", [admin]);
  await db.exec("delete from profile_departments");
  await db.query(
    "insert into profile_departments(user_id,department_slug,access_level) values($1,'financeiro','viewer')",
    [viewer],
  );
  await db.query(
    "insert into budget_plans(name,start_year,data,created_by,updated_by) values('Base',2026,'{}',$1,$1)",
    [admin],
  );
  await db.exec(
    "insert into qlik_companies(id,name,company_key) values('test','Teste','Teste'); insert into operational_cash_entries(id,company_id,kind,cash_date,amount,source_category) values('r','test','received','2026-01-10',500,'Principal'),('p','test','paid','2026-01-12',150,'Obra'),('f','test','receivable','2027-01-12',700,'Principal'),('old','test','receivable','2025-01-12',9,'Principal');",
  );
  const source = (
    await db.query<{
      v: {
        rows: { month: string; kind: string; amount: number }[];
        overdue_receivables: number;
      };
    }>("select budget_source_months(2026) v")
  ).rows[0].v;
  assert.equal(source.rows.length, 3);
  assert.equal(source.rows.find((r) => r.kind === "received")?.amount, 500);
  assert.equal(source.overdue_receivables, 9);
  for (const [id, count] of [
    [viewer, 1],
    [outsider, 0],
  ] as const) {
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: id, role: "authenticated" }),
    ]);
    await db.exec("set role authenticated");
    try {
      assert.equal(
        (await db.query("select * from budget_plans")).rows.length,
        count,
      );
      await assert.rejects(
        () => db.exec("update budget_plans set name='Bad'"),
        /permission denied/,
      );
      await assert.rejects(
        () => db.exec("select budget_source_months(2026)"),
        /permission denied/,
      );
      await assert.rejects(
        () => db.exec("select save_business_budget_curve(null,'[]',0,null)"),
        /permission denied/,
      );
    } finally {
      await db.exec("reset role");
    }
  }
  await db.exec("set role anon");
  try {
    await assert.rejects(
      () => db.exec("select * from budget_plans"),
      /permission denied/,
    );
    await assert.rejects(
      () => db.exec("select * from business_budget_curves"),
      /permission denied/,
    );
  } finally {
    await db.exec("reset role");
  }
  const changed = await db.query(
    "update budget_plans set name='Revisado',version=2 where version=1 returning id",
  );
  assert.equal(changed.rows.length, 1);
  const stale = await db.query(
    "update budget_plans set name='Antigo',version=2 where version=1 returning id",
  );
  assert.equal(stale.rows.length, 0);
  const project = "44444444-4444-4444-8444-444444444444",
    business = "55555555-5555-4555-8555-555555555555";
  await db.query(
    "insert into projects(id,name,start_date,owner_name,owner_email,objective,created_by,owner_user_id) values($1,'Projeto teste','2026-01-01','Teste','test@example.test','Objetivo teste',$2,$2)",
    [project, admin],
  );
  await db.query(
    "insert into businesses(id,project_id,name,start_date,address,city,state,created_by) values($1,$2,'Negócio teste','2026-01-01','Rua teste','Teste','SP',$3)",
    [business, project, admin],
  );
  const curve = [{ month: 1, vgv: 123, investment: 50 }];
  await db.query("select save_business_budget_curve($1,$2,0,$3)", [
    business,
    JSON.stringify(curve),
    admin,
  ]);
  assert.equal(
    Number(
      (
        await db.query<{ potential_vgv: string }>(
          "select potential_vgv from businesses where id=$1",
          [business],
        )
      ).rows[0].potential_vgv,
    ),
    123,
  );
  await assert.rejects(
    () =>
      db.query("select save_business_budget_curve($1,$2,0,$3)", [
        business,
        JSON.stringify(curve),
        admin,
      ]),
    /budget_conflict/,
  );
  assert.equal(
    (
      await db.query<{ version: number }>(
        "select version from business_budget_curves",
      )
    ).rows[0].version,
    1,
  );
});
