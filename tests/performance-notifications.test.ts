import assert from 'node:assert/strict';
import test from 'node:test';
import { migrate, projectDatabase } from './helpers/project-database.ts';

test('avisos de performance em Hoje respeitam destinatário, revisão e assinatura', async t => {
 const db = await projectDatabase(); t.after(() => db.close());
 for (const name of ['20260916202418_today_alert_department_permissions.sql','20260916203610_resolve_today_alerts.sql','20261016183946_performance_agreements.sql','20261019133209_performance_acknowledgments_files.sql']) await migrate(db,name);
 const employee='11111111-1111-4111-8111-111111111111', leader='22222222-2222-4222-8222-222222222222', other='33333333-3333-4333-8333-333333333333', admin='44444444-4444-4444-8444-444444444444';
 for (const id of [employee,leader,other,admin]) await db.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@test.com']);
 await db.query('update public.profiles set is_admin=true where user_id=$1',[admin]);
 await db.exec('delete from public.profile_departments');
 await db.query('insert into public.profile_reporting_lines(report_user_id,leader_user_id) values($1,$2)',[employee,leader]);
 async function as<T>(id:string, fn:()=>Promise<T>) { await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:'authenticated'})]); await db.exec('set role authenticated'); try{return await fn();}finally{await db.exec('reset role');} }
 const create=(cycle='Ciclo')=>db.query<{id:string}>(`insert into public.performance_agreements(report_user_id,cycle,starts_on,ends_on,goals) values($1,$2,'2026-01-01','2026-12-31','[{"title":"Meta","indicator":"N","expected_result":"10","due_date":"2026-12-01"}]') returning id`,[employee,cycle]);
 const agreement = (await as(leader,()=>create())).rows[0].id;
 await migrate(db,'20261019133714_performance_agreement_notifications.sql');
 const list=(id:string)=>db.query<{id:string;occurrence_key:string;title:string;href:string;resolved_at:string|null}>('select * from public.today_alerts($1)',[id]);
 const count=()=>db.query<{n:number}>('select public.current_user_today_alert_count() n');
 const notifications=()=>db.query<{notification_type:string;recipient_user_id:string}>('select notification_type,recipient_user_id from public.user_notifications');
 let firstOccurrence='';
 await t.test('ciclos existentes são incluídos, sem depender de departamento',async()=>{
  await as(employee,async()=>{
   const rows=(await list(employee)).rows; assert.equal(rows.length,1); assert.match(rows[0].title,/pendente/); assert.equal(rows[0].href,`/acordo-performance?agreement=${agreement}`); assert.equal((await count()).rows[0].n,1);
   firstOccurrence=rows[0].occurrence_key;
   await db.query('select public.resolve_today_alert($1,$2)',[rows[0].id,rows[0].occurrence_key]); assert.equal((await count()).rows[0].n,0);
  });
 });
 await t.test('edição reabre aviso uma única vez',async()=>{
  await as(leader,()=>db.query("update public.performance_agreements set expectations='Nova expectativa' where id=$1",[agreement]));
  await as(employee,async()=>{const rows=(await list(employee)).rows;assert.equal(rows.length,1);assert.notEqual(rows[0].occurrence_key,firstOccurrence);assert.equal(rows[0].resolved_at,null);assert.equal((await count()).rows[0].n,1);});
 });
 await t.test('líder, administrador e terceiros não leem o aviso privado do liderado',async()=>{
  for (const user of [leader,other,admin]) await as(user,async()=>{assert.equal((await notifications()).rows.length,0);assert.equal((await list(employee)).rows.length,0);});
 });
 await t.test('assinatura retira a pendência e avisa exclusivamente o líder atual',async()=>{
  await as(employee,()=>db.query("insert into public.performance_acknowledgments(agreement_id,agreement_version,signature_name) values($1,2,'Pessoa Teste')",[agreement]));
  await as(employee,async()=>{assert.equal((await count()).rows[0].n,0);assert.equal((await notifications()).rows.length,0);});
  await as(leader,async()=>{assert.equal((await count()).rows[0].n,1);const rows=(await list(leader)).rows;assert.match(rows[0].title,/assinado/);assert.equal(rows[0].href,`/acordo-performance?agreement=${agreement}`);assert.equal((await notifications()).rows[0].notification_type,'performance_signed');});
  for(const user of [other,admin]) await as(user,async()=>assert.equal((await notifications()).rows.length,0));
 });
 await t.test('nova revisão remove confirmação anterior e exige novo aceite',async()=>{
  await as(leader,()=>db.query("update public.performance_agreements set expectations='Revisado' where id=$1",[agreement]));
  await as(leader,async()=>assert.equal((await count()).rows[0].n,0));
  await as(employee,async()=>assert.equal((await count()).rows[0].n,1));
  await as(employee,()=>db.query("insert into public.performance_acknowledgments(agreement_id,agreement_version,signature_name) values($1,3,'Pessoa Teste')",[agreement]));
  await as(leader,async()=>assert.equal((await count()).rows[0].n,1));
 });
 await t.test('novo ciclo gera aviso automaticamente',async()=>{
  const next=(await as(leader,()=>create('Próximo ciclo'))).rows[0].id;
  await as(employee,async()=>{const rows=(await list(employee)).rows;assert.equal(rows.length,1);assert.equal(rows[0].href,`/acordo-performance?agreement=${next}`);});
 });
 await t.test('troca de líder revoga acesso à confirmação',async()=>{
  await db.query('update public.profile_reporting_lines set leader_user_id=$1 where report_user_id=$2',[other,employee]);
  await as(leader,async()=>{assert.equal((await notifications()).rows.length,0);assert.equal((await count()).rows[0].n,0);});
 });
});
