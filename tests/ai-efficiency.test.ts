import test from "node:test";
import assert from "node:assert/strict";
import { cacheKey, cachedJson, openAIFetch } from "../lib/ai-efficiency.cjs";

test("cache keys isolate users, tenants, models and content while ignoring object key order", () => {
 assert.equal(cacheKey("a:workspace","op",{x:1,y:2}),cacheKey("a:workspace","op",{y:2,x:1}));
 const original=cacheKey("a:workspace","op",{model:"small",document:"one"});
 for(const [scope,input] of [["b:workspace",{model:"small",document:"one"}],["a:another",{model:"small",document:"one"}],["a:workspace",{model:"large",document:"one"}],["a:workspace",{model:"small",document:"two"}]] as const) assert.notEqual(original,cacheKey(scope,"op",input));
});

test("persistent reuse, changed data, concurrent calls, invalid results and provider failures", async () => {
 const originalFetch=globalThis.fetch, originalUrl=process.env.SUPABASE_URL, originalKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL="https://cache.test";process.env.SUPABASE_SERVICE_ROLE_KEY="test-only";
 const entries=new Map(),events: Record<string, unknown>[]=[];let providerCalls=0;let mode="valid";
 globalThis.fetch=async (input,options: RequestInit={}) => {
  const url=new URL(String(input));
  if(url.hostname==="cache.test") {
   if(url.pathname.endsWith("ai_usage_events")){events.push(JSON.parse(String(options.body)));return new Response(null,{status:204});}
   if(options.method==="POST"){for(const row of JSON.parse(String(options.body))) entries.set(row.cache_key,row);return new Response(null,{status:204});}
   const keys=(url.searchParams.get("cache_key")||"").slice(4,-1).split(",");
   return Response.json(keys.filter(key=>entries.has(key)).map(key=>entries.get(key)));
  }
  providerCalls++;
  if(mode==="error") return Response.json({error:{message:"unavailable"}},{status:429});
  return Response.json({id:"resp-"+providerCalls,model:"test",status:mode==="incomplete"?"incomplete":"completed",
   output_text:mode==="invalid"?"not json":'{"answer":"ok"}',usage:{input_tokens:100,output_tokens:10}},{headers:{"x-request-id":"request-"+providerCalls}});
 };
 try {
  const options={method:"POST",body:JSON.stringify({model:"test",input:"private example",text:{format:{type:"json_schema",schema:{type:"object",required:["answer"],additionalProperties:false,properties:{answer:{type:"string"}}}}}})};
  const context={scope:"user:tenant",system:"test",operation:"test-generation"};
  await openAIFetch("https://api.openai.com/v1/responses",options,context);
  const cached=await openAIFetch("https://api.openai.com/v1/responses",options,context);
  assert.equal(providerCalls,1);assert.equal(cached.headers.get("X-AI-Cache"),"hit");
  assert.equal(events.at(-1)!.input_tokens,0);assert.equal(events.at(-1)!.cache_hit,true);
  assert.ok(!JSON.stringify(events).includes("private example"));
  await openAIFetch("https://api.openai.com/v1/responses",options,{...context,scope:"other:tenant"});
  assert.equal(providerCalls,2);
  let produced=0;
  const produce=async()=>{produced++;await new Promise(resolve=>setImmediate(resolve));return {value:1};};
  await Promise.all([cachedJson({scope:"a",purpose:"singleflight",input:1},produce),cachedJson({scope:"a",purpose:"singleflight",input:1},produce)]);
  assert.equal(produced,1);
  for(const state of ["error","invalid","incomplete"]) {
   mode=state;const before: number=providerCalls;
   for(let index=0;index<2;index++) await openAIFetch("https://api.openai.com/v1/responses",options,{...context,operation:state});
   assert.equal(providerCalls,before+2,state+" must not be cached");
  }
 } finally {
  globalThis.fetch=originalFetch;
  if(originalUrl===undefined) delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=originalUrl;
  if(originalKey===undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=originalKey;
 }
});

