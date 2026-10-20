import test from "node:test";
import assert from "node:assert/strict";
import { migrate, projectDatabase } from "./helpers/project-database.ts";

test("contratos: permissões independentes, três status, concorrência, histórico e acesso público", async t => {
  const db = await projectDatabase(); t.after(() => db.close());
  await migrate(db, "20261020114323_contract_requests.sql");
  const admin = "11111111-1111-4111-8111-111111111111", owner = "22222222-2222-4222-8222-222222222222", manager = "33333333-3333-4333-8333-333333333333", other = "44444444-4444-4444-8444-444444444444";
  for (const id of [admin, owner, manager, other]) await db.query("insert into auth.users(id,email) values($1,$2)", [id, `${id}@example.test`]);
  await db.query("update profiles set is_admin=(user_id=$1)", [admin]);
  await db.query("insert into profile_contract_permissions(user_id,can_manage) values($1,true)", [manager]);
  const row = (await db.query<{ id: string }>(`insert into contract_requests(submission_id,submission_digest,tracking_token_hash,requester_user_id,requester_name,requester_email,details)
    values(gen_random_uuid(),'digest',repeat('a',64),$1,'Solicitante','test@example.test','{"type":"rental","title":"Teste"}') returning id`, [owner])).rows[0];
  const update = (actor: string | null, version: number, status: string | null, details: object | null = null, message = "", token: string | null = null) => db.query<{ result: { version: number; status: string } }>("select update_contract_request($1,$2,$3,$4,$5,$6,$7) result", [row.id, actor, token, version, status, details, message]);
  await assert.rejects(() => update(other, 1, "finalizing"), /contract_forbidden/);
  await assert.rejects(() => update(owner, 1, "finalizing"), /contract_forbidden/);
  await assert.rejects(() => update(owner, 1, null, { type: "rental" }), /contract_edit_forbidden/);
  await assert.rejects(() => update(manager, 1, "paid"), /contract_invalid_status/);
  await assert.rejects(() => update(manager, 1, "missing_information"), /contract_message_required/);
  let changed = (await update(manager, 1, "missing_information", null, "Informe a matrícula.")).rows[0].result;
  assert.equal(changed.status, "missing_information"); assert.equal(changed.version, 2);
  await assert.rejects(() => update(admin, 1, "finalizing"), /contract_conflict/);
  changed = (await update(owner, 2, null, { type: "rental", property_registration: "123" }, "Matrícula enviada.")).rows[0].result;
  assert.equal(changed.status, "in_progress");
  await update(manager, 3, "finalizing");
  await db.query("update profile_contract_permissions set can_manage=false where user_id=$1", [manager]);
  await assert.rejects(() => update(manager, 4, "in_progress"), /contract_forbidden/);
  await db.query("update profiles set active=false where user_id=$1", [owner]);
  await assert.rejects(() => update(owner, 4, null, null, "Olá"), /contract_forbidden/);
  await update(admin, 4, "in_progress");
  assert.equal((await db.query("select * from contract_request_events where request_id=$1", [row.id])).rows.length, 5);
  const event = (await db.query<{ message: string }>("select message from contract_request_events where request_id=$1 and kind='status' order by created_at limit 1", [row.id])).rows[0];
  assert.equal(event.message, "Informe a matrícula.");
  for (const role of ["anon", "authenticated"]) {
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, role })]);
    await db.exec(`set role ${role}`);
    try {
      for (const table of ["contract_requests", "contract_request_events"]) {
        await assert.rejects(() => db.exec(`select * from ${table}`), /permission denied/);
        await assert.rejects(() => db.exec(`update ${table} set status='finalizing'`), /permission denied/);
      }
      await assert.rejects(() => update(admin, 5, "finalizing"), /permission denied/);
      await assert.rejects(() => db.query("insert into profile_contract_permissions(user_id,can_manage) values($1,true)", [other]), /permission denied/);
    } finally { await db.exec("reset role"); }
  }
  await db.query("update contract_requests set requester_user_id=null where id=$1", [row.id]);
  await assert.rejects(() => update(null, 5, null, null, "Oi", "wrong"), /contract_forbidden/);
  const publicUpdate = (await update(null, 5, null, null, "Mensagem pública", "a".repeat(64))).rows[0].result;
  assert.equal(publicUpdate.version, 6); assert.equal("tracking_token_hash" in publicUpdate, false);
  await assert.rejects(() => update(null, 6, "finalizing", null, "", "a".repeat(64)), /contract_forbidden/);
  await db.exec("set role service_role");
  try { assert.equal((await db.query("select id from contract_requests where id=$1", [row.id])).rows.length, 1); }
  finally { await db.exec("reset role"); }
});
