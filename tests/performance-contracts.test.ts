import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { migrate, projectDatabase } from "./helpers/project-database.ts";
import { PERFORMANCE_CONTRACT_TERMS, performanceContractDocument } from "../lib/performance-contract-document.ts";
import type { PerformanceContract, PerformanceContractAcceptance } from "../lib/performance-agreements.ts";

const employee = "11111111-1111-4111-8111-111111111111";
const leader = "22222222-2222-4222-8222-222222222222";
const reviewer = "33333333-3333-4333-8333-333333333333";
const admin = "44444444-4444-4444-8444-444444444444";
const other = "55555555-5555-4555-8555-555555555555";
const nextLeader = "66666666-6666-4666-8666-666666666666";
const goals = [{title: "Entregar <script>alert('x')</script>", indicator: "Projetos", expected_result: "10", due_date: "2026-12-01"}];

test("contratos: autorização ADM, assinaturas, conteúdo preservado e exclusão lógica", async t => {
 const db = await projectDatabase(); t.after(() => db.close());
 await migrate(db, "20260916202418_today_alert_department_permissions.sql");
 await migrate(db, "20260916203610_resolve_today_alerts.sql");
 await migrate(db, "20261016183946_performance_agreements.sql");
 await migrate(db, "20261019133209_performance_acknowledgments_files.sql");
 await migrate(db, "20261019133714_performance_agreement_notifications.sql");
 await migrate(db, "20261021124534_performance_contracts_and_review_access.sql");
 for (const id of [employee,leader,reviewer,admin,other,nextLeader]) await db.query("insert into auth.users(id,email) values($1,$2)",[id,`${id}@test.com`]);
 await db.query("update public.profiles set is_admin = true where user_id=$1",[admin]);
 await db.query("insert into public.profile_reporting_lines(report_user_id,leader_user_id) values($1,$2)",[employee,leader]);
 async function as<T>(id: string, fn:()=>Promise<T>) {await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:"authenticated"})]);await db.exec("set role authenticated");try{return await fn();}finally{await db.exec("reset role");}}
 const agreement = (await as(leader,()=>db.query<{id:string}>("insert into public.performance_agreements(report_user_id,cycle,starts_on,ends_on,goals) values($1,'Ciclo 2026','2026-01-01','2026-12-31',$2::jsonb) returning id",[employee,JSON.stringify(goals)]))).rows[0].id;
 const issue = (version=1) => db.query<PerformanceContract>("insert into public.performance_agreement_contracts(agreement_id,agreement_version,leader_signature_name,snapshot,leader_signed_at,content_hash) values($1,$2,'Líder Nome','{}','2000-01-01','falso') returning *",[agreement,version]);
 let contract!: PerformanceContract;
 await t.test("somente líder emite; snapshot, partes, data e hash vêm do banco",async()=>{
  for(const id of [employee,reviewer,admin,other]) await as(id,()=>assert.rejects(()=>issue()));
  contract=(await as(leader,()=>issue())).rows[0];
  assert.equal(contract.report_identity.user_id,employee);assert.equal(contract.leader_identity.user_id,leader);
  assert.equal(contract.terms,PERFORMANCE_CONTRACT_TERMS);assert.deepEqual(contract.snapshot.goals,goals);assert.match(contract.content_hash,/^[a-f0-9]{64}$/);assert.notEqual(String(contract.leader_signed_at),"2000-01-01");
  await as(leader,()=>assert.rejects(()=>issue(),/unique/));
 });
 await t.test("ADM não ganha consulta implícita e usuário não pode se autorizar",async()=>{
  for(const id of [reviewer,admin,other]) await as(id,async()=>{assert.equal((await db.query("select * from public.performance_agreements")).rows.length,0);assert.equal((await db.query("select * from public.performance_agreement_contracts")).rows.length,0);await assert.rejects(()=>db.query("insert into public.profile_performance_permissions(user_id,can_review) values($1,true)",[id]),/permission denied/);});
 });
 await db.query("insert into public.profile_performance_permissions(user_id,can_review) values($1,true)",[reviewer]);
 await t.test("liberação permite consulta, mas não edição, emissão ou envio de arquivos",async()=>{
  await as(reviewer,async()=>{assert.equal((await db.query("select * from public.performance_agreements")).rows.length,1);assert.equal((await db.query("select * from public.performance_agreement_contracts")).rows.length,1);assert.equal((await db.query("update public.performance_agreements set cycle='Inválido' returning id")).rows.length,0);await assert.rejects(()=>issue());});
  await db.exec("grant select, insert on storage.objects to authenticated");
  await as(reviewer,()=>assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name) values('performance-files',$1)",[`${agreement}/${reviewer}/arquivo.pdf`]),/row-level security/));
 });
 const sign=()=>db.query<PerformanceContractAcceptance>("insert into public.performance_contract_acceptances(contract_id,signature_name,location_description,latitude,longitude,signed_at,content_hash,statement) values($1,'Liderado Nome','Salvador / BA',-12.97,-38.50,'2000-01-01','falso','falso') returning *",[contract.id]);
 let acceptance!: PerformanceContractAcceptance;
 await t.test("assinatura do liderado registra data, local e conteúdo, visível ao líder e revisor",async()=>{
  for(const id of [leader,reviewer,other]) await as(id,()=>assert.rejects(sign));
  acceptance=(await as(employee,sign)).rows[0];assert.equal((await db.query("select * from public.performance_acknowledgments where agreement_id=$1",[agreement])).rows.length,1);await as(leader,async()=>assert.equal((await db.query("select * from public.user_notifications where notification_type='performance_signed' and entity_id=$1",[agreement])).rows.length,1));
  assert.equal(acceptance.signer_id,employee);assert.equal(acceptance.content_hash,contract.content_hash);assert.match(acceptance.statement,/documento integral/);assert.equal(acceptance.location_description,"Salvador / BA");assert.equal(acceptance.latitude,-12.97);assert.notEqual(String(acceptance.signed_at),"2000-01-01");
  for(const id of [employee,leader,reviewer]) await as(id,async()=>assert.equal((await db.query("select * from public.performance_contract_acceptances")).rows.length,1));
  await as(employee,()=>assert.rejects(sign,/unique/));
 });
 await t.test("documento contém dados explícitos, ambas as assinaturas, local e metas escapadas",()=>{
  const html=performanceContractDocument(contract,acceptance);writeFileSync("/tmp/tlu-performance-contract-preview.html", html);assert.match(html,/Assinado por líder e liderado/);assert.match(html,/Salvador \/ BA/);assert.match(html,/-12.97, -38.5/);assert.match(html,/Líder Nome/);assert.match(html,/Liderado Nome/);assert.match(html,/01\/01\/2026/);assert.match(html,/31\/12\/2026/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,new RegExp(contract.content_hash));
  assert.doesNotMatch(performanceContractDocument(contract,{...acceptance,content_hash:"divergente"}),/Assinado por líder e liderado/);
 });
 await t.test("documentos e assinaturas são imutáveis; nova revisão não herda assinatura",async()=>{
  for(const id of [employee,leader,reviewer]) await as(id,async()=>{await assert.rejects(()=>db.query("update public.performance_agreement_contracts set terms='falso'"),/permission denied/);await assert.rejects(()=>db.query("delete from public.performance_contract_acceptances"),/permission denied/);});
  await as(leader,()=>db.query("update public.performance_agreements set expectations='Nova expectativa' where id=$1",[agreement]));
  await as(employee,()=>assert.rejects(()=>db.query("insert into public.performance_contract_acceptances(contract_id,signature_name,location_description) values($1,'Nome Completo','Salvador / BA')",[contract.id]),/forbidden|unique/));
  const next=(await as(leader,()=>issue(2))).rows[0];assert.equal(next.snapshot.expectations,"Nova expectativa");assert.notEqual(next.content_hash,contract.content_hash);
  await as(employee,async()=>assert.equal((await db.query("select * from public.performance_contract_acceptances where contract_id=$1",[next.id])).rows.length,0));
  assert.equal(contract.snapshot.expectations,"");
 });
 await t.test("revogação da permissão remove consulta imediatamente",async()=>{
  await db.query("update public.profile_performance_permissions set can_review=false where user_id=$1",[reviewer]);
  await as(reviewer,async()=>{assert.equal((await db.query("select * from public.performance_agreement_contracts")).rows.length,0);assert.equal((await db.query("select * from public.performance_contract_acceptances")).rows.length,0);});
 });
 await t.test("troca de liderança preserva documento das partes originais sem abrir outros acordos",async()=>{
  await db.query("update public.profile_reporting_lines set leader_user_id=$1 where report_user_id=$2",[nextLeader,employee]);
  await as(leader,async()=>{assert.equal((await db.query("select * from public.performance_agreements")).rows.length,0);assert.equal((await db.query("select * from public.performance_agreement_contracts")).rows.length,2);assert.equal((await db.query("select * from public.performance_contract_acceptances")).rows.length,1);});
 });
 await t.test("exclusão lógica pelo líder mantém os documentos e bloqueia novas edições",async()=>{
  await as(nextLeader,()=>db.query("update public.performance_agreements set archived_at='2000-01-01',archived_by=$2 where id=$1",[agreement,other]));
  assert.equal((await db.query("select * from public.user_notifications where entity_id=$1",[agreement])).rows.length,0);
  const row=(await db.query<{archived_by:string;archived_at:string}>("select archived_by,archived_at from public.performance_agreements where id=$1",[agreement])).rows[0];assert.equal(row.archived_by,nextLeader);assert.notEqual(String(row.archived_at),"2000-01-01");
  await as(nextLeader,async()=>{await assert.rejects(()=>db.query("update public.performance_agreements set archived_at=null where id=$1",[agreement]),/archived/);await assert.rejects(()=>issue(3));});
  await as(employee,async()=>{assert.equal((await db.query("select * from public.performance_agreement_contracts")).rows.length,2);assert.equal((await db.query("select * from public.performance_contract_acceptances")).rows.length,1);});
 });
 await t.test("usuário inativo e anônimo não consultam documentos",async()=>{
  await db.query("update public.profiles set active=false where user_id=$1",[leader]);await as(leader,async()=>assert.equal((await db.query("select * from public.performance_agreement_contracts")).rows.length,0));
  await db.exec("set role anon");try{await assert.rejects(()=>db.query("select * from public.performance_agreement_contracts"),/permission denied/);}finally{await db.exec("reset role");}
 });
});
