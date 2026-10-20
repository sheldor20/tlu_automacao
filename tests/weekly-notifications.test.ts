import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";
import { migrate, projectDatabase } from "./helpers/project-database.ts";
import { buildTaskEmail } from "../lib/task-email.ts";
import type { DailyDigest } from "../lib/daily-digest.ts";

test("autoria, avisos de delegação, pagamentos e resumo semanal com permissões", async t => {
  const db = await projectDatabase();
  t.after(() => db.close());
  await db.exec("alter table storage.objects add column owner_id text;");
  for (const name of ["20260916132107_enterprise_performance.sql", "20260916180238_payment_requests.sql", "20260916180335_payment_access_policies.sql", "20260916180924_payment_email_order.sql", "20260916183159_task_files_comments_activity.sql", "20260916192138_payment_finalized_status.sql", "20260916194044_payment_materials_optional_fields.sql", "20260916203112_payment_edit_delete.sql", "20260917121514_weekday_daily_digest.sql", "20260916175736_ra_edit_delete_definitions.sql", "20260916180941_ra_delete_item_task.sql", "20260916202418_today_alert_department_permissions.sql", "20260928212742_tlu_meeting_rites.sql", "20261016183946_performance_agreements.sql", ...readdirSync(new URL("../supabase/migrations/",import.meta.url)).filter(n=>n.endsWith("_weekly_digest_and_delegated_task_emails.sql"))]) await migrate(db,name);
  const creator="11111111-1111-4111-8111-111111111111", assignee="22222222-2222-4222-8222-222222222222";
  await db.query("insert into auth.users(id,email) values($1,'creator@example.test'),($2,'assignee@example.test')",[creator,assignee]);
  await db.query("update profiles set active=true,full_name=case when user_id=$1 then 'Criadora' else 'Responsável' end,is_admin=(user_id=$1)",[creator]);
  await db.exec("delete from profile_departments");
  await db.query("insert into profile_departments(user_id,department_slug) values($1,'projetos')",[assignee]);
  const claims = async (id:string) => db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:'authenticated'})]);
  await claims(creator);
  const task = (await db.query<{id:string;created_by:string;creator_name:string}>("insert into project_tasks(title,due_date,assignee_user_id,assignee_name,assignee_email,created_by) values('Delegada','2026-10-25',$1,'Responsável','assignee@example.test',$1) returning *",[assignee])).rows[0];
  assert.equal(task.created_by,creator); assert.equal(task.creator_name,'Criadora');
  await db.query("update project_tasks set created_by=$1,creator_name='Falso' where id=$2",[assignee,task.id]);
  assert.equal((await db.query<{creator_name:string}>("select creator_name from project_tasks where id=$1",[task.id])).rows[0].creator_name,'Criadora');
  await claims(assignee);
  await db.query("update project_tasks set status='em_andamento' where id=$1",[task.id]);
  await db.query("insert into project_task_activity(task_id,kind,body) values($1,'comment','Atualização')",[task.id]);
  assert.equal((await db.query("select * from task_email_outbox")).rows.length,2);
  await db.query("update project_tasks set status='em_andamento' where id=$1",[task.id]);
  const self=(await db.query<{id:string}>("insert into project_tasks(title,due_date,assignee_user_id,assignee_name,assignee_email) values('Própria','2026-10-26',$1,'Responsável','assignee@example.test') returning id",[assignee])).rows[0].id;
  await db.query("update project_tasks set status='concluida' where id=$1",[self]);
  await db.query("insert into project_task_activity(task_id,kind,body) values($1,'comment','Próprio comentário')",[self]);
  assert.equal((await db.query("select * from task_email_outbox")).rows.length,2);
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(()=>db.query("select * from task_email_outbox"),/permission denied/);
    await assert.rejects(()=>db.query("select * from claim_task_email()"),/permission denied/);
    await db.exec('reset role');
  }
  await claims(creator);
  const payment=(await db.query<{id:string}>(`insert into payment_requests(submission_id,submission_digest,requester_user_id,requester_name,requester_email,company_key,company_name,type,title,description,amount,due_date,beneficiary,details,source)
    values(gen_random_uuid(),'test',$1,'Pessoa','assignee@example.test','TEST','Empresa','service','Pagamento','Descrição',100,'2026-10-23','{}','{}','internal') returning id`,[assignee])).rows[0].id;
  for (const kind of ['status_changed','comment']) await db.query("insert into payment_request_events(request_id,kind,status,actor_name,message) values($1,$2,'reviewing','Gestora','Atualização')",[payment,kind]);
  assert.equal((await db.query("select * from payment_email_outbox where request_id=$1",[payment])).rows.length,2);
  await claims(assignee);
  await db.query(`insert into performance_agreements(report_user_id,cycle,starts_on,ends_on,goals) values($1,'Ciclo semanal','2026-10-01','2026-10-31',$2)`,[assignee,JSON.stringify([{title:'Meta individual',indicator:'Entregas',expected_result:'5 entregas',due_date:'2026-10-23'}])]);
  await claims(creator);
  const enqueue=async(at:string)=>(await db.query<{n:number}>("select enqueue_daily_digests($1) n",[at])).rows[0].n;
  assert.equal(await enqueue('2026-10-19T10:44:59Z'),0);
  assert.equal(await enqueue('2026-10-20T10:45:00Z'),0);
  assert.equal(await enqueue('2026-10-19T10:45:00Z'),2);
  assert.equal(await enqueue('2026-10-19T11:00:00Z'),0);
  const id=(await db.query<{id:string}>("select id from daily_digest_outbox where user_id=$1",[assignee])).rows[0].id;
  const content=async()=>{
    await db.exec("set role service_role");
    try { return (await db.query<{d:DailyDigest}>("select daily_digest_content($1) d",[id])).rows[0].d; }
    finally { await db.exec("reset role"); }
  };
  const d=await content();
  assert.equal(d.sections?.filter(s=>s.section==='Acordo de Performance').length,1);
  const adminJob=(await db.query<{id:string}>("select id from daily_digest_outbox where user_id=$1",[creator])).rows[0].id;
  const adminContent=(await db.query<{d:DailyDigest}>("select daily_digest_content($1) d",[adminJob])).rows[0].d;
  assert.equal(adminContent.sections?.filter(s=>s.section==='Acordo de Performance').length,0); // no admin bypass for private goals
  assert.equal(d.weekly,true); assert.deepEqual(d.today.map(t=>t.title),['Delegada']);
  assert.equal(d.payment_count,1); assert.equal(d.payments[0].status,'submitted'); // current status, even without recent events
  assert.deepEqual(d.sections?.filter(s=>s.section==='Áreas disponíveis').map(s=>s.id),['projetos']);
  await db.query("delete from profile_departments where user_id=$1",[assignee]);
  assert.equal((await content()).today_count,0);
  const job=(await db.query<{id:string}>("select id from task_email_outbox limit 1")).rows[0].id;
  await db.query("update profiles set active=false where user_id=$1",[creator]);
  assert.equal((await db.query<{ok:boolean}>("select task_email_authorized($1) ok",[job])).rows[0].ok,false);
});

