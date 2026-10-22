import test from "node:test";
import assert from "node:assert/strict";
import { migrate, projectDatabase } from "./helpers/project-database.ts";
import { monthlyConstructionExpenses } from "../lib/construction-finance.ts";

test("indicadores e resumo usam o mesmo gasto Qlik publicado, respeitando RLS e sem legado", async (t) => {
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
    "20260917140638_operations_compact_ingestion.sql",
    "20260917143529_operations_resumable_imports.sql",
    "20260917145001_operations_initial_publish_budget.sql",
    "20260917145843_operations_publication_scan.sql",
    "20260917151438_operations_read_performance.sql",
    "20260917162639_operations_initial_activation.sql",
    "20260917163239_operations_collection_index.sql",
    "20260917164123_operations_overdue_dates.sql",
    "20260917174235_cash_projection_covering_index.sql",
    "20260917174951_client_financial_and_property_status.sql",
    "20260917175343_client_status_snapshot_replace.sql",
  ])
    await migrate(db, migration);

  await migrate(db, "20261022143304_construction_qlik_monthly_readonly.sql");
  const admin = "11111111-1111-4111-8111-111111111111";
  const outsider = "22222222-2222-4222-8222-222222222222";
  await db.query("insert into auth.users(id,email) values($1,'admin@example.test'),($2,'other@example.test')", [admin, outsider]);
  await db.query("update profiles set is_admin=(user_id=$1)", [admin]);
  await db.exec("delete from profile_departments; insert into qlik_companies(id,name,company_key) values('test','Teste','test'); insert into qlik_works(key,company_id,work_id,name) values('test|001','test','001','A'),('test|002','test','002','B')");
  const work = (await db.query<{id:string}>("insert into constructions(name,start_date,created_by,status,planned_budget,qlik_work_key,qlik_additional_work_keys) values('Teste',current_date,$1,'em_andamento',100,'test|001',array['test|002']) returning id", [admin])).rows[0].id;
  const entries = [
    { id: "paid", work_key: "test|001", kind: "paid", amount: 20, source_category: "Reformas" },
    { id: "both", work_key: "test|002", kind: "paid", amount: 30, source_category: "9.118.01 - Reformas" },
    { id: "neighbor", work_key: "test|001", kind: "paid", amount: 999, source_category: "9.1180" },
    { id: "payable", work_key: "test|001", kind: "payable", amount: 80, source_category: "9.118" },
  ].map(e => ({...e, active:true, cash_date: new Intl.DateTimeFormat("en-CA", {timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}));
  for (const e of entries) await db.query("insert into operational_cash_entries(id,company_id,work_key,kind,amount,source_category,cash_date) values($1,'test',$2,$3,$4,$5,$6)", [e.id,e.work_key,e.kind,e.amount,e.source_category,e.cash_date]);
  await migrate(db, "20261022160000_construction_qlik_indicators.sql");
  await migrate(db, "20261022183000_construction_expense_lookup.sql");
  assert.equal((await db.query<Record<string, unknown>>("select realized_total from construction_progress_summary where id=$1", [work])).rows[0].realized_total, null);
  await db.exec("insert into operational_publications(kind) values('paid'),('payable')");
  const sources = {paid:{at:new Date().toISOString(),status:"success"},payable:{at:new Date().toISOString(),status:"success"}};
  const monthly = monthlyConstructionExpenses(entries,["test|001","test|002"],sources);
  const result = (await db.query<Record<string, unknown>>("select * from construction_qlik_expense_summary where construction_id=$1", [work])).rows[0];
  assert.equal(Number(result.realized_total),monthly.paid);
  assert.equal(Number(result.realized_current_month),50);
  assert.equal(Number(result.payable_total),monthly.payable);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub:admin,role:"authenticated"})]);
  await db.exec("set role authenticated");
  const snapshot = (await db.query<Record<string, unknown>>("select * from management_construction_snapshot() where id=$1",[work])).rows[0];
  assert.equal(Number(snapshot.realized_total),50);
  assert.equal(Number(snapshot.financial_progress),50);
  assert.equal(Number((await db.query<Record<string, unknown>>("select realized_total from construction_progress_summary where id=$1",[work])).rows[0].realized_total),50);
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub:outsider,role:"authenticated"})]);
  await db.exec("set role authenticated");
  assert.equal((await db.query("select * from construction_qlik_expense_summary")).rows.length,0);
  await assert.rejects(() => db.query("select * from management_construction_snapshot()"), /indicator_area_access_required/);
});
