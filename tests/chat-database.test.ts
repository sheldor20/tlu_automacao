import assert from "node:assert/strict";
import test from "node:test";
import { migrate, projectDatabase } from "./helpers/project-database.ts";

const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"];
test("chat: privacidade, grupos, envio, leitura e usuários inativos", async t => {
  const db = await projectDatabase(); t.after(() => db.close());
  await migrate(db, "20261021201543_internal_chat.sql");
  for (const [i,id] of ids.entries()) await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)", [id, `chat${i}@example.test`, JSON.stringify({full_name:`Pessoa ${i}`})]);
  await db.exec("update public.profiles set active=true");
  await db.query("update public.profiles set is_admin=true where user_id=$1",[ids[2]]);
  async function as<T>(id:string|null, work:()=>Promise<T>) {
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:id?"authenticated":"anon"})]);
    await db.exec(id?"set role authenticated":"set role anon");
    try { return await work(); } finally { await db.exec("reset role"); }
  }
  const create = async (members:string[],name:string|null=null) => (await db.query<{id:string}>("select public.create_chat_conversation($1,$2) id",[members,name])).rows[0].id;
  const direct = await as(ids[0],()=>create([ids[1]]));
  await t.test("dupla é única, com ordem invertida ou membros repetidos",async()=>{
    assert.equal(await as(ids[1],()=>create([ids[0],ids[0]])),direct);
    assert.equal((await db.query("select * from public.chat_members where conversation_id=$1",[direct])).rows.length,2);
  });
  await t.test("participante envia sem poder falsificar remetente ou data",async()=>{
    await as(ids[0],async()=>{
      await db.query("insert into public.chat_messages(conversation_id,body) values($1,'Olá, equipe!')",[direct]);
      await assert.rejects(()=>db.query("insert into public.chat_messages(conversation_id,body,sender_id) values($1,'Falso',$2)",[direct,ids[1]]),/permission denied/);
      await assert.rejects(()=>db.query("insert into public.chat_messages(conversation_id,body,created_at) values($1,'Falso',now())",[direct]),/permission denied/);
      await assert.rejects(()=>db.query("insert into public.chat_messages(conversation_id,body) values($1,'   ')",[direct]),/check constraint/);
      await assert.rejects(()=>db.query("update public.chat_members set user_id=$1 where conversation_id=$2",[ids[2],direct]),/permission denied/);
    });
  });
  await t.test("terceiros, inclusive administrador, não acessam conversa ou mensagens",async()=>{
    await as(ids[2],async()=>{
      for(const table of ["chat_conversations","chat_members","chat_messages"]) assert.equal((await db.query(`select * from public.${table}`)).rows.length,0);
      assert.equal((await db.query("select * from public.chat_inbox()")).rows.length,0);
      await assert.rejects(()=>db.query("insert into public.chat_messages(conversation_id,body) values($1,'Intruso')",[direct]),/row-level security/);
      await assert.rejects(()=>db.query("select public.mark_chat_read($1,now())",[direct]),/indisponível/);
    });
    await as(null,async()=>{
      await assert.rejects(()=>db.query("select * from public.chat_messages"),/permission denied/);
      await assert.rejects(()=>create([ids[1]]),/permission denied/);
    });
  });
  await t.test("não lidas pertencem ao destinatário e leitura não regride",async()=>{
    await as(ids[1],async()=>{
      assert.equal(Number((await db.query<{unread:number}>("select unread from public.chat_inbox()")).rows[0].unread),1);
      await db.query("select public.mark_chat_read($1,clock_timestamp())",[direct]);
      await db.query("select public.mark_chat_read($1,'2000-01-01'::timestamptz)",[direct]);
      assert.equal(Number((await db.query<{unread:number}>("select unread from public.chat_inbox()")).rows[0].unread),0);
    });
    await as(ids[0],async()=>assert.equal(Number((await db.query<{unread:number}>("select unread from public.chat_inbox()")).rows[0].unread),0));
  });
  const group = await as(ids[0],()=>create([ids[1]],"Projetos"));
  await t.test("criador gerencia grupo e remoção revoga acesso ao histórico",async()=>{
    await as(ids[1],()=>assert.rejects(()=>db.query("select public.set_chat_group_members($1,$2)",[group,[ids[2]]]),/criador/));
    await as(ids[0],async()=>{
      await db.query("insert into public.chat_messages(conversation_id,body) values($1,'Histórico do grupo')",[group]);
      await db.query("select public.set_chat_group_members($1,$2)",[group,[ids[2]]]);
      await assert.rejects(()=>db.query("select public.set_chat_group_members($1,$2)",[direct,[ids[2]]]),/criador/);
    });
    await as(ids[1],async()=>{
      assert.equal((await db.query("select * from public.chat_messages where conversation_id=$1",[group])).rows.length,0);
      await assert.rejects(()=>db.query("insert into public.chat_messages(conversation_id,body) values($1,'Removido')",[group]),/row-level security/);
    });
    await as(ids[2],async()=>assert.equal((await db.query("select * from public.chat_messages where conversation_id=$1",[group])).rows.length,1));
  });
  await t.test("perfil inativo ou excluído perde acesso e não pode ser convidado",async()=>{
    await db.query("update public.profiles set active=false where user_id=$1",[ids[1]]);
    await as(ids[1],async()=>{
      assert.equal((await db.query("select * from public.chat_messages")).rows.length,0);
      await assert.rejects(()=>create([ids[0]]),/acesso ao chat/);
    });
    await as(ids[0],()=>assert.rejects(()=>create([ids[1]],"Convite inválido"),/ativos/));
    await db.query("update public.profiles set deleted_at=now() where user_id=$1",[ids[3]]);
    await as(ids[0],()=>assert.rejects(()=>create([ids[3]]),/ativos/));
    await as(ids[0],()=>assert.rejects(()=>create(["55555555-5555-4555-8555-555555555555"]),/ativos/));
  });
});
