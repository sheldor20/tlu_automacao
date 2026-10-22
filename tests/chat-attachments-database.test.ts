import assert from "node:assert/strict";
import test from "node:test";
import { migrate, projectDatabase } from "./helpers/project-database.ts";
const ids=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333"];
test("attachments preserve bytes, enforce limits atomically and revoke access",async t=>{
 const db=await projectDatabase();t.after(()=>db.close());
 await migrate(db,"20261021201543_internal_chat.sql");await migrate(db,"20261022120641_chat_attachments.sql");
 for(const [i,id] of ids.entries()) await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",[id,`file${i}@example.test`,JSON.stringify({full_name:`Pessoa ${i}`})]);
 await db.exec("update public.profiles set active=true");
 await db.query("update public.profiles set is_admin=true where user_id=$1",[ids[2]]);
 async function as<T>(id:string|null,work:()=>Promise<T>){
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:id?"authenticated":"anon"})]);await db.exec(id?"set role authenticated":"set role anon");
  try{return await work();}finally{await db.exec("reset role");}
 }
 const conversation=await as(ids[0],async()=>(await db.query<{id:string}>("select public.create_chat_conversation($1,'Arquivos') id",[[ids[1]]])).rows[0].id);
 const bytes=Buffer.from([0,255,128,65,10]);const file={name:"foto.png",mime_type:"image/png",data:bytes.toString("base64")};
 const send=(files:unknown[],body="")=>db.query("select public.send_chat_attachments($1,$2,$3)",[conversation,body,JSON.stringify(files)]);
 let attachment="";
 await as(ids[0],async()=>{
  await send([file,{...file,name:"documento.pdf",mime_type:"application/pdf"}]);
  const result=await db.query<{id:string;size:number}>("select id,size from public.chat_attachments");assert.equal(result.rows.length,2);assert.equal(result.rows[0].size,bytes.length);attachment=result.rows[0].id;
  await assert.rejects(()=>db.query("update public.chat_attachments set name='x'"),/permission denied/);
  await assert.rejects(()=>db.query("insert into public.chat_attachments(message_id,name,mime_type,content) select id,'x','x','x'::bytea from public.chat_messages"),/permission denied/);
  for(const invalid of [[],Array(6).fill(file),[file,{...file,data:"bad!"}],[file,{...file,data:""}],[{...file,name:""}],[{...file,data:Buffer.alloc(5242881).toString("base64")}],Array(3).fill({...file,data:Buffer.alloc(4*1024*1024).toString("base64")})]){
   await assert.rejects(()=>send(invalid));assert.equal((await db.query("select id from public.chat_messages")).rows.length,1);assert.equal((await db.query("select id from public.chat_attachments")).rows.length,2);
  }
  await send([file],"Com legenda");
 });
 await as(ids[1],async()=>{const result=await db.query<{data:string}>("select * from public.download_chat_attachment($1)",[attachment]);assert.deepEqual(Buffer.from(result.rows[0].data,"base64"),bytes);});
 await as(ids[2],async()=>{assert.equal((await db.query("select * from public.chat_attachments")).rows.length,0);assert.equal((await db.query("select * from public.download_chat_attachment($1)",[attachment])).rows.length,0);await assert.rejects(()=>send([file]),/indisponível/);});
 await as(null,async()=>{await assert.rejects(()=>db.query("select * from public.chat_attachments"),/permission denied/);await assert.rejects(()=>send([file]),/permission denied/);});
 await as(ids[0],()=>db.query("select public.set_chat_group_members($1,$2)",[conversation,[ids[2]]]));
 await as(ids[1],async()=>{assert.equal((await db.query("select * from public.download_chat_attachment($1)",[attachment])).rows.length,0);await assert.rejects(()=>send([file]),/indisponível/);});
 await db.query("update public.profiles set active=false where user_id=$1",[ids[0]]);
 await as(ids[0],async()=>{assert.equal((await db.query("select * from public.chat_attachments")).rows.length,0);await assert.rejects(()=>send([file]),/indisponível/);});
});
