import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { creationMigration, migrate, projectDatabase } from "./helpers/project-database.ts";

const directory = new URL("../supabase/migrations/", import.meta.url);
const files = readdirSync(directory).filter(name => name.endsWith(".sql")).sort();

test("migration catalog has unique versions and retains required historical SQL", () => {
  assert.equal(new Set(files.map(name => name.split("_")[0])).size, files.length);
  assert.ok(files.every(name => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)));
  for (const filename of [
    "20260918004459_club_tlu_v2_password_accounts.sql",
    "20260918004508_club_tlu_v2_remove_magic_invite.sql",
    "20260930142104_fix_standalone_task_delegation.sql",
    "20261022182948_collection_daily_financial_summary.sql",
    "20261023130112_restrict_finance_indicator_sync_execute.sql",
    "20261023205255_ra_definition_tasks.sql",
    "20261027124719_fix_rental_contract_upload_path.sql",
    "20261027165320_manual_rental_management.sql",
  ]) assert.ok(files.includes(filename), filename);
});

test("reconciled migrations replay on isolated PostgreSQL and preserve recovered access restrictions", async t => {
  const db = await projectDatabase();
  t.after(() => db.close());
  // Supabase platform fixtures only; no customer data or remote connection.
  // PGlite has no pg_cron worker. Its schedule is recorded, never executed.
  await db.exec(`
    alter table auth.users add column email_confirmed_at timestamptz, add column banned_until timestamptz;
    alter table storage.objects add column owner_id text;
    create schema cron;
    create table cron.job(jobid bigint generated always as identity, jobname text, schedule text, command text);
    create function cron.schedule(text,text,text) returns bigint language sql as $$
      insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid
    $$;
  `);
  for (const filename of files.filter(name => name >= creationMigration)) {
    try {
      if (filename === "20261022182948_collection_daily_financial_summary.sql") {
        const sql = readFileSync(new URL(filename, directory), "utf8");
        assert.equal((sql.match(/create extension if not exists pg_cron;/g) || []).length, 1);
        await db.exec(sql.replace("create extension if not exists pg_cron;", "-- pg_cron platform fixture above"));
      } else await migrate(db, filename);
    } catch (cause) { throw new Error(`Migration failed: ${filename}`, {cause}); }
  }
  const result = await db.query<{removed: boolean; restricted: boolean; summary: boolean; rentalPolicy: boolean}>(`
    select to_regprocedure('public.club_invite_target(uuid,uuid)') is null as removed,
      not has_function_privilege('anon','public.sync_qlik_finance_indicators(jsonb,text,date)','execute') as restricted,
      (select relrowsecurity from pg_class where oid='public.collection_financial_summary'::regclass) as summary,
      exists(select 1 from pg_policies where tablename='rentals' and policyname='rentals_insert') as "rentalPolicy"
  `);
  assert.deepEqual(result.rows[0], {removed:true, restricted:true, summary:true, rentalPolicy:true});
  const jobs = await db.query("select jobname, schedule, command from cron.job");
  assert.deepEqual(jobs.rows, [{jobname:"collection-financial-summary-daily", schedule:"15 10 * * *", command:"select private.refresh_collection_financial_summary()"}]);
  const actor = await db.query<{definition: string}>("select pg_get_functiondef('club_private.actor(uuid)'::regprocedure) as definition");
  assert.match(actor.rows[0].definition, /deleted_at is not null/);
});
