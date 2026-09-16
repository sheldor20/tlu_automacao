import assert from "node:assert/strict";
import test from "node:test";
import { migrate, projectDatabase } from "./helpers/project-database.ts";

const leader = "11111111-1111-4111-8111-111111111111";
const participant = "22222222-2222-4222-8222-222222222222";
const admin = "33333333-3333-4333-8333-333333333333";
const migration = "20260916175736_ra_edit_delete_definitions.sql";

test("edição e exclusão de definições preservam a pauta e suas permissões", async (t) => {
  const db = await projectDatabase();
  t.after(() => db.close());
  await migrate(db, migration);
  await db.query("insert into auth.users (id, email) values ($1, 'leader@example.test'), ($2, 'participant@example.test'), ($3, 'admin@example.test')", [leader, participant, admin]);
  await db.query("update public.profiles set is_admin = (user_id = $1), active = true", [admin]);
  await db.query("insert into public.profile_departments (user_id, department_slug) values ($1, 'pauta-ra'), ($2, 'pauta-ra')", [leader, participant]);
  await db.query("insert into public.profile_reporting_lines (leader_user_id, report_user_id) values ($1, $2)", [leader, participant]);
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: leader, role: "authenticated" })]);
  const { rows: [meeting] } = await db.query<{ id: string }>("insert into public.ra_meetings (title, scheduled_at, leader_user_id, status) values ('RA em execução', now(), $1, 'em_andamento') returning id", [leader]);
  await db.query("insert into public.ra_participants (meeting_id, user_id) values ($1, $2)", [meeting.id, participant]);
  const { rows: [section] } = await db.query<{ id: string }>("insert into public.ra_agenda_sections (meeting_id, title) values ($1, 'Tema macro') returning id", [meeting.id]);
  const { rows: [item] } = await db.query<{ id: string }>("insert into public.ra_agenda_items (section_id, content) values ($1, 'Assunto preservado') returning id", [section.id]);

  async function asUser(userId: string, work: () => Promise<void>) {
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    await db.exec("set role authenticated");
    try { await work(); } finally { await db.exec("reset role"); }
  }
  async function record(text: string) {
    const { rows } = await db.query<{ id: string }>("select public.record_ra_decision($1, $2) as id", [item.id, text]);
    return rows[0].id;
  }
  async function summary() {
    return (await db.query<{ content: string; kind: string; decision_text: string | null; resolved_at: Date | null }>("select content, kind, decision_text, resolved_at from public.ra_agenda_items where id = $1", [item.id])).rows[0];
  }
  let first = "";
  let latest = "";
  await asUser(leader, async () => { first = await record("Primeira definição"); latest = await record("Segunda definição"); });
  await db.query("update public.ra_decisions set decided_at = '2026-09-16T12:00:00Z' where id = $1", [first]);
  await db.query("update public.ra_decisions set decided_at = '2026-09-16T13:00:00Z' where id = $1", [latest]);

  await t.test("edita a definição escolhida sem mudar autor, data, outras definições ou assunto", async () => {
    const original = (await db.query("select decided_at, decided_by from public.ra_decisions where id = $1", [first])).rows;
    await asUser(leader, async () => {
      assert.equal((await db.query("update public.ra_decisions set decision_text = 'Primeira revisada' where id = $1 returning id", [first])).affectedRows, 1);
      assert.equal((await summary()).decision_text, "Segunda definição");
      assert.equal((await summary()).content, "Assunto preservado");
    });
    assert.deepEqual((await db.query("select decided_at, decided_by from public.ra_decisions where id = $1", [first])).rows, original);
    assert.equal((await db.query<{ decision_text: string }>("select decision_text from public.ra_decisions where id = $1", [latest])).rows[0].decision_text, "Segunda definição");
  });
  await t.test("administrador pode editar a última definição e atualizar o resumo", async () => {
    await asUser(admin, async () => {
      await db.query("update public.ra_decisions set decision_text = 'Segunda revisada' where id = $1", [latest]);
      assert.equal((await summary()).decision_text, "Segunda revisada");
    });
  });
  await t.test("texto vazio ou acima do limite não altera a definição", async () => {
    await asUser(leader, async () => {
      for (const text of [" ", "a", "a".repeat(4001)]) {
        await assert.rejects(() => db.query("update public.ra_decisions set decision_text = $1 where id = $2", [text, latest]), /check constraint/);
      }
      assert.equal((await summary()).decision_text, "Segunda revisada");
    });
  });
  await t.test("participante pode consultar mas não editar nem excluir", async () => {
    await asUser(participant, async () => {
      assert.equal((await db.query("select id from public.ra_decisions where id = $1", [latest])).rows.length, 1);
      assert.equal((await db.query("update public.ra_decisions set decision_text = 'Proibido' where id = $1", [latest])).affectedRows, 0);
      assert.equal((await db.query("delete from public.ra_decisions where id = $1", [latest])).affectedRows, 0);
    });
  });
  await t.test("RA arquivada permanece somente para consulta", async () => {
    await db.query("update public.ra_meetings set archived_at = now() where id = $1", [meeting.id]);
    for (const user of [leader, admin]) await asUser(user, async () => {
      assert.equal((await db.query("update public.ra_decisions set decision_text = 'Proibido' where id = $1", [latest])).affectedRows, 0);
      assert.equal((await db.query("delete from public.ra_decisions where id = $1", [latest])).affectedRows, 0);
    });
    await db.query("update public.ra_meetings set archived_at = null where id = $1", [meeting.id]);
  });
  await t.test("encerramento protege as definições e a ATA inclusive de telas desatualizadas", async () => {
    await db.query("update public.ra_meetings set status = 'encerrada' where id = $1", [meeting.id]);
    await asUser(leader, async () => {
      await assert.rejects(() => db.query("update public.ra_decisions set decision_text = 'Proibido' where id = $1", [latest]), /RA encerrada/);
      await assert.rejects(() => db.query("delete from public.ra_decisions where id = $1", [latest]), /RA encerrada/);
      assert.equal((await summary()).decision_text, "Segunda revisada");
    });
    await db.query("update public.ra_meetings set status = 'em_andamento' where id = $1", [meeting.id]);
  });
  await t.test("excluir a última definição mantém a anterior e recompõe o resumo", async () => {
    await asUser(leader, async () => {
      assert.equal((await db.query("delete from public.ra_decisions where id = $1 returning id", [latest])).affectedRows, 1);
      assert.equal((await summary()).decision_text, "Primeira revisada");
      assert.equal((await db.query("select id from public.ra_decisions where item_id = $1", [item.id])).rows.length, 1);
    });
  });
  await t.test("excluir todas as definições limpa o resumo e permite registrar outra", async () => {
    await asUser(leader, async () => {
      await db.query("delete from public.ra_decisions where id = $1", [first]);
      assert.deepEqual(await summary(), { content: "Assunto preservado", kind: "definicao", decision_text: null, resolved_at: null });
      latest = await record("Nova definição");
      assert.equal((await summary()).decision_text, "Nova definição");
    });
  });
  await t.test("excluir o assunto ainda remove suas definições em cascata", async () => {
    await asUser(leader, async () => {
      await db.query("delete from public.ra_agenda_items where id = $1", [item.id]);
      assert.equal((await db.query("select id from public.ra_decisions where id = $1", [latest])).rows.length, 0);
    });
  });
  await t.test("excluir uma RA encerrada ainda remove suas definições em cascata", async () => {
    const { rows: [otherItem] } = await db.query<{ id: string }>("insert into public.ra_agenda_items (section_id, content) values ($1, 'Outro assunto') returning id", [section.id]);
    await asUser(leader, async () => {
      await db.query("select public.record_ra_decision($1, 'Definição final')", [otherItem.id]);
      await db.query("update public.ra_meetings set status = 'encerrada' where id = $1", [meeting.id]);
      assert.equal((await db.query("delete from public.ra_meetings where id = $1 returning id", [meeting.id])).affectedRows, 1);
    });
    assert.equal((await db.query("select id from public.ra_decisions where meeting_id = $1", [meeting.id])).rows.length, 0);
  });
});
