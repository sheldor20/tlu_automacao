import assert from "node:assert/strict";
import test from "node:test";
import { migrate, projectDatabase } from "./helpers/project-database.ts";

test("contratos: versões atômicas, acesso, conflito, isolamento de imóvel e histórico Qlik", async t => {
 const db = await projectDatabase(); t.after(() => db.close());
 for (const file of ["20260916184241_rental_reserve_fund.sql","20260916184652_rental_monthly_receipts.sql","20260916190849_qlik_rental_inventory_and_income_tax.sql","20260916191302_qlik_rental_receipts_by_property_code.sql","20260916193611_qlik_inventory_verified_fields.sql","20261020120431_rental_contract_versions.sql"]) await migrate(db,file);
 await db.exec("grant select,insert on storage.objects to authenticated,service_role");
 const user="11111111-1111-4111-8111-111111111111", denied="22222222-2222-4222-8222-222222222222";
 await db.query("insert into auth.users(id,email) values($1,'rental@example.test'),($2,'denied@example.test')",[user,denied]);
 await db.query("insert into public.profile_departments(user_id,department_slug) values($1,'alugueis')",[user]);
 const ids = (await db.query<{id:string}>("insert into public.rentals(name,property_address,lessor_type,lessor_name,qlik_property_id) values('Casa um','Rua de teste','pj','Master','1|006'),('Casa dois','Rua de teste','pj','Master','1|008') returning id")).rows.map(r=>r.id);
 const [id,other]=ids;
 await db.query("insert into storage.objects(bucket_id,name) values('rental-contracts',$1),('rental-contracts',$2)",[`${id}/original.pdf`,`${other}/other.pdf`]);
 const contract={property_address:"Rua de teste",status:"alugado",monthly_rent:1500,lessor_type:"pj",lessor_name:"Master",lease_start_date:"2023-02-02",lease_end_date:"2027-02-01",annual_adjustment_percent:0,tenant_name:"Egino",due_day:1,adjustment_index:"IGP-M",renewal_terms:"Conforme contrato",iptu_payer:"tlu",iptu_clause:"Cláusula 10",notes:null};
 const files=[{path:`${id}/original.pdf`,name:"original.pdf"}];
 async function role(name:string,sub:string|null,work:()=>Promise<void>) {
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub,role:name})]); await db.exec(`set role ${name}`);
  try {await work();} finally {await db.exec("reset role");}
 }
 const stamp=async()=> (await db.query<{updated_at:string}>("select updated_at::text from public.rentals where id=$1",[id])).rows[0].updated_at;
 const save=async(expected:string,values=contract,documents=files)=>db.query("select public.save_rental_contract($1,$2,$3,$4)",[id,expected,JSON.stringify(values),JSON.stringify(documents)]);
 await t.test("salva dados e versão juntos; mantém versões anteriores e detecta concorrência",async()=>{
  const initial=await stamp();
  await role("authenticated",user,async()=>{
   await save(initial);
   await assert.rejects(()=>save(initial),/rental_conflict/);
   assert.equal((await db.query("select * from public.rental_contract_versions")).rows.length,1);
   await save(await stamp(),{...contract,monthly_rent:1700});
   assert.equal((await db.query("select * from public.rental_contract_versions")).rows.length,2);
   const row=(await db.query<{monthly_rent:string;iptu_payer:string}>("select monthly_rent,iptu_payer from public.rentals where id=$1",[id])).rows[0];
   assert.equal(Number(row.monthly_rent),1700);assert.equal(row.iptu_payer,"tlu");
  });
 });
 await t.test("arquivo de outro imóvel, vencimento inválido e data invertida não alteram dados",async()=>{
  await role("authenticated",user,async()=>{
   await assert.rejects(()=>save(new Date().toISOString(),contract,[{path:`${other}/other.pdf`,name:"other.pdf"}]),/rental_conflict|rental_invalid_file/);
   const current=await stamp();
   await assert.rejects(()=>save(current,contract,[{path:`${other}/other.pdf`,name:"other.pdf"}]),/rental_invalid_file/);
   await assert.rejects(()=>save(current,{...contract,due_day:32}),/check constraint/);
   await assert.rejects(()=>save(current,{...contract,lease_end_date:"2020-01-01"}),/check constraint/);
   assert.equal((await db.query("select * from public.rental_contract_versions")).rows.length,2);
  });
 });
 await t.test("nega leitura e escrita sem acesso e mantém cadastro do Qlik protegido",async()=>{
  const current=await stamp();
  await role("authenticated",denied,async()=>{
   assert.equal((await db.query("select * from public.rental_contract_versions")).rows.length,0);
   await assert.rejects(()=>save(current),/rental_forbidden/);
  });
  await role("anon",null,async()=>{ await assert.rejects(()=>save(current),/permission denied/); });
  await role("authenticated",user,async()=>{
   await assert.rejects(()=>db.query("update public.rentals set rentable=true where id=$1",[id]),/permission denied/);
   await assert.rejects(()=>db.query("delete from public.rental_contract_versions"),/permission denied/);
  });
 });
 await t.test("recebimentos históricos só atualizam alugados e preservam antigos contratos",async()=>{
  await db.exec("update public.data_connections set active=true,settings=settings||'{\"mapping_verified\":true}',last_success_at=now() where slug in ('qlik-rental-inventory','qlik-rental-receipts')");
  await db.query("insert into public.rental_qlik_receipts(rental_id,reference_month,source_code,received_amount,synchronized_at) values($1,'2024-01-01','1|008',900,now())",[other]);
  await role("service_role",null,async()=>{
   const rows=[{source_code:"1|006",reference_month:"2023-01-01",received_amount:1500},{source_code:"1|008",reference_month:"2024-01-01",received_amount:9999}];
   await db.query("select public.sync_qlik_rental_receipts($1,'2025-01-01')",[JSON.stringify(rows)]);
   assert.equal(Number((await db.query<{received_amount:string}>("select received_amount from public.rental_qlik_receipts where rental_id=$1",[other])).rows[0].received_amount),900);
   assert.equal(Number((await db.query<{received_amount:string}>("select received_amount from public.rental_qlik_receipts where rental_id=$1",[id])).rows[0].received_amount),1500);
  });
 });
});
