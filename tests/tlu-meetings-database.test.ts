import assert from "node:assert/strict";
import test from "node:test";
import { migrate, projectDatabase } from "./helpers/project-database.ts";

const leader = "11111111-1111-4111-8111-111111111111";
const report = "22222222-2222-4222-8222-222222222222";
const admin = "33333333-3333-4333-8333-333333333333";
const outsider = "44444444-4444-4444-8444-444444444444";
const secondReport = "55555555-5555-4555-8555-555555555555";

test("Reuniões TLU: modelos, acessos, 1:1 privado e revisão da ata", async t => {
  const db = await projectDatabase();
  t.after(() => db.close());
  await db.exec("alter table storage.objects add column owner_id text; grant select,insert,delete on storage.objects to authenticated;");
  for (const name of ["20260916175736_ra_edit_delete_definitions.sql", "20260916180941_ra_delete_item_task.sql", "20260916183159_task_files_comments_activity.sql", "20260916202418_today_alert_department_permissions.sql"]) await migrate(db,name);
  for (const [id,name] of [[leader,"Christiane Ribeiro"],[report,"Jessica Alves dos Santos"],[admin,"Kim Silvestre"],[outsider,"Pessoa externa"],[secondReport,"Gabriela Alves dos Reis"]]) {
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [id, `${id}@example.test`, JSON.stringify({ full_name: name })]);
  }
  await db.query("update public.profiles set active=true,is_admin=(user_id=$1)",[admin]);
  await db.query("insert into public.profile_departments(user_id,department_slug) select user_id,'projetos' from public.profiles on conflict do nothing");
  await db.query("insert into public.profile_reporting_lines(leader_user_id,report_user_id) values($1,$2),($1,$3)",[leader,report,secondReport]);
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:leader,role:"authenticated"})]);
  const legacy = (await db.query<{id:string}>("insert into public.ra_meetings(title,scheduled_at,leader_user_id,status,minutes_text) values('Ata anterior',now(),$1,'encerrada','Texto original legado') returning id",[leader])).rows[0].id;
  await migrate(db,"20260928212742_tlu_meeting_rites.sql");
  async function asUser<T>(id:string,work:()=>Promise<T>) {
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:"authenticated"})]);
    await db.exec("set role authenticated");
    try { return await work(); } finally { await db.exec("reset role"); }
  }
  async function create(type:string, reportId:string|null = null, topics=["Tema para discussão"]) {
    return (await db.query<{id:string}>("select public.create_tlu_meeting($1,$2,now(),$3,$4,$5,'{}',$6) id",[type,`Encontro ${type}`,leader,reportId,type==="1:1"?[]:[leader],topics])).rows[0].id;
  }
  async function items(id:string) { return (await db.query<{id:string}>("select i.id from public.ra_agenda_items i join public.ra_agenda_sections s on s.id=i.section_id where s.meeting_id=$1 order by i.position",[id])).rows; }
  const collective:Record<string,string> = {};
  let individual = ""; let task = "";

  await t.test("preserva registros legados e resolve participantes sem inventar Aylton",async()=>{
    const row=(await db.query<{meeting_type:string;minutes_text:string}>("select meeting_type,minutes_text from public.ra_meetings where id=$1",[legacy])).rows[0];
    assert.deepEqual(row,{meeting_type:"RA",minutes_text:"Texto original legado"});
    assert.equal((await db.query("select 1 from public.ra_meeting_type_members where meeting_type='RAO' and user_id=$1",[secondReport])).rows.length,1);
    assert.equal((await db.query("select 1 from public.ra_meeting_type_members where user_id=$1",[outsider])).rows.length,0);
  });
  await t.test("cria pautas para os quatro ritos coletivos com definições e tarefas",async()=>{
    await asUser(leader,async()=>{
      for(const type of ["RAE","RASP","RA","RAO"]) {
        const id=await create(type); collective[type]=id;
        assert.equal((await items(id)).length,1);
        await db.query("select public.record_ra_decision($1,'Decisão registrada')",[(await items(id))[0].id]);
        await db.query("select public.convert_ra_item_to_task($1,$2,current_date)",[(await items(id))[0].id,leader]);
      }
    });
  });
  await t.test("as agendas obedecem o tipo mesmo para quem conhece o endereço ou já é participante",async()=>{
    await asUser(report,async()=>{
      assert.deepEqual((await db.query<{meeting_type:string}>("select distinct meeting_type from public.ra_meetings")).rows.map(x=>x.meeting_type),["RAO"]);
      assert.equal((await db.query("select * from public.ra_decisions where meeting_id=$1",[collective.RASP])).rows.length,0);
    });
    await asUser(outsider,async()=>assert.equal((await db.query("select * from public.ra_meetings")).rows.length,0));
  });
  await t.test("administrador altera lista atomicamente e a revogação alcança reuniões anteriores",async()=>{
    await asUser(admin,()=>db.query("select public.set_ra_meeting_type_members('RAO',$1)",[[leader,report,outsider]]));
    await asUser(outsider,async()=>assert.equal((await db.query("select * from public.ra_meetings where id=$1",[collective.RAO])).rows.length,1));
    await asUser(admin,()=>db.query("select public.set_ra_meeting_type_members('RAO',$1)",[[leader,report]]));
    await asUser(outsider,async()=>assert.equal((await db.query("select * from public.ra_meetings where id=$1",[collective.RAO])).rows.length,0));
    await asUser(report,()=>assert.rejects(()=>db.query("select public.set_ra_meeting_type_members('RAO',$1)",[[outsider]]),/administrador/));
    await asUser(admin,()=>assert.rejects(()=>db.query("select public.set_ra_meeting_type_members('RAO',$1)",[[outsider,"66666666-6666-4666-8666-666666666666"]]),/ativos/));
    assert.equal((await db.query("select * from public.ra_meeting_type_members where meeting_type='RAO'")).rows.length,2);
  });
  await t.test("falha de criação desfaz reunião e participantes",async()=>{
    const before=(await db.query("select id from public.ra_meetings")).rows.length;
    await asUser(leader,()=>assert.rejects(()=>create("RA",null,["x"]),/check constraint/));
    assert.equal((await db.query("select id from public.ra_meetings")).rows.length,before);
  });
  await t.test("1:1 é criado somente com liderado direto e tem exatamente a dupla",async()=>{
    await asUser(leader,async()=>{
      await assert.rejects(()=>create("1:1",outsider),/row-level security/);
      individual=await create("1:1",report);
      assert.equal((await db.query("select * from public.ra_participants where meeting_id=$1",[individual])).rows.length,2);
      await assert.rejects(()=>db.query("insert into public.ra_participants(meeting_id,user_id) values($1,$2)",[individual,outsider]),/restrito/);
      await assert.rejects(()=>db.query("update public.ra_meetings set meeting_type='RA',report_user_id=null where id=$1",[individual]),/não podem ser alterados/);
      await assert.rejects(()=>db.query("update public.ra_meetings set report_user_id=$1 where id=$2",[secondReport,individual]),/não podem ser alterados/);
      await db.query("update public.ra_meetings set record_data=$1 where id=$2",[JSON.stringify({leader_feedback:"Registro privado"}),individual]);
    });
    for(const user of [outsider,secondReport,admin]) await asUser(user,async()=>{
      assert.equal((await db.query("select * from public.ra_meetings where id=$1",[individual])).rows.length,0);
      for(const table of ["ra_participants","ra_agenda_sections","ra_decisions"]) assert.equal((await db.query(`select * from public.${table} where meeting_id=$1`,[individual])).rows.length,0);
      assert.equal((await items(individual)).length,0);
      assert.equal((await db.query<{allowed:boolean}>("select public.can_administer_ra_meeting($1) allowed",[individual])).rows[0].allowed,false);
    });
    await asUser(report,async()=>assert.equal((await db.query("select * from public.ra_meetings where id=$1",[individual])).rows.length,1));
  });
  await t.test("tarefas, comentários, arquivos, subtarefas e notificações do 1:1 não vazam",async()=>{
    await asUser(leader,async()=>{
      const item=(await items(individual))[0].id;
      task=(await db.query<{id:string}>("select public.convert_ra_item_to_task($1,$2,current_date) id",[item,report])).rows[0].id;
      await db.query("insert into public.project_task_activity(task_id,kind,body) values($1,'comment','Feedback privado')",[task]);
      await assert.rejects(()=>db.query("insert into public.project_task_assignees(task_id,user_id,assignee_name,assignee_email) values($1,$2,'Terceiro','other@example.test')",[task,outsider]),/1:1|permission denied|row-level security/);
      await assert.rejects(()=>db.query("update public.project_tasks set private_meeting_leader_id=null,private_meeting_report_id=null where id=$1",[task]),/privacidade/);
    });
    for(const user of [admin,outsider,secondReport]) await asUser(user,async()=>{
      for(const table of ["project_tasks","project_task_assignees","project_subtasks","project_task_activity"]) {
        assert.equal((await db.query(`select * from public.${table} where ${table==="project_tasks"?"id":"task_id"}=$1`,[task])).rows.length,0,`${user}:${table}`);
      }
      assert.equal((await db.query("select * from public.user_notifications where entity_id=$1",[task])).rows.length,0);
      assert.equal((await db.query<{allowed:boolean}>("select public.can_access_task_file($1) allowed",[`${task}/files/77777777-7777-4777-8777-777777777777.pdf`])).rows[0].allowed,false);
    });
    await asUser(report,async()=>assert.equal((await db.query("select * from public.project_tasks where id=$1",[task])).rows.length,1));
  });
  await t.test("corrigir ata encerrada exige administrador, preserva status e registra versões",async()=>{
    const id=collective.RA;
    await asUser(leader,()=>db.query("update public.ra_meetings set status='encerrada',closed_at=now(),minutes_text='Ata original' where id=$1",[id]));
    const before=(await db.query<{closed_at:Date}>("select closed_at from public.ra_meetings where id=$1",[id])).rows[0].closed_at;
    await asUser(leader,async()=>{
      await assert.rejects(()=>db.query("update public.ra_meetings set minutes_text='Não permitido' where id=$1",[id]),/administrador/);
      await assert.rejects(()=>db.query("update public.ra_meetings set status='em_andamento' where id=$1",[id]),/finalizada/);
      assert.equal((await db.query("update public.ra_agenda_items set content='Não permitido' where id=$1",[(await items(id))[0].id])).affectedRows,0);
    });
    await asUser(admin,async()=>{
      await db.query("select public.revise_ra_minutes($1,'Ata corrigida',0)",[id]);
      await assert.rejects(()=>db.query("select public.revise_ra_minutes($1,'Correção desatualizada',0)",[id]),/outra pessoa/);
      await assert.rejects(()=>db.query("select public.revise_ra_minutes($1,' ',1)",[id]),/caracteres/);
      const row=(await db.query<{status:string;minutes_revision:number;closed_at:Date}>("select status,minutes_revision,closed_at from public.ra_meetings where id=$1",[id])).rows[0];
      assert.equal(row.status,"encerrada");assert.equal(row.minutes_revision,1);assert.deepEqual(row.closed_at,before);
      const history=(await db.query<{previous_text:string;minutes_text:string;edited_by:string}>("select previous_text,minutes_text,edited_by from public.ra_minutes_revisions where meeting_id=$1",[id])).rows[0];
      assert.deepEqual(history,{previous_text:"Ata original",minutes_text:"Ata corrigida",edited_by:admin});
      await assert.rejects(()=>db.query("delete from public.ra_minutes_revisions where meeting_id=$1",[id]),/permission denied/);
      await db.query("update public.ra_meetings set archived_at=now() where id=$1",[id]);
      await assert.rejects(()=>db.query("select public.revise_ra_minutes($1,'Outra correção',1)",[id]),/Restaure/);
      await db.query("update public.ra_meetings set archived_at=null where id=$1",[id]);
    });
  });
  await t.test("administrador externo não corrige ata nem acessa versões de um 1:1",async()=>{
    await asUser(leader,()=>db.query("update public.ra_meetings set status='encerrada',minutes_text='Ata confidencial',closed_at=now() where id=$1",[individual]));
    await asUser(admin,()=>assert.rejects(()=>db.query("select public.revise_ra_minutes($1,'Tentativa externa',0)",[individual]),/permissão/));
    await db.query("update public.profiles set is_admin=true where user_id=$1",[leader]);
    await asUser(leader,()=>db.query("select public.revise_ra_minutes($1,'Ata confidencial corrigida',0)",[individual]));
    await asUser(admin,async()=>assert.equal((await db.query("select * from public.ra_minutes_revisions where meeting_id=$1",[individual])).rows.length,0));
    await asUser(report,async()=>assert.equal((await db.query("select * from public.ra_minutes_revisions where meeting_id=$1",[individual])).rows.length,1));
  });
  await t.test("excluir encontro preserva tarefas sem expor conteúdo privado",async()=>{
    await asUser(leader,()=>db.query("delete from public.ra_meetings where id=$1",[individual]));
    await asUser(admin,async()=>assert.equal((await db.query("select * from public.project_tasks where id=$1",[task])).rows.length,0));
    await asUser(report,async()=>assert.equal((await db.query("select * from public.project_tasks where id=$1",[task])).rows.length,1));
  });
});
