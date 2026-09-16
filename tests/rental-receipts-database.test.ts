import assert from "node:assert/strict";
import test from "node:test";
import { migrate, projectDatabase } from "./helpers/project-database.ts";

test("recebimentos: persistência por mês, independência do contrato e permissões", async (t) => {
  const db = await projectDatabase();
  t.after(() => db.close());
  await migrate(db, "20260916184241_rental_reserve_fund.sql");
  await migrate(db, "20260916184652_rental_monthly_receipts.sql");
  const allowed = "11111111-1111-4111-8111-111111111111", denied = "22222222-2222-4222-8222-222222222222";
  await db.query("insert into auth.users(id,email) values ($1,'rental@example.test'),($2,'denied@example.test')", [allowed, denied]);
  await db.query("insert into public.profile_departments(user_id,department_slug) values ($1,'alugueis')", [allowed]);
  async function asRole(role: string, id: string | null, work: () => Promise<void>) {
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, role })]);
    await db.exec(`set role ${role}`);
    try { await work(); } finally { await db.exec("reset role"); }
  }
  let rentalId = "";
  await asRole("authenticated", allowed, async () => {
    rentalId = (await db.query<{ id: string }>("insert into public.rentals(name,property_address,lessor_type,lessor_name,monthly_rent,broker_commission) values ('Imóvel teste','Endereço de teste','pf','Locador',2500,150) returning id")).rows[0].id;
  });
  const write = (month: string) => db.query<{ net_received: string }>("insert into public.rental_receipts(rental_id,reference_month,rent_received,administration_fee,reserve_fund,fines,reimbursements,property_tax) values ($1,$2,2500.50,150.20,100,20,50,200) returning net_received", [rentalId, month]);
  const read = () => db.query<{ net_received: string }>("select * from public.rental_receipt_monthly_totals(2026)");
  await t.test("contrato não cria recebimentos; grava, edita e consolida centavos", async () => {
    await asRole("authenticated", allowed, async () => {
      assert.equal((await read()).rows.length, 0);
      assert.equal(Number((await write("2026-08-01")).rows[0].net_received), 2120.30);
      assert.equal((await read()).rows.length, 1);
      await db.query("update public.rental_receipts set rent_received=2600.50 where rental_id=$1", [rentalId]);
      assert.equal(Number((await read()).rows[0].net_received), 2220.30);
      assert.equal(Number((await db.query<{ monthly_rent: string }>("select monthly_rent from public.rentals where id=$1", [rentalId])).rows[0].monthly_rent), 2500);
      await db.query("update public.rentals set monthly_rent=50,status='desocupado' where id=$1", [rentalId]);
      assert.equal(Number((await read()).rows[0].net_received), 2220.30);
      await write("2026-09-01");
      await db.query("update public.rental_receipts set rent_received=0,fines=0,reimbursements=0 where rental_id=$1 and reference_month='2026-09-01'", [rentalId]);
      assert.equal(Number((await read()).rows[1].net_received), -450.20);
      assert.equal((await db.query("select * from public.rental_receipt_monthly_totals(2025)")).rows.length, 0);
    });
  });
  await t.test("impede mês duplicado, data inválida e valores negativos", async () => {
    await asRole("authenticated", allowed, async () => {
      await assert.rejects(() => write("2026-08-01"), /unique constraint/);
      await assert.rejects(() => write("2026-08-02"), /check constraint/);
      await assert.rejects(() => db.query("update public.rental_receipts set fines=-1 where rental_id=$1", [rentalId]), /check constraint/);
      await assert.rejects(() => db.query("update public.rental_receipts set net_received=999 where rental_id=$1", [rentalId]), /can only be updated to DEFAULT/);
    });
  });
  await t.test("sem acesso ao departamento não lê, insere, edita nem apaga", async () => {
    await asRole("authenticated", denied, async () => {
      assert.equal((await read()).rows.length, 0);
      assert.equal((await db.query("select * from public.rental_receipts")).rows.length, 0);
      await assert.rejects(() => write("2026-10-01"), /row-level security/);
      assert.equal((await db.query("update public.rental_receipts set rent_received=100 returning id")).rows.length, 0);
      assert.equal((await db.query("delete from public.rental_receipts returning id")).rows.length, 0);
    });
    await asRole("anon", null, async () => {
      await assert.rejects(read, /permission denied/);
      await assert.rejects(() => db.query("select * from public.rental_receipts"), /permission denied/);
    });
  });
  await t.test("exclusão de um mês atualiza o gráfico sem alterar os demais", async () => {
    await asRole("authenticated", allowed, async () => {
      await db.query("delete from public.rental_receipts where rental_id=$1 and reference_month='2026-09-01'", [rentalId]);
      assert.equal((await read()).rows.length, 1);
      assert.equal(Number((await read()).rows[0].net_received), 2220.30);
    });
    await db.query("update public.profiles set active=false where user_id=$1", [allowed]);
    await asRole("authenticated", allowed, async () => { assert.equal((await read()).rows.length, 0); });
  });
});
