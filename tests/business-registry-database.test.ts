import assert from "node:assert/strict";
import test from "node:test";
import { migrate, projectDatabase } from "./helpers/project-database.ts";

test("documentos da matrícula são privados e conservam os campos existentes da visão", async (t) => {
  const db = await projectDatabase(); t.after(() => db.close());
  const before = await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='business_operational_summary' order by ordinal_position");
  await migrate(db, "20260921140358_business_registry_report.sql");
  const after = await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='business_operational_summary' order by ordinal_position");
  assert.deepEqual(after.rows.slice(0, before.rows.length), before.rows);
  assert.deepEqual(after.rows.slice(-4).map((row) => row.column_name), ["registration_file_path", "registration_file_name", "area_image_path", "area_image_name"]);
  const bucket = await db.query("select public,file_size_limit from storage.buckets where id='business-documents'");
  assert.deepEqual(bucket.rows, [{ public: false, file_size_limit: 20971520 }]);
  await db.exec("grant select,insert,delete on storage.objects to authenticated");
  const allowed = "11111111-1111-4111-8111-111111111111", outsider = "22222222-2222-4222-8222-222222222222";
  await db.query("insert into auth.users(id,email) values ($1,'allowed@example.test'),($2,'outsider@example.test')", [allowed, outsider]);
  await db.query("insert into public.profile_departments(user_id,department_slug) values ($1,'novos-negocios')", [allowed]);
  const businessId = "33333333-3333-4333-8333-333333333333";
  const path = `${businessId}/matricula/44444444-4444-4444-8444-444444444444.pdf`;
  async function asUser(id: string, fn: () => Promise<void>) {
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, role: "authenticated" })]);
    await db.exec("set role authenticated");
    try { await fn(); } finally { await db.exec("reset role"); }
  }
  await asUser(outsider, async () => {
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name,owner) values ('business-documents',$1,$2)", [path, outsider]), /row-level security/);
  });
  await asUser(allowed, async () => {
    await db.query("insert into storage.objects(bucket_id,name,owner) values ('business-documents',$1,$2)", [path, allowed]);
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name,owner) values ('business-documents','invalid.pdf',$1)", [allowed]), /row-level security/);
  });
  await asUser(outsider, async () => {
    assert.equal((await db.query("select * from storage.objects where bucket_id='business-documents'")).rows.length, 0);
    assert.equal((await db.query("delete from storage.objects where bucket_id='business-documents' returning id")).rows.length, 0);
  });
  await asUser(allowed, async () => {
    assert.equal((await db.query("delete from storage.objects where bucket_id='business-documents' returning id")).rows.length, 1);
  });
  const project = "55555555-5555-4555-8555-555555555555";
  await db.query("insert into public.projects(id,name,start_date,owner_name,owner_email,objective,created_by,owner_user_id) values ($1,'Projeto de teste',current_date,'Teste','allowed@example.test','Teste matrícula',$2,$2)", [project, allowed]);
  await db.query("insert into public.businesses(id,name,start_date,address,city,state,project_id,created_by) values ($1,'Área teste',current_date,'Avenida teste','Rio Verde','GO',$2,$3)", [businessId, project, allowed]);
  await asUser(allowed, async () => {
    await assert.rejects(db.query("update public.businesses set registration_file_path=$1,registration_file_name='matricula.pdf' where id=$2", [path, businessId]), /businesses_registration_document/);
    await db.query("update public.businesses set property_registration='112.755',registration_file_path=$1,registration_file_name='matricula.pdf' where id=$2", [path, businessId]);
    const record = await db.query("select property_registration,registration_file_path from public.business_operational_summary where id=$1", [businessId]);
    assert.deepEqual(record.rows, [{ property_registration: "112.755", registration_file_path: path }]);
    await assert.rejects(db.query("update public.businesses set registration_file_path=$1 where id=$2", [path.replace(businessId, outsider), businessId]), /businesses_registration_document/);
  });
  await asUser(outsider, async () => {
    assert.equal((await db.query("select * from public.business_operational_summary where id=$1", [businessId])).rows.length, 0);
  });
});
