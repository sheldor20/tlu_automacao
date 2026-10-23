import test from "node:test";
import assert from "node:assert/strict";
import { migrate, projectDatabase } from "./helpers/project-database.ts";

test("recovery migration preserves history, artifacts, policies and table grants; CAS fences stale attempts", async (t) => {
  const db = await projectDatabase();
  t.after(() => db.close());
  await migrate(db, "20261022174252_accountability_beta.sql");
  await migrate(db, "20261022181701_accountability_artifacts.sql");
  await db.exec(
    "update accountability_dispatches set status='processing',pdf_path=id||'/book.pdf',excel_path=id||'/recebiveis.xlsx' where month=9",
  );
  const before = (
    await db.query(
      "select to_jsonb(d) as record from accountability_dispatches d order by id",
    )
  ).rows;
  const policies = (
    await db.query(
      "select * from pg_policies where tablename='accountability_dispatches' order by policyname",
    )
  ).rows;
  const grants = (
    await db.query(
      "select relacl,relrowsecurity from pg_class where oid='public.accountability_dispatches'::regclass",
    )
  ).rows;
  await migrate(db, "20261023114858_accountability_dispatch_recovery.sql");
  assert.deepEqual(
    (
      await db.query(
        "select to_jsonb(d)-'processing_token'-'processing_started_at'-'provider_attempted_at'-'email_snapshot' as record from accountability_dispatches d order by id",
      )
    ).rows,
    before,
  );
  assert.deepEqual(
    (
      await db.query(
        "select * from pg_policies where tablename='accountability_dispatches' order by policyname",
      )
    ).rows,
    policies,
  );
  assert.deepEqual(
    (
      await db.query(
        "select relacl,relrowsecurity from pg_class where oid='public.accountability_dispatches'::regclass",
      )
    ).rows,
    grants,
  );
  assert.equal(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from accountability_dispatches where processing_token is not null or provider_attempted_at is not null",
      )
    ).rows[0].n,
    0,
  );
  const record = (
    await db.query<{ id: string; updated_at: Date }>(
      "select id,updated_at from accountability_dispatches where status='historical' limit 1",
    )
  ).rows[0];
  const attempt1 = "11111111-1111-4111-8111-111111111111",
    attempt2 = "22222222-2222-4222-8222-222222222222";
  const claim =
    "update accountability_dispatches set status='processing',processing_token=$1,processing_started_at=now() where id=$2 and status='historical' and updated_at=$3 and provider_attempted_at is null and provider_id is null returning id";
  const results = await Promise.all(
    [attempt1, attempt2].map((token) =>
      db.query(claim, [token, record.id, record.updated_at]),
    ),
  );
  assert.equal(results.flatMap((r) => r.rows).length, 1);
  const token = (
    await db.query<{ processing_token: string }>(
      "select processing_token from accountability_dispatches where id=$1",
      [record.id],
    )
  ).rows[0].processing_token;
  await db.query(
    "update accountability_dispatches set status='failed' where id=$1",
    [record.id],
  );
  const arm = await db.query(
    "update accountability_dispatches set provider_attempted_at=now() where id=$1 and status='processing' and processing_token=$2 and provider_attempted_at is null returning id",
    [record.id, token],
  );
  assert.equal(arm.rows.length, 0);
  assert.equal(
    (
      await db.query<{ historical_sent: boolean }>(
        "select historical_sent from accountability_dispatches where id=$1",
        [record.id],
      )
    ).rows[0].historical_sent,
    true,
  );
  await db.exec("set role authenticated");
  await assert.rejects(
    db.query(
      "update accountability_dispatches set status='sent_beta' where id=$1",
      [record.id],
    ),
    /permission denied/,
  );
  await db.exec("reset role");
});
