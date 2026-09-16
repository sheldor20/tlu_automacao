import assert from "node:assert/strict";
import test from "node:test";
import { migrate, projectDatabase } from "./helpers/project-database.ts";
import type { PerformanceSnapshot } from "../lib/enterprise-performance.ts";

test("performance: autorização, consolidação e substituição atômica da carga", async (t) => {
  const db = await projectDatabase();
  t.after(() => db.close());
  await migrate(db, "20260916132107_enterprise_performance.sql");
  const allowed = "11111111-1111-4111-8111-111111111111", denied = "22222222-2222-4222-8222-222222222222";
  await db.query("insert into auth.users(id,email) values ($1,'performance@example.test'),($2,'denied@example.test')", [allowed, denied]);
  await db.query("insert into public.profile_departments(user_id,department_slug) values ($1,'novos-negocios')", [allowed]);
  const companies = [{ company_key: "A", name: "Empresa A" }, { company_key: "B", name: "Empresa B" }];
  const flows = [{ company_key: "A", cash_date: "2025-01-01", kind: "paid", amount: 100 }, { company_key: "A", cash_date: "2027-01-01", kind: "receivable", amount: 200 }, { company_key: "B", cash_date: "2027-01-01", kind: "receivable", amount: 990 }];
  const write = (items = flows) => db.query("select public.sync_enterprise_performance('2026-09-16',$1::jsonb,$2::jsonb,'{}'::jsonb)", [JSON.stringify(companies), JSON.stringify(items)]);
  async function asRole(role: string, id: string | null, work: () => Promise<void>) {
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, role })]);
    await db.exec(`set role ${role}`);
    try { await work(); } finally { await db.exec("reset role"); }
  }
  const read = async (company: string | null = null) => (await db.query<{ result: PerformanceSnapshot }>("select public.enterprise_performance_snapshot($1) as result", [company])).rows[0].result;

  await t.test("sem carga retorna ausência explícita, sem demonstração", async () => {
    await asRole("authenticated", allowed, async () => {
      const value = await read(); assert.equal(value.synchronized_at, null); assert.deepEqual(value.rows, []); assert.deepEqual(value.companies, []);
    });
    assert.equal((await db.query<{ active: boolean }>("select active from public.data_connections where slug='qlik-enterprise-performance'")).rows[0].active, false);
  });
  await asRole("service_role", null, async () => { await write(); });

  await t.test("somente usuários da área leem dados e nenhum cliente pode escrever", async () => {
    await asRole("anon", null, async () => { await assert.rejects(read, /permission denied/); await assert.rejects(write, /permission denied/); });
    await asRole("authenticated", denied, async () => {
      await assert.rejects(read, /department_access_required/);
      assert.deepEqual((await db.query("select * from public.enterprise_performance_flows")).rows, []);
    });
    await asRole("authenticated", allowed, async () => {
      await assert.rejects(write, /permission denied/);
      await assert.rejects(() => db.query("delete from public.enterprise_performance_flows"), /permission denied/);
    });
  });
  await t.test("filtro lê uma empresa e Geral soma por data", async () => {
    await asRole("authenticated", allowed, async () => {
      assert.equal((await read("A")).rows[1].receivable, 200);
      assert.equal((await read()).rows[1].receivable, 1190);
      assert.equal((await read("A")).companies.length, 2);
      await assert.rejects(() => read("inexistente"), /company_not_found/);
    });
  });
  await t.test("carga inválida reverte tudo e mantém o snapshot anterior", async () => {
    const before = (await db.query("select count(*) from public.enterprise_performance_snapshots")).rows;
    await asRole("service_role", null, async () => {
      await assert.rejects(() => write([...flows, flows[0]]), /duplicate key/);
      await assert.rejects(() => write([{ ...flows[0], company_key: "desconhecida" }]), /foreign key/);
      await assert.rejects(() => db.query("select public.sync_enterprise_performance('2026-09-16',null,'[]','{}')"), /invalid_performance_snapshot/);
    });
    assert.deepEqual((await db.query("select count(*) from public.enterprise_performance_snapshots")).rows, before);
  });
  await t.test("nova carga é publicada sem somar o snapshot anterior", async () => {
    await asRole("service_role", null, async () => { await write([{ ...flows[0], amount: 80 }]); });
    await asRole("authenticated", allowed, async () => { const value = await read(); assert.equal(value.rows.length, 1); assert.equal(value.rows[0].paid, 80); });
    await db.query("update public.profiles set active=false where user_id=$1", [allowed]);
    await asRole("authenticated", allowed, async () => { await assert.rejects(read, /department_access_required/); });
  });
});
