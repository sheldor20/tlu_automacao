import assert from "node:assert/strict";
import test from "node:test";
import { migrate, projectDatabase } from "./helpers/project-database.ts";
import type { DailyDigest } from "../lib/daily-digest.ts";

test("resumo diário: calendário, conteúdo individual, permissões e fila persistente", async t => {
  const db = await projectDatabase();
  t.after(() => db.close());
  for (const migration of ["20260916132107_enterprise_performance.sql", "20260916180238_payment_requests.sql", "20260916180335_payment_access_policies.sql", "20260916180924_payment_email_order.sql", "20260916192138_payment_finalized_status.sql", "20260916194044_payment_materials_optional_fields.sql", "20260916203112_payment_edit_delete.sql", "20260917121514_weekday_daily_digest.sql"]) await migrate(db, migration);
  const admin = "11111111-1111-4111-8111-111111111111", user = "22222222-2222-4222-8222-222222222222", other = "33333333-3333-4333-8333-333333333333", inactive = "44444444-4444-4444-8444-444444444444";
  for (const id of [admin, user, other, inactive]) await db.query("insert into auth.users(id,email) values($1,$2)", [id, `${id}@example.test`]);
  await db.query("update profiles set is_admin=(user_id=$1),active=(user_id<>$2)", [admin, inactive]);
  await db.exec("delete from profile_departments");
  await db.query("insert into profile_departments(user_id,department_slug) values($1,'projetos'),($2,'projetos')", [user, other]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: admin, role: "authenticated" })]);
  const ids: Record<string,string> = {};
  for (const [title, due, status, owner, category] of [
    ["Hoje", "2026-09-21", "a_fazer", user, "operational"],
    ["Vencida", "2026-09-18", "em_andamento", user, "operational"],
    ["Futura", "2026-09-22", "a_fazer", user, "operational"],
    ["Concluída", "2026-09-20", "concluida", user, "operational"],
    ["De outra pessoa", "2026-09-21", "a_fazer", other, "operational"],
    ["Sem departamento", "2026-09-21", "a_fazer", user, "governance"],
    ["Subtarefa minha", "2026-09-21", "a_fazer", other, "operational"],
  ]) ids[title] = (await db.query<{id:string}>("insert into project_tasks(title,due_date,status,assignee_user_id,assignee_name,assignee_email,created_by,category) values($1,$2,$3,$4,'Pessoa',$5,$6,$7) returning id", [title,due,status,owner,`${owner}@example.test`,admin,category])).rows[0].id;
  const subtask = (await db.query<{id:string}>("insert into project_subtasks(task_id,title,created_by) values($1,'Subtarefa',$2) returning id", [ids["Subtarefa minha"],admin])).rows[0].id;
  await db.query("insert into project_subtask_assignees(subtask_id,user_id,assignee_name,assignee_email) values($1,$2,'Pessoa',$3)", [subtask,user,`${user}@example.test`]);
  const request = (await db.query<{id:string}>(`insert into payment_requests(submission_id,submission_digest,requester_user_id,requester_name,requester_email,company_key,company_name,type,title,description,amount,due_date,beneficiary,details,source)
    values(gen_random_uuid(),'test',$1,'Pessoa','test@example.test','TEST','Empresa','service','Pagamento de teste','Descrição',100,'2026-09-30','{}','{}','internal') returning id`, [user])).rows[0].id;
  for (const date of ["2026-09-18T10:45:00Z", "2026-09-19T12:00:00Z", "2026-09-21T10:45:00Z", "2026-09-21T10:45:01Z"])
    await db.query("insert into payment_request_events(request_id,kind,status,actor_name,created_at) values($1,'status_changed','reviewing','Gestor',$2)", [request,date]);
  const enqueue = async (at: string) => (await db.query<{n:number}>("select enqueue_daily_digests($1) n", [at])).rows[0].n;
  const job = async (who: string, day = "2026-09-21") => (await db.query<{id:string}>("select id from daily_digest_outbox where user_id=$1 and digest_date=$2", [who,day])).rows[0].id;
  const content = async (who: string) => (await db.query<{d:DailyDigest}>("select daily_digest_content($1) d", [await job(who)])).rows[0].d;
  await t.test("sábado, domingo e antes das 7h45 não geram envio; todos os ativos entram uma única vez", async () => {
    assert.equal(await enqueue("2026-09-19T10:45:00Z"),0);
    assert.equal(await enqueue("2026-09-20T10:45:00Z"),0);
    assert.equal(await enqueue("2026-09-21T10:44:59Z"),0);
    assert.equal(await enqueue("2026-09-21T10:45:00Z"),3);
    assert.equal(await enqueue("2026-09-21T13:00:00Z"),0);
  });
  await t.test("seleciona tarefas próprias e subtarefas pendentes e inclui o fim de semana com limites exatos", async () => {
    const d = await content(user);
    assert.equal(d.today_count,2); assert.equal(d.overdue_count,1);
    assert.deepEqual(new Set(d.today.map(x=>x.title)),new Set(["Hoje","Subtarefa minha"]));
    assert.equal(d.payment_count,1); assert.equal(d.event_count,2);
    assert.equal((await content(other)).payment_count,0);
    assert.equal((await content(admin)).today_count,0);
    assert.equal((await content(admin)).payment_count,1);
    await db.query("update project_subtasks set completed_at=now() where id=$1", [subtask]);
    assert.equal((await content(user)).today_count,1);
    await db.query("insert into profile_payment_permissions(user_id,can_manage) values($1,true)", [other]);
    assert.equal((await content(other)).payment_count,1);
    await db.query("delete from profile_payment_permissions where user_id=$1", [other]);
  });
  await t.test("conteúdo fica inacessível após desativação, troca de email ou revogação de departamento", async () => {
    const id = await job(user);
    await db.query("update daily_digest_outbox set content=daily_digest_content(id),expires_at=greatest(expires_at,now()+interval '1 day') where id=$1",[id]);
    const allowed = async () => (await db.query<{ok:boolean}>("select daily_digest_authorized($1) ok",[id])).rows[0].ok;
    assert.equal(await allowed(),true);
    await db.query("delete from profile_departments where user_id=$1",[user]);
    assert.equal(await allowed(),false);
    assert.equal((await content(user)).today_count,0);
    await db.query("insert into profile_departments(user_id,department_slug) values($1,'projetos')",[user]);
    await db.query("update profiles set active=false where user_id=$1",[user]);
    assert.equal(await allowed(),false);
    await db.query("update profiles set active=true,email='changed@example.test' where user_id=$1",[user]);
    assert.equal(await allowed(),false);
    await db.query("update profiles set email=$2 where user_id=$1",[user,`${user}@example.test`]);
  });
  await t.test("novo resumo usa o último envio bem-sucedido, mesmo após um dia de falha", async () => {
    await db.query("update daily_digest_outbox set status='sent' where id=$1",[await job(user)]);
    assert.equal(await enqueue("2026-09-22T10:45:00Z"),3);
    assert.equal(await enqueue("2026-09-23T10:45:00Z"),3);
    const result = (await db.query<{start:string}>("select window_start::text start from daily_digest_outbox where id=$1",[await job(user,"2026-09-23")])).rows[0];
    assert.equal(new Date(result.start).toISOString(),"2026-09-21T10:45:00.000Z");
  });
  await t.test("fila não entrega a mesma linha a dois workers e recupera lease expirado", async () => {
    await db.exec("update daily_digest_outbox set status='expired'");
    const id = await job(other);
    await db.query("update daily_digest_outbox set status='pending',window_start=now()-interval '2 hours',window_end=now()-interval '1 hour',available_at=now(),expires_at=now()+interval '1 hour' where id=$1",[id]);
    const claimed = (await db.query<{id:string;lease_id:string}>("select * from claim_daily_digest()")).rows;
    assert.equal(claimed[0].id,id);
    assert.equal((await db.query("select * from claim_daily_digest()")).rows.length,0);
    await db.query("update daily_digest_outbox set locked_until=now()-interval '1 minute' where id=$1",[id]);
    const retried = (await db.query<{lease_id:string}>("select * from claim_daily_digest()")).rows[0];
    assert.notEqual(retried.lease_id,claimed[0].lease_id);
    await db.query("update daily_digest_outbox set expires_at=now()-interval '1 minute' where id=$1",[id]);
    assert.equal((await db.query("select * from claim_daily_digest()")).rows.length,0);
    assert.equal((await db.query<{status:string}>("select status from daily_digest_outbox where id=$1",[id])).rows[0].status,"expired");
  });
  await t.test("usuários comuns e anônimos não acessam fila nem funções de envio", async () => {
    for (const role of ["anon","authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await assert.rejects(()=>db.query("select * from daily_digest_outbox"),/permission denied/);
        await assert.rejects(()=>db.query("select enqueue_daily_digests()"),/permission denied/);
        await assert.rejects(()=>db.query("select * from claim_daily_digest()"),/permission denied/);
        await assert.rejects(()=>db.query("select daily_digest_content(gen_random_uuid())"),/permission denied/);
      } finally { await db.exec("reset role"); }
    }
    await db.exec("set role service_role");
    try { assert.equal((await db.query("select * from daily_digest_outbox")).rows.length,9); }
    finally { await db.exec("reset role"); }
  });
});
