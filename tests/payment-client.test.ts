import test from 'node:test';
import assert from 'node:assert/strict';
await import('./helpers/payment-transport-loader.mjs');
const {paymentFetch,uploadPaymentFile}=await import('../lib/payment-client.ts');

test('signed large upload uses the signed TUS route and confirms once',async t=>{
 const g=globalThis as unknown as {__paymentStorageFixture:unknown;__tusOptions:{endpoint:string;headers:Record<string,string>;storeFingerprintForResuming:boolean}};
 g.__paymentStorageFixture={storage:{from:()=>({uploadToSignedUrl:async()=>({error:null})})}};
 const previous=process.env.NEXT_PUBLIC_SUPABASE_URL;
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://synthetic.supabase.co';
 t.after(()=>{if(previous===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=previous;});
 const calls:string[]=[];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{
  const path=String(input);calls.push(path);
  return Response.json(path.endsWith('/files')?{id:'file',path:'request/file.pdf',token:'synthetic-signature'}:{ok:true});
 });
 await uploadPaymentFile('request',new File([new Uint8Array(7*1024*1024)],'large.pdf',{type:'application/pdf'}),'support','synthetic-token');
 assert.equal(g.__tusOptions.endpoint,'https://synthetic.storage.supabase.co/storage/v1/upload/resumable/sign');
 assert.deepEqual(g.__tusOptions.headers,{'x-signature':'synthetic-signature'});
 assert.equal(g.__tusOptions.storeFingerprintForResuming,false);
 assert.deepEqual(calls,['/api/payments/request/files','/api/payments/request/files/file']);
});

test('a 120-file public batch survives the existing 180-request/minute budget',async t=>{
 let used=0,windows=1,prepared=0,confirmed=0,uploaded=0;
 (globalThis as unknown as {__paymentStorageFixture:unknown}).__paymentStorageFixture={storage:{from:()=>({uploadToSignedUrl:async()=>{uploaded++;return {error:null};}})}};
 t.mock.method(globalThis,'setTimeout',((callback:()=>void,delay:number)=>{assert.equal(delay,61_000);used=0;windows++;queueMicrotask(callback);return 1;}) as unknown as typeof setTimeout);
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{
  if(++used>180)return Response.json({error:'Limite temporário'},{status:429});
  if(String(input).endsWith('/files')){prepared++;return Response.json({id:String(prepared),path:'synthetic.pdf',token:'synthetic'});}
  confirmed++;return Response.json({ok:true});
 });
 for(let i=0;i<120;i++)await uploadPaymentFile('request',new File(['%PDF-1.7'],'small.pdf',{type:'application/pdf'}),'support','synthetic-token');
 assert.deepEqual({prepared,confirmed,uploaded,windows},{prepared:120,confirmed:120,uploaded:120,windows:2});
});

test('rate retries are bounded; other POSTs, failures and uncertain outcomes are not retried',async t=>{
 let calls=0;
 t.mock.method(globalThis,'setTimeout',((callback:()=>void)=>{queueMicrotask(callback);return 1;}) as unknown as typeof setTimeout);
 const fetch=t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:'limited'},{status:429});});
 await assert.rejects(()=>paymentFetch('/upload',{method:'POST',retryRateLimit:true},'synthetic'),/limited/);assert.equal(calls,4);
 calls=0;await assert.rejects(()=>paymentFetch('/other',{method:'POST'},'synthetic'));assert.equal(calls,1);
 calls=0;fetch.mock.mockImplementation(async()=>{calls++;throw Error('uncertain network outcome');});
 await assert.rejects(()=>paymentFetch('/upload',{method:'POST',retryRateLimit:true},'synthetic'),/uncertain/);assert.equal(calls,1);
 calls=0;fetch.mock.mockImplementation(async()=>{calls++;return Response.json({error:'server'},{status:500});});
 await assert.rejects(()=>paymentFetch('/upload',{method:'POST',retryRateLimit:true},'synthetic'),/server/);assert.equal(calls,1);
});
