import assert from "node:assert/strict";
import test from "node:test";
import { taskFileType, TASK_FILE_MAX_BYTES } from "../lib/task-activity.ts";
import { migrate, projectDatabase } from "./helpers/project-database.ts";

test("valida formato, arquivo vazio e limite antes do envio", () => {
  assert.equal(taskFileType({ name: "Planilha.XLSX", size: TASK_FILE_MAX_BYTES }).contentType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.throws(() => taskFileType({ name: "grande.pdf", size: TASK_FILE_MAX_BYTES + 1 }), /20 MB/);
  assert.throws(() => taskFileType({ name: "vazio.txt", size: 0 }), /vazio/);
  assert.throws(() => taskFileType({ name: "pagina.html", size: 50 }), /formato/);
});

test("comentários e arquivos respeitam acesso, autoria e histórico imutável", async (t) => {
  const db = await projectDatabase();
  t.after(() => db.close());
  await db.exec("alter table storage.objects add column owner_id text; grant select, insert, delete on storage.objects to authenticated;");
  await migrate(db, "20260916183159_task_files_comments_activity.sql");
  const owner = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  await db.query("insert into auth.users(id,email) values ($1,'task-owner@example.test'),($2,'task-other@example.test')", [owner, other]);
  await db.query("update public.profiles set active = true, full_name = 'Pessoa responsável'");
  await db.query("insert into public.profile_departments(user_id,department_slug) values($1,'projetos'),($2,'projetos')", [owner, other]);
  await db.query("insert into public.profile_project_permissions(user_id,access_scope) values($1,'assigned_tasks'),($2,'assigned_tasks')", [owner, other]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, role: "authenticated" })]);
  const { rows: [task] } = await db.query<{ id: string }>("insert into public.project_tasks(title,category,assignee_user_id,assignee_name,assignee_email,due_date) values('Tarefa de teste','operational',$1,'Pessoa responsável','task-owner@example.test',current_date) returning id", [owner]);
  async function asUser<T>(id: string, work: () => Promise<T>) {
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, role: "authenticated" })]);
    await db.exec("set role authenticated");
    try { return await work(); } finally { await db.exec("reset role"); }
  }
  await t.test("salva comentário com autor real e horário do servidor", async () => {
    await asUser(owner, async () => {
      const { rows: [item] } = await db.query<{ author_id: string; author_name: string; body: string; created_at: Date }>("insert into public.project_task_activity(task_id,kind,body,author_id,author_name,created_at) values($1,'comment','  Registro de andamento  ',$2,'Autor falso','2000-01-01') returning *", [task.id, other]);
      assert.equal(item.author_id, owner); assert.equal(item.author_name, "Pessoa responsável"); assert.equal(item.body, "Registro de andamento"); assert.ok(new Date(item.created_at).getFullYear() > 2000);
      await assert.rejects(() => db.query("insert into public.project_task_activity(task_id,kind,body) values($1,'comment','   ')", [task.id]), /task_activity_content_valid/);
      await assert.rejects(() => db.query("update public.project_task_activity set body='Alterado'"), /permission denied/);
      await assert.rejects(() => db.query("delete from public.project_task_activity"), /permission denied/);
    });
  });
  await t.test("outro responsável não lê nem registra na tarefa alheia", async () => {
    await asUser(other, async () => {
      assert.equal((await db.query("select * from public.project_task_activity")).rows.length, 0);
      await assert.rejects(() => db.query("insert into public.project_task_activity(task_id,kind,body) values($1,'comment','Sem acesso')", [task.id]), /row-level security/);
      const { rows: [row] } = await db.query<{ permissions: { files: boolean; comments: boolean } }>("select public.project_task_activity_permissions($1) as permissions", [task.id]);
      assert.deepEqual(row.permissions, { files: false, comments: false });
    });
  });
  await t.test("anexo exige upload real, usa metadados do storage e não pode ser sobrescrito ou apagado", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const path = `${task.id}/files/${id}.pdf`;
    await asUser(owner, async () => {
      await assert.rejects(() => db.query("insert into public.project_task_activity(id,task_id,kind,file_path,file_name) values($1,$2,'file',$3,'Relatório.pdf')", [id, task.id, path]), /Envie o arquivo/);
      await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('task-files',$1,$2,'{\"size\":123,\"mimetype\":\"application/pdf\"}')", [path, owner]);
      const { rows: [item] } = await db.query<{ file_size: number; content_type: string }>("insert into public.project_task_activity(id,task_id,kind,file_path,file_name,file_size,content_type) values($1,$2,'file',$3,'Relatório.pdf',999,'image/jpeg') returning *", [id, task.id, path]);
      assert.equal(Number(item.file_size), 123); assert.equal(item.content_type, "application/pdf");
      assert.equal((await db.query("delete from storage.objects where name=$1 returning id", [path])).affectedRows, 0);
    });
    await asUser(other, async () => {
      assert.equal((await db.query("select * from storage.objects where name=$1", [path])).rows.length, 0);
      await assert.rejects(() => db.query("insert into storage.objects(bucket_id,name,owner_id) values('task-files',$1,$2)", [`${task.id}/files/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf`, other]), /row-level security/);
    });
  });
  await t.test("bloqueios de arquivos e atualizações valem na API e no storage", async () => {
    await db.query("update public.profile_project_permissions set allow_files=false,allow_updates=false where user_id=$1", [owner]);
    await asUser(owner, async () => {
      assert.equal((await db.query("select * from public.project_task_activity")).rows.length, 0);
      assert.equal((await db.query("select * from storage.objects where bucket_id='task-files'")).rows.length, 0);
      await assert.rejects(() => db.query("insert into public.project_task_activity(task_id,kind,body) values($1,'comment','Bloqueado')", [task.id]), /row-level security/);
    });
  });
  await t.test("visitante não acessa os registros", async () => {
    await db.exec("set role anon");
    try { await assert.rejects(() => db.query("select * from public.project_task_activity"), /permission denied/); }
    finally { await db.exec("reset role"); }
  });
});
