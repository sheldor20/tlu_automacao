import assert from "node:assert/strict";
import test from "node:test";
import { migrate, projectDatabase } from "./helpers/project-database.ts";

test("distratos: leitura restrita, revogação imediata e histórico imutável", async (t) => {
  const db = await projectDatabase(); t.after(() => db.close());
  // Only the foreign-key target is a fixture; module DDL and access function
  // are the repository's actual migrations.
  await db.exec("create table public.client_contracts(id text primary key); insert into public.client_contracts(id) values('20|33|67');");
  await migrate(db, "20261023114330_distratos_module.sql");
  const user = "11111111-1111-4111-8111-111111111111", outsider = "22222222-2222-4222-8222-222222222222";
  await db.query("insert into auth.users(id,email) values($1,'user@example.test'),($2,'other@example.test')", [user, outsider]);
  await db.query("insert into public.profile_departments(user_id,department_slug) values($1,'distratos')", [user]);
  await db.query("insert into public.distrato_documents(id,created_by,contract_id,request_hash,input,unit,correction,calculation,term) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',$1,'20|33|67',repeat('a',64),'{}','{}','{}','{}','Minuta')", [user]);
  async function asUser(id: string, fn: () => Promise<void>) {
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, role: "authenticated" })]); await db.exec("set role authenticated");
    try { await fn(); } finally { await db.exec("reset role"); }
  }
  const count = async () => (await db.query("select id from public.distrato_documents")).rows.length;
  await asUser(user, async () => {
    assert.equal(await count(), 1);
    await assert.rejects(() => db.exec("update public.distrato_documents set term='alterado'"), /permission denied/);
    await assert.rejects(() => db.exec("delete from public.distrato_documents"), /permission denied/);
  });
  await asUser(outsider, async () => assert.equal(await count(), 0));
  await db.query("delete from public.profile_departments where user_id=$1 and department_slug='distratos'", [user]);
  await asUser(user, async () => assert.equal(await count(), 0));
  await db.exec("set role anon");
  try { await assert.rejects(() => count(), /permission denied/); } finally { await db.exec("reset role"); }
  await db.exec("set role service_role");
  try { await assert.rejects(() => db.exec("delete from public.distrato_documents"), /permission denied/); } finally { await db.exec("reset role"); }
});
