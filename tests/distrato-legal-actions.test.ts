import assert from "node:assert/strict";
import test from "node:test";
import { legalActionUpdate } from "../lib/distrato-legal-actions.ts";
import { migrate, projectDatabase } from "./helpers/project-database.ts";

test("ação judicial: protocolo único, dados fixos e revisão concorrente", async (t) => {
  const db = await projectDatabase();
  t.after(() => db.close());
  await migrate(db, "20261106150746_distrato_legal_actions.sql");
  await migrate(db, "20261106171053_distrato_legal_action_editable_fields.sql");

  const insert = `insert into public.distrato_legal_actions (protocol, details) values ($1, '{"nature":"Fiscal"}') returning id, revision, status`;
  await db.exec("set role service_role");
  const { rows: [created] } = await db.query<{ id: string; revision: string; status: string }>(insert, ["01234-56.2026"]);
  assert.equal(created.status, "EM TRÂMITE");
  await assert.rejects(() => db.query(insert, ["01234562026"]), /duplicate key/);

  const next = legalActionUpdate.parse({ ...created, status: "ARQUIVADO", observations: "Andamento registrado.", protocol: "999",
    details: { block: "001", lot: "12-A", claimAmount: "1234.56", archivedOn: "2026-11-06" } });
  assert.equal("protocol" in next, false);
  assert.throws(() => legalActionUpdate.parse({ ...next, details: { nature: "Outra" } }));
  assert.throws(() => legalActionUpdate.parse({ ...next, details: { archivedOn: "2026-02-30" } }));
  assert.throws(() => legalActionUpdate.parse({ ...next, details: { claimAmount: "1.234,56" } }));
  const update = `update public.distrato_legal_actions
    set status = $1, observations = $2, revision = gen_random_uuid(), details = details || $5::jsonb
    where id = $3 and revision = $4 returning protocol, status, observations, details`;
  const params = [next.status, next.observations, next.id, next.revision, JSON.stringify(next.details)];
  assert.deepEqual((await db.query(update, params)).rows, [
    { protocol: "01234-56.2026", status: "ARQUIVADO", observations: "Andamento registrado.", details: { nature: "Fiscal", ...next.details } },
  ]);
  assert.equal((await db.query(update, params)).rows.length, 0);
  await assert.rejects(() => db.exec("update public.distrato_legal_actions set details = '{}'"), /Only quadra/);

  for (const role of ["anon", "authenticated"]) {
    await db.exec(`reset role; set role ${role}`);
    await assert.rejects(() => db.exec("select * from public.distrato_legal_actions"), /permission denied/);
  }
});
