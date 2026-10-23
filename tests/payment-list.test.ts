import test from 'node:test';
import assert from 'node:assert/strict';
await import('./helpers/payment-transport-loader.mjs');
const {GET}=await import('../app/api/payments/route.ts');
const actor='11111111-1111-4111-8111-111111111111';

test('responsible list/count includes assignments beyond a truncated first page',async t=>{
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://synthetic.invalid';
 process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-test-only';
 t.after(()=>{delete process.env.NEXT_PUBLIC_SUPABASE_URL;delete process.env.SUPABASE_SERVICE_ROLE_KEY;});
 const assignments=Array.from({length:1202},(_,i)=>({request_id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`}));
 const active=assignments.slice(1200).map(x=>({id:x.request_id,title:'Synthetic active',responsibles:[{user_id:actor}]}));
 const queries:URL[]=[];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{
  const u=new URL(String(input));queries.push(u);
  if(u.pathname.endsWith('/auth/v1/user'))return Response.json({id:actor,email:'synthetic@example.invalid'});
  if(u.pathname.endsWith('/profiles'))return Response.json({full_name:'Synthetic',active:true,is_admin:false,deleted_at:null});
  if(u.pathname.endsWith('/profile_payment_permissions'))return Response.json(null);
  if(u.pathname.endsWith('/payment_request_responsibles'))return Response.json(assignments.slice(0,Number(u.searchParams.get('limit')||1000)));
  if(u.pathname.endsWith('/payment_requests')){
   const joined=u.searchParams.get('select')?.includes('payment_request_responsibles!inner(user_id)');
   const filtered=joined&&u.searchParams.get('responsibles.user_id')===`eq.${actor}`?active:[];
   return Response.json(filtered,{headers:{'Content-Range':filtered.length?'0-1/2':'*/0'}});
  }
  throw Error('Unexpected synthetic URL: '+u.pathname);
 });
 const response=await GET(new Request('https://app.invalid/api/payments?scope=management',{headers:{Authorization:'Bearer synthetic-session'}}));
 assert.equal(response.status,200);const body=await response.json();
 assert.deepEqual(body.rows,active.map(({id,title})=>({id,title})));assert.equal(body.count,2);assert.equal(body.can_manage,true);
 const q=queries.find(u=>u.pathname.endsWith('/payment_requests'))!;
 assert.equal(q.searchParams.get('deleted_at'),'is.null');assert.equal(q.searchParams.get('id'),null);
 assert.equal(queries.find(u=>u.pathname.endsWith('/payment_request_responsibles'))?.searchParams.get('limit'),'1');
});

test('management pagination retains actor filters; own scope, unassigned and anonymous access stay bounded',async t=>{
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://synthetic.invalid';
 process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-test-only';
 t.after(()=>{delete process.env.NEXT_PUBLIC_SUPABASE_URL;delete process.env.SUPABASE_SERVICE_ROLE_KEY;});
 let manager=false,assigned=true,active=true;const queries:URL[]=[];
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{
  const u=new URL(String(input));queries.push(u);
  if(u.pathname.endsWith('/auth/v1/user'))return Response.json({id:actor,email:'synthetic@example.invalid'});
  if(u.pathname.endsWith('/profiles'))return Response.json({full_name:'Synthetic',active,is_admin:false,deleted_at:null});
  if(u.pathname.endsWith('/profile_payment_permissions'))return Response.json({can_manage:manager});
  if(u.pathname.endsWith('/payment_request_responsibles'))return Response.json(assigned?[{request_id:'synthetic'}]:[]);
  if(u.pathname.endsWith('/payment_requests'))return Response.json([],{headers:{'Content-Range':'*/0'}});
  throw Error('Unexpected synthetic URL');
 });
 const call=(params:string,authenticated=true)=>GET(new Request('https://app.invalid/api/payments?'+params,{headers:authenticated?{Authorization:'Bearer synthetic-session'}:{}}));
 assert.equal((await call('scope=management&page=2&status=aprovado&type=materials&company=synthetic&search=PAG-12')).status,200);
 let q=queries.filter(u=>u.pathname.endsWith('/payment_requests')).at(-1)!;
 assert.equal(q.searchParams.get('offset'),'80');assert.equal(q.searchParams.get('limit'),'40');assert.equal(q.searchParams.get('responsibles.user_id'),'eq.'+actor);
 assert.equal(q.searchParams.get('status'),'eq.aprovado');assert.equal(q.searchParams.get('type'),'eq.materials');assert.equal(q.searchParams.get('company_key'),'eq.synthetic');assert.equal(q.searchParams.get('protocol'),'eq.12');
 await call('');q=queries.filter(u=>u.pathname.endsWith('/payment_requests')).at(-1)!;
 assert.equal(q.searchParams.get('requester_user_id'),'eq.'+actor);assert.equal(q.searchParams.get('responsibles.user_id'),null);
 assigned=false;assert.equal((await (await call('scope=management')).json()).can_manage,false);
 manager=true;await call('scope=management');q=queries.filter(u=>u.pathname.endsWith('/payment_requests')).at(-1)!;
 assert.equal(q.searchParams.get('responsibles.user_id'),null);assert.equal(q.searchParams.get('deleted_at'),'is.null');
 active=false;assert.equal((await call('scope=management')).status,403);
 const before=queries.length;assert.equal((await call('scope=management',false)).status,401);assert.equal(queries.length,before);
});
