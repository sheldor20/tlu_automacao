import assert from "node:assert/strict";
import test from "node:test";
import {migrate,projectDatabase} from "./helpers/project-database.ts";

test("carteira e recebimentos Qlik: vínculo estável, permissões, IR e cargas atômicas",async(t)=>{
 const db=await projectDatabase();t.after(()=>db.close());
 await migrate(db,"20260916184241_rental_reserve_fund.sql");await migrate(db,"20260916184652_rental_monthly_receipts.sql");
 const user="11111111-1111-4111-8111-111111111111",denied="22222222-2222-4222-8222-222222222222";
 await db.query("insert into auth.users(id,email) values($1,'rentals@example.test'),($2,'denied@example.test')",[user,denied]);
 await db.query("insert into public.profile_departments(user_id,department_slug) values($1,'alugueis')",[user]);
 const id=(await db.query<{id:string}>("insert into public.rentals(name,property_address,lessor_type,lessor_name,monthly_rent,created_by) values('Casa original','Rua de teste','pf','Locador',3000,$1) returning id",[user])).rows[0].id;
 await db.query("insert into public.rental_receipts(rental_id,reference_month,rent_received,administration_fee,reserve_fund,fines,reimbursements,property_tax) values($1,'2026-08-01',2500.50,150.20,100,20,50,200)",[id]);
 await migrate(db,"20260916190849_qlik_rental_inventory_and_income_tax.sql");await migrate(db,"20260916191302_qlik_rental_receipts_by_property_code.sql");
 async function role(name:string,sub:string|null,work:()=>Promise<void>){
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub,role:name})]);await db.exec(`set role ${name}`);
  try{await work();}finally{await db.exec("reset role");}
 }
 const inventory=(rows:unknown[],started="2025-01-01T00:00:00Z")=>db.query("select public.sync_qlik_rental_inventory($1::jsonb,$2::timestamptz)",[JSON.stringify(rows),started]);
 const receipts=(rows:unknown[],started="2025-01-01T00:00:00Z")=>db.query("select public.sync_qlik_rental_receipts($1::jsonb,$2::timestamptz)",[JSON.stringify(rows),started]);
 const manual=()=>db.query<{net_received:string;income_tax:string}>("select net_received,income_tax from public.rental_receipts where rental_id=$1",[id]);
 await t.test("migração preserva recebimentos e IR é opcional",async()=>{
  assert.equal(Number((await manual()).rows[0].net_received),2120.30);
  await role("authenticated",user,async()=>{
   await db.query("update public.rental_receipts set income_tax=120.10 where rental_id=$1",[id]);
   assert.equal(Number((await manual()).rows[0].net_received),2000.20);
   await db.query("update public.rentals set property_type='Casa',rentable=false where id=$1",[id]);
   await assert.rejects(()=>db.query("update public.rentals set name='Outro nome' where id=$1",[id]),/permission denied/);
   await assert.rejects(()=>db.query("delete from public.rentals where id=$1",[id]),/permission denied/);
   await assert.rejects(()=>db.query("insert into public.rentals(name,property_address,lessor_type,lessor_name) values('Novo','Endereço','pf','Locador')"),/permission denied/);
   await assert.rejects(()=>inventory([{source_id:"0007",name:"Casa original"}]),/permission denied/);
  });
 });
 await t.test("não sincroniza origem não validada; preserva carteira se o vínculo for ambíguo",async()=>{
  await role("service_role",null,async()=>{await assert.rejects(()=>inventory([{source_id:"0007",name:"Casa original"}]),/mapping_not_verified/);});
  await db.exec("update public.data_connections set active=true,settings=settings||'{\"mapping_verified\":true}' where slug in ('qlik-rental-inventory','qlik-rental-receipts')");
  await role("service_role",null,async()=>{
   await assert.rejects(()=>inventory([{source_id:"0007",name:"Nome diferente"}]),/legacy_mapping_required/);
   assert.equal((await db.query("select * from public.rentals")).rows.length,1);
   await inventory([{source_id:"0007",name:"Casa original"},{source_id:"7",name:"Sala nova"}]);
   const r=(await db.query<{id:string;rentable:boolean;property_type:string;monthly_rent:string}>("select * from public.rentals where qlik_property_id='0007'")).rows[0];
   assert.equal(r.id,id);assert.equal(r.rentable,false);assert.equal(r.property_type,"Casa");assert.equal(Number(r.monthly_rent),3000);
   await inventory([{source_id:"0007",name:"Casa renomeada"},{source_id:"7",name:"Sala nova"}],"2025-01-02T00:00:00Z");
   assert.equal((await db.query<{id:string}>("select id from public.rentals where name='Casa renomeada'")).rows[0].id,id);
   await assert.rejects(()=>inventory([{source_id:"0007",name:"Nome velho"}]),/stale_rental_snapshot/);
  });
 });
 const rows=[{source_code:"0007",reference_month:"2026-08-01",received_amount:2500.55},{source_code:"7",reference_month:"2026-09-01",received_amount:-20},{source_code:"999",reference_month:"2026-08-01",received_amount:500}];
 await t.test("vínculo exato por código, repetição sem duplicar e falha sem apagar o histórico",async()=>{
  await role("service_role",null,async()=>{
   await receipts(rows);
   assert.equal((await db.query("select * from public.rental_qlik_receipts")).rows.length,2);
   assert.equal(Number((await db.query<{received_amount:string}>("select received_amount from public.rental_qlik_receipts where rental_id=$1",[id])).rows[0].received_amount),2500.55);
   await receipts(rows,"2025-01-02T00:00:00Z");
   assert.equal((await db.query("select * from public.rental_qlik_receipts")).rows.length,2);
   await assert.rejects(()=>receipts([...rows,rows[0]],"2025-01-03T00:00:00Z"),/duplicate_receipt_source_month/);
   await assert.rejects(()=>receipts([{...rows[0],reference_month:"2026-08-02"}],"2025-01-03T00:00:00Z"),/check constraint/);
   assert.equal((await db.query("select * from public.rental_qlik_receipts")).rows.length,2);
   await assert.rejects(()=>receipts([],"2025-01-03T00:00:00Z"),/empty_receipts_snapshot/);
   await inventory([{source_id:"0007",name:"Casa renomeada"}],"2025-01-03T00:00:00Z");
   assert.equal((await db.query<{qlik_present:boolean}>("select qlik_present from public.rentals where qlik_property_id='7'")).rows[0].qlik_present,false);
  });
  assert.equal(Number((await manual()).rows[0].net_received),2000.20);
 });
 await t.test("leitura restrita ao departamento e importação protegida de alterações manuais",async()=>{
  await role("authenticated",user,async()=>{
   assert.equal((await db.query("select * from public.rental_qlik_receipt_totals(2026,$1)",[id])).rows.length,1);
   await assert.rejects(()=>db.query("update public.rental_qlik_receipts set received_amount=0"),/permission denied/);
   await assert.rejects(()=>receipts(rows),/permission denied/);
  });
  await role("authenticated",denied,async()=>{assert.equal((await db.query("select * from public.rental_qlik_receipt_totals(2026)")).rows.length,0);});
  await role("anon",null,async()=>{await assert.rejects(()=>db.query("select * from public.rental_qlik_receipt_totals(2026)"),/permission denied/);});
 });
 await t.test("campos confirmados pertencem ao Qlik; só contratos revisados podem ficar pendentes",async()=>{
  await migrate(db,"20260916194000_qlik_inventory_verified_fields.sql");
  await role("authenticated",user,async()=>{
   await assert.rejects(()=>db.query("update public.rentals set property_type='Outro' where id=$1",[id]),/permission denied/);
   await assert.rejects(()=>db.query("update public.rentals set rentable=true where id=$1",[id]),/permission denied/);
   await db.query("update public.rentals set monthly_rent=3100 where id=$1",[id]);
  });
  const pending=(await db.query<{id:string}>("insert into public.rentals(name,property_address,lessor_type,lessor_name,monthly_rent) values('Contrato sem código confirmado','Rua de teste','pf','Locador',1500) returning id")).rows[0].id;
  const source=[{source_id:"0007",name:"Casa renomeada",property_type:"Imóvel Residencial",rentable:true}];
  await role("service_role",null,async()=>{
   await assert.rejects(()=>inventory(source,"2025-01-04T00:00:00Z"),/legacy_mapping_required/);
  });
  await db.query("update public.data_connections set settings=settings||jsonb_build_object('pending_legacy_ids',jsonb_build_array($1::text)) where slug='qlik-rental-inventory'",[pending]);
  await role("service_role",null,async()=>{
   await inventory(source,"2025-01-04T00:00:00Z");
   await inventory(source,"2025-01-05T00:00:00Z");
  });
  const preserved=(await db.query<{qlik_property_id:string|null;monthly_rent:string}>("select qlik_property_id,monthly_rent from public.rentals where id=$1",[pending])).rows[0];
  assert.equal(preserved.qlik_property_id,null);assert.equal(Number(preserved.monthly_rent),1500);
  const synced=(await db.query<{property_type:string;rentable:boolean;monthly_rent:string}>("select property_type,rentable,monthly_rent from public.rentals where id=$1",[id])).rows[0];
  assert.equal(synced.property_type,"Imóvel Residencial");assert.equal(synced.rentable,true);assert.equal(Number(synced.monthly_rent),3100);
  assert.equal(Number((await manual()).rows[0].net_received),2000.20);
 });
});