test("email de tarefa escapa comentários e exibe status legível",()=>{
 const email=buildTaskEmail({name:'Ana',title:'Tarefa',kind:'comment',message:'<img src=x>',href:'/projetos'},'ana@example.test','app@example.test','https://app.example.test');
 assert.match(email.html,/&lt;img/); assert.doesNotMatch(email.html,/<img/);
 assert.deepEqual(email.to,['ana@example.test']);
 assert.match(buildTaskEmail({name:'Ana',title:'Tarefa',kind:'status_changed',message:'concluida',href:'/projetos'},'a@b.test','app@b.test','https://app.test').text,/Concluída/);
});

test("reenvio de tarefa mantém corpo e chave; acesso revogado impede envio", async()=>{
 const { dispatchTaskEmails }=await import('../lib/task-email.ts');
 const job={id:'job',lease_id:'lease',attempts:1,status:'pending',recipient:'ana@example.test',content:{name:'Ana',title:'Teste',kind:'comment',message:'Comentário',href:'/projetos'},email_payload:null};
 let allowed=true;
 const db={rpc:async(name:string)=> {
   if(name==='task_email_authorized') return {data:allowed,error:null};
   if(job.status!=='pending') return {data:[],error:null};
   job.status='sending';return {data:[{...job}],error:null};
 },from:()=>({update:(values:Record<string,unknown>)=>{
   const q={eq:()=>q,select:async()=>{Object.assign(job,values);return {data:[{id:job.id}],error:null}}};return q;
 }})} as unknown as import('@supabase/supabase-js').SupabaseClient;
 const bodies:string[]=[],keys:string[]=[];
 let fail=true;
 const options={db,key:'test',from:'app@example.test',origin:'https://app.example.test',pause:async()=>{},fetcher:async(_input:unknown,init?:RequestInit)=>{
   bodies.push(String(init?.body));keys.push(new Headers(init?.headers).get('Idempotency-Key')!);
   if(fail) {fail=false;throw new Error('timeout');}
   return Response.json({id:'provider'});
 }};
 assert.equal((await dispatchTaskEmails(options)).failed,1);
 job.status='pending';job.attempts++;
 assert.equal((await dispatchTaskEmails({...options,from:'changed@example.test'})).sent,1);
 assert.equal(bodies[0],bodies[1]);assert.equal(keys[0],keys[1]);
 allowed=false;job.status='pending';
 assert.equal((await dispatchTaskEmails(options)).skipped,1);assert.equal(bodies.length,2);
});
