import assert from 'node:assert/strict';
import test from 'node:test';
import { migrate, projectDatabase } from './helpers/project-database.ts';
test('assinatura vinculada à revisão, imutável e restrita ao liderado; anexos privados', async t => {
 const db = await projectDatabase(); t.after(() => db.close());
 await migrate(db, '20261016183946_performance_agreements.sql');
 await migrate(db, '20261019133209_performance_acknowledgments_files.sql');
 const employee='11111111-1111-4111-8111-111111111111', leader='22222222-2222-4222-8222-222222222222', other='33333333-3333-4333-8333-333333333333';
 for (const id of [employee,leader,other]) await db.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@test.com']);
 await db.query('insert into public.profile_reporting_lines(report_user_id,leader_user_id) values($1,$2)',[employee,leader]);
 async function as(id:string, fn:()=>Promise<unknown>) { await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:'authenticated'})]); await db.exec('set role authenticated'); try{return await fn();}finally{await db.exec('reset role');} }
 let agreement='';
 await as(leader, async()=>{const r=await db.query<{id:string}>(`insert into public.performance_agreements(report_user_id,cycle,starts_on,ends_on,goals) values($1,'Ciclo','2026-01-01','2026-12-31','[{"title":"Meta","indicator":"N","expected_result":"10","due_date":"2026-12-01"}]') returning id`,[employee]);agreement=r.rows[0].id;});
 const sign=()=>db.query<{signer_id:string;snapshot:{cycle:string};statement:string;signed_at:string}>(`insert into public.performance_acknowledgments(agreement_id,agreement_version,signature_name,signed_at,snapshot,statement) values($1,1,'Nome Completo','2000-01-01','{}','falso') returning *`,[agreement]);
 await as(leader,()=>assert.rejects(sign));
 await as(employee,async()=>{
  assert.equal((await db.query('update public.performance_agreements set cycle=\'Inválido\' where id=$1 returning id',[agreement])).rows.length,0);
  const r=await sign(); assert.equal(r.rows[0].signer_id,employee); assert.equal((r.rows[0].snapshot as {cycle:string}).cycle,'Ciclo'); assert.match(String(r.rows[0].statement),/recebi, li e compreendi/); assert.notEqual(String(r.rows[0].signed_at),'2000-01-01');
  await assert.rejects(sign,/unique/);
  await assert.rejects(()=>db.query('delete from public.performance_acknowledgments'),/permission denied/);
 });
 await as(leader,()=>db.query("update public.performance_agreements set expectations='Nova meta' where id=$1",[agreement]));
 await as(employee,()=>assert.rejects(sign,/conflict/));
 await as(other,async()=>{assert.equal((await db.query('select * from public.performance_acknowledgments')).rows.length,0);});
 await db.exec('grant select, insert on storage.objects to authenticated');
 for(const user of [employee,leader]) await as(user,()=>db.query("insert into storage.objects(bucket_id,name) values('performance-files',$1)",[`${agreement}/${user}/documento.pdf`]));
 await as(other,async()=>{assert.equal((await db.query("select * from storage.objects where bucket_id='performance-files'")).rows.length,0);await assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name) values('performance-files',$1)",[`${agreement}/${other}/file.pdf`]),/row-level security/);});
});
