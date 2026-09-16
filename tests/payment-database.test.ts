import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { migrate, projectDatabase } from "./helpers/project-database.ts";

test("payment lifecycle includes protected finalization and an atomic email notification", async (t) => {
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
  ]) await migrate(db, migration);
  await db.exec(`
    insert into auth.users(id,email) values
      ('11111111-1111-4111-8111-111111111111','admin@example.test'),
      ('22222222-2222-4222-8222-222222222222','owner@example.test'),
      ('33333333-3333-4333-8333-333333333333','other@example.test');
    update public.profiles set active=true,
      is_admin=(user_id='11111111-1111-4111-8111-111111111111');
    with snapshot as (
      insert into public.enterprise_performance_snapshots(as_of) values(current_date) returning id
    ) insert into public.enterprise_performance_companies(snapshot_id,company_key,name)
      select id,'TEST','Empresa de teste' from snapshot;
  `);
  await db.exec(readFileSync(new URL("./payment-database.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("./payment-materials-database.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("./payment-edit-delete-database.sql", import.meta.url), "utf8"));
  assert.equal((await db.query("select id from public.payment_requests")).rows.length, 0);
  assert.equal((await db.query("select id from public.payment_email_outbox")).rows.length, 0);
});
