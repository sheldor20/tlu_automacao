import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import React from 'react';
const require=createRequire(import.meta.url);

// Execute the actual component event handlers with deterministic hooks/transport.
// No browser, Storage service or authorization function is simulated as real coverage.
function fixture({failAt=0,analyzeFails=false}={}){
 const state=[];let cursor=0,pending,release;const uploaded=[],files=[],errors=[];let analyzed=0;
 const hooks={...React,useState:initial=>{
  const slot=cursor++;if(!(slot in state))state[slot]=initial;
  return [state[slot],value=>{state[slot]=typeof value==='function'?value(state[slot]):value;}];
 },useEffect:()=>{},useEffectEvent:fn=>fn};
 const exports={};const Button=()=>null;
 const db={storage:{from:()=>({upload:async(path)=>{uploaded.push(path);return {error:uploaded.length===failAt?new Error('synthetic upload rejection'):null};}})},auth:{getSession:async()=>({data:{session:{access_token:'synthetic'}}})}};
 runInNewContext(ts.transpileModule(readFileSync(new URL('../components/rental-contract-upload.tsx',import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}
 }).outputText,{exports,File,Blob,TextDecoder,Error,crypto,URL,setTimeout,require:name=>{
  if(name==='react')return hooks;
  if(name==='@/components/ui')return {Button};
  if(name==='@/lib/supabase')return {getSupabase:()=>db};
  if(name==='@/lib/format')return {dateBr:x=>x};
  if(name==='@/lib/rental-contracts')return {MAX_RENTAL_PDF_BYTES:25*1024*1024,RENTAL_CONTRACT_BUCKET:'rental-contracts'};
  return require(name);
 },fetch:async()=>{analyzed++;return {ok:!analyzeFails,json:async()=>analyzeFails?{error:'Synthetic analysis failure'}:{draft:{}}};}});
 const props={rentalId:'synthetic-rental',refreshKey:'1',busy:false,
  onBusy:value=>{if(value)pending=new Promise(resolve=>{release=resolve;});else{release?.();}},
  onFiles:value=>files.push(JSON.parse(JSON.stringify(value))),onDraft:()=>{},onError:value=>errors.push(value)};
 const render=()=>{cursor=0;return exports.RentalContractUpload(props);};
 function all(node,predicate){
  if(!React.isValidElement(node))return [];
  return [...(predicate(node)?[node]:[]),...React.Children.toArray(node.props.children).flatMap(child=>all(child,predicate))];
 }
 const input=()=>all(render(),n=>n.type==='input'&&n.props.type==='file')[0];
 const send=()=>all(render(),n=>n.type===Button)[0];
 const act=async work=>{pending=undefined;work();if(pending)await pending;};
 const choose=docs=>act(()=>input().props.onChange({target:{files:docs}}));
 const selectAll=()=>{for(const node of all(render(),n=>n.type==='input'&&n.props.type==='checkbox'))if(!node.props.checked)node.props.onChange({target:{checked:true}});};
 return {input,send,act,choose,selectAll,uploaded,files,errors,analyzed:()=>analyzed};
}
const pdf=name=>new File(['%PDF-1.7 synthetic'],name,{type:'application/pdf'});

test('partial upload preserves metadata, blocks reselection and never uploads twice',async()=>{
 const f=fixture({failAt:2});await f.choose([pdf('one.pdf'),pdf('two.pdf')]);f.selectAll();await f.act(()=>f.send().props.onClick());
 assert.equal(f.uploaded.length,2);assert.equal(f.analyzed(),0);assert.equal(f.files.at(-1).length,1);
 const preserved=JSON.stringify(f.files.at(-1));assert.equal(f.input().props.disabled,true);assert.equal(f.send().props.disabled,true);
 await f.choose([pdf('replacement.pdf')]);await f.act(()=>f.send().props.onClick());
 assert.equal(JSON.stringify(f.files.at(-1)),preserved);assert.equal(f.uploaded.length,2);assert.equal(f.errors.length,1);
});
test('analysis failure retains the successfully uploaded PDF for a manual save',async()=>{
 const f=fixture({analyzeFails:true});await f.choose([pdf('one.pdf')]);await f.act(()=>f.send().props.onClick());
 assert.equal(f.uploaded.length,1);assert.equal(f.analyzed(),1);assert.equal(f.files.at(-1)[0].name,'one.pdf');
 assert.equal(f.input().props.disabled,true);assert.match(f.errors[0],/analysis failure/);
});
test('a rejected first upload can be retried; invalid PDF bytes never reach Storage',async()=>{
 const f=fixture({failAt:1});await f.choose([pdf('one.pdf')]);await f.act(()=>f.send().props.onClick());
 assert.equal(f.input().props.disabled,false);assert.equal(f.files.at(-1).length,0);
 await f.act(()=>f.send().props.onClick());assert.equal(f.uploaded.length,2);assert.equal(f.files.at(-1).length,1);
 const invalid=fixture();await invalid.choose([new File(['invalid'],'bad.pdf')]);await invalid.act(()=>invalid.send().props.onClick());
 assert.equal(invalid.uploaded.length,0);assert.match(invalid.errors[0],/PDF válido/);
});
