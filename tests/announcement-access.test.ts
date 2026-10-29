import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {announcementSchema,announcementAction} from '../lib/announcement-schema.ts';
function handlers({admin=false,publisher=false,owner='other',active=true}={}){
 const writes:string[]=[];
 const db={from(table:string){const chain:any={};for(const method of ['select','eq','is','order','limit','in'])chain[method]=()=>chain;
 chain.maybeSingle=async()=>({data:table==='announcement_publishers'?(publisher?{user_id:'actor'}:null):table==='announcements'?{id:'post',author_id:owner,media_path:null}:{user_id:'target'},error:null});
 for(const method of ['insert','update','delete','upsert'])chain[method]=()=>{writes.push(table+':'+method);return chain;};chain.then=(resolve:any)=>resolve({data:[],error:null});return chain;}};
 class Failure extends Error{status:number;constructor(message:string,status=400){super(message);this.status=status;}}
 const deps={paymentDb:()=>db,paymentActor:async()=>{if(!active)throw new Failure('inactive',403);return {id:'actor',name:'Actor',admin};},paymentBody:(r:Request)=>r.json(),paymentJson:(v:unknown,status=200)=>Response.json(v,{status}),paymentFailure:(e:any)=>Response.json({error:e.message},{status:e.status||400}),PaymentError:Failure};
 const module={exports:{} as any};
 const source=ts.transpileModule(readFileSync(new URL('../app/api/announcements/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports:module.exports,module,require:(name:string)=>name.includes('announcement-schema')?{announcementSchema,announcementAction}:deps,URL,Response,console});
 return {route:module.exports,writes};
}
const postId='11111111-1111-4111-8111-111111111111';
function req(body:unknown){return new Request('https://test.invalid/api/announcements',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
test('publicação exige autorização; permissão administrativa não pode ser autoatribuída',async()=>{
 const normal=handlers();assert.equal((await normal.route.POST(req({title:'Aviso',body:'Texto'}))).status,403);assert.equal(normal.writes.length,0);
 assert.equal((await normal.route.PATCH(req({action:'permission',user_id:postId,can_publish:true}))).status,403);assert.equal(normal.writes.length,0);
 for(const options of [{admin:true},{publisher:true}]){const h=handlers(options);assert.equal((await h.route.POST(req({title:'Aviso',body:'Texto'}))).status,201);assert.deepEqual(h.writes,['announcements:insert']);}
});
test('qualquer usuário ativo interage; edição e exclusão protegem autoria',async()=>{
 const h=handlers();assert.equal((await h.route.PATCH(req({action:'comment',post_id:postId,body:'Olá'}))).status,200);assert.equal((await h.route.PATCH(req({action:'react',post_id:postId,reaction:'👍'}))).status,200);
 assert.equal((await h.route.PATCH(req({action:'delete_post',post_id:postId}))).status,403);
 const publisher=handlers({publisher:true});assert.equal((await publisher.route.POST(req({id:postId,title:'Aviso',body:'Alterado'}))).status,403);
 for(const options of [{admin:true},{publisher:true,owner:'actor'}]){const own=handlers(options);assert.equal((await own.route.POST(req({id:postId,title:'Aviso',body:'Alterado'}))).status,201);}
 const inactive=handlers({active:false});assert.equal((await inactive.route.PATCH(req({action:'comment',post_id:postId,body:'Olá'}))).status,403);assert.equal(inactive.writes.length,0);
});
