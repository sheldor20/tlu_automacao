import assert from "node:assert/strict";
import test from "node:test";
import { migrate, projectDatabase } from "./helpers/project-database.ts";

const leader = "11111111-1111-4111-8111-111111111111";
const participant = "22222222-2222-4222-8222-222222222222";
const admin = "33333333-3333-4333-8333-333333333333";

test("exclusão de assunto da RA remove a tarefa na mesma transação", async (t) => {
  const db = await projectDatabase();
  t.after(() => db.close());
  await migrate(db, "20260916175736_ra_edit_delete_definitions.sql");
  await db.query("insert into auth.users (id, email) values ($1, 'leader@example.test'), ($2, 'participant@example.test'), ($3, 'admin@example.test')", [leader, participant, admin]);
  await db.query("update public.profiles set is_admin = (user_id = $1), active = true", [admin]);
  await db.query("insert into public.profile_departments (user_id, department_slug) values ($1, 'pauta-ra'), ($1, 'projetos'), ($2, 'pauta-ra'), ($2, 'projetos')", [leader, participant]);
  await db.query("insert into public.profile_reporting_lines (leader_user_id, report_user_id) values ($1, $2)", [leader, participant]);
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: leader, role: "authenticated" })]);
  const { rows: [meeting] } = await db.query<{ id: string }>("insert into public.ra_meetings (title, scheduled_at, leader_user_id, status) values ('RA em execução', now(), $1, 'em_andamento') returning id", [leader]);
  await db.query("insert into public.ra_participants (meeting_id, user_id) values ($1, $2)", [meeting.id, participant]);
  const { rows: [section] } = await db.query<{ id: string }>("insert into public.ra_agenda_sections (meeting_id, title) values ($1, 'Tema macro') returning id", [meeting.id]);

  async function asUser<T>(userId: string, work: () => Promise<T>) {
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
    await db.exec("set role authenticated");
    try { return await work(); } finally { await db.exec("reset role"); }
  }
  async function newItem(convert = true) {
    return asUser(leader, async () => {
      const { rows: [item] } = await db.query<{ id: string }>("insert into public.ra_agenda_items (section_id, content) values ($1, 'Assunto de teste') returning id", [section.id]);
      const taskId = convert ? (await db.query<{ id: string }>("select public.convert_ra_item_to_task($1, $2, current_date) as id", [item.id, participant])).rows[0].id : null;
      return { id: item.id, taskId };
    });
  }
  async function exists(table: "ra_agenda_items" | "project_tasks", id: string | null) {
    return (await db.query(`select id from public.${table} where id = $1`, [id])).rows.length === 1;
  }

  const legacy = await newItem();
  await t.test("reproduz a tarefa órfã antes da correção", async () => {
    await asUser(leader, () => db.query("delete from public.ra_agenda_items where id = $1", [legacy.id]));
    assert.equal(await exists("ra_agenda_items", legacy.id), false);
    assert.equal(await exists("project_tasks", legacy.taskId), true);
  });
  await migrate(db, "20260916180941_ra_delete_item_task.sql");

  await t.test("líder remove assunto, definições, tarefa, responsáveis, subtarefas e alertas", async () => {
    const item = await newItem();
    await asUser(leader, () => db.query("select public.record_ra_decision($1, 'Definição do assunto')", [item.id]));
    const { rows: [subtask] } = await db.query<{ id: string }>("insert into public.project_subtasks (task_id, title) values ($1, 'Subtarefa') returning id", [item.taskId]);
    await db.query("insert into public.project_subtask_assignees (subtask_id, user_id, assignee_name, assignee_email) values ($1, $2, 'Participante', 'participant@example.test')", [subtask.id, participant]);
    assert.equal((await db.query("select id from public.user_notifications where entity_id = $1", [item.taskId])).rows.length, 1);
    assert.equal((await db.query("select user_id from public.project_task_assignees where task_id = $1", [item.taskId])).rows.length, 1);
    await asUser(leader, async () => {
      assert.equal((await db.query("delete from public.ra_agenda_items where id = $1 returning id", [item.id])).affectedRows, 1);
    });
    assert.equal(await exists("ra_agenda_items", item.id), false);
    assert.equal(await exists("project_tasks", item.taskId), false);
    for (const [table, key, id] of [
      ["ra_decisions", "item_id", item.id],
      ["project_task_assignees", "task_id", item.taskId],
      ["project_subtasks", "task_id", item.taskId],
      ["project_subtask_assignees", "subtask_id", subtask.id],
      ["user_notifications", "entity_id", item.taskId],
    ]) assert.equal((await db.query(`select 1 from public.${table} where ${key} = $1`, [id])).rows.length, 0, table!);
    assert.equal(await exists("project_tasks", legacy.taskId), true);
  });

  await t.test("sem permissão da tarefa, mantém assunto, definição e tarefa", async () => {
    const item = await newItem();
    await asUser(leader, () => db.query("select public.record_ra_decision($1, 'Não deve ser apagada')", [item.id]));
    await db.query("delete from public.profile_departments where user_id = $1 and department_slug = 'projetos'", [leader]);
    await asUser(leader, () => assert.rejects(() => db.query("delete from public.ra_agenda_items where id = $1", [item.id]), /permissão para excluir a tarefa vinculada/));
    assert.equal(await exists("ra_agenda_items", item.id), true);
    assert.equal(await exists("project_tasks", item.taskId), true);
    assert.equal((await db.query("select id from public.ra_decisions where item_id = $1", [item.id])).rows.length, 1);
    await db.query("insert into public.profile_departments (user_id, department_slug) values ($1, 'projetos')", [leader]);
  });

  await t.test("participante não pode apagar assunto nem tarefa pela RA", async () => {
    const item = await newItem();
    await asUser(participant, async () => {
      assert.equal((await db.query("delete from public.ra_agenda_items where id = $1 returning id", [item.id])).affectedRows, 0);
    });
    assert.equal(await exists("ra_agenda_items", item.id), true);
    assert.equal(await exists("project_tasks", item.taskId), true);
  });

  await t.test("assunto sem tarefa e tarefa já excluída continuam removíveis", async () => {
    const item = await newItem(false);
    const priorTask = await newItem();
    await asUser(admin, async () => {
      await db.query("delete from public.project_tasks where id = $1", [priorTask.taskId]);
      assert.equal((await db.query("delete from public.ra_agenda_items where id in ($1, $2) returning id", [item.id, priorTask.id])).affectedRows, 2);
    });
    assert.equal(await exists("project_tasks", legacy.taskId), true);
  });

  await t.test("excluir uma definição mantém o assunto e sua tarefa", async () => {
    const item = await newItem();
    await asUser(leader, async () => {
      await db.query("select public.record_ra_decision($1, 'Definição independente')", [item.id]);
      await db.query("delete from public.ra_decisions where item_id = $1", [item.id]);
    });
    assert.equal(await exists("ra_agenda_items", item.id), true);
    assert.equal(await exists("project_tasks", item.taskId), true);
  });

  await t.test("nova conversão não duplica a tarefa e assunto excluído não gera tarefa", async () => {
    const item = await newItem();
    await asUser(leader, async () => {
      const { rows } = await db.query<{ id: string }>("select public.convert_ra_item_to_task($1, $2, current_date) as id", [item.id, participant]);
      assert.equal(rows[0].id, item.taskId);
      await db.query("delete from public.ra_agenda_items where id = $1", [item.id]);
      const before = (await db.query("select id from public.project_tasks")).rows;
      await assert.rejects(() => db.query("select public.convert_ra_item_to_task($1, $2, current_date)", [item.id, participant]), /ra_manage_required/);
      assert.deepEqual((await db.query("select id from public.project_tasks")).rows, before);
    });
  });

  await t.test("administrador exclui também tarefas concluídas vinculadas ao assunto", async () => {
    const item = await newItem();
    await asUser(admin, async () => {
      await db.query("update public.project_tasks set status = 'concluida' where id = $1", [item.taskId]);
      await db.query("delete from public.ra_agenda_items where id = $1", [item.id]);
    });
    assert.equal(await exists("project_tasks", item.taskId), false);
  });

  await t.test("RA encerrada ou arquivada protege os assuntos de telas desatualizadas", async () => {
    const item = await newItem();
    await db.query("update public.ra_meetings set status = 'encerrada' where id = $1", [meeting.id]);
    await asUser(leader, () => assert.rejects(() => db.query("delete from public.ra_agenda_items where id = $1", [item.id]), /RA encerrada/));
    await db.query("update public.ra_meetings set status = 'em_andamento', archived_at = now() where id = $1", [meeting.id]);
    await asUser(admin, async () => {
      assert.equal((await db.query("delete from public.ra_agenda_items where id = $1 returning id", [item.id])).affectedRows, 0);
    });
    assert.equal(await exists("ra_agenda_items", item.id), true);
    assert.equal(await exists("project_tasks", item.taskId), true);
    await db.query("update public.ra_meetings set archived_at = null where id = $1", [meeting.id]);
  });

  await t.test("excluir a RA inteira preserva as tarefas conforme o contrato existente", async () => {
    const tasks = (await db.query("select id from public.project_tasks order by id")).rows;
    await db.query("update public.ra_meetings set status = 'encerrada' where id = $1", [meeting.id]);
    await asUser(leader, async () => {
      assert.equal((await db.query("delete from public.ra_meetings where id = $1 returning id", [meeting.id])).affectedRows, 1);
    });
    assert.equal((await db.query("select id from public.ra_agenda_items")).rows.length, 0);
    assert.deepEqual((await db.query("select id from public.project_tasks order by id")).rows, tasks);
  });
});
