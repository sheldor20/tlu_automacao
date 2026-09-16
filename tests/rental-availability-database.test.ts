import assert from "node:assert/strict";
import test from "node:test";
import { migrate, projectDatabase } from "./helpers/project-database.ts";

test("disponibilidade conta apenas desocupados com permissão e mantém o acesso por área", async (t) => {
  const db = await projectDatabase();
  t.after(() => db.close());
  await migrate(db, "20260916184241_rental_reserve_fund.sql");
  await migrate(db, "20260916184652_rental_monthly_receipts.sql");
  await migrate(db, "20260916190849_qlik_rental_inventory_and_income_tax.sql");
  await migrate(db, "20260916195820_rental_availability_requires_rentable.sql");

  const allowed = "11111111-1111-4111-8111-111111111111";
  const denied = "22222222-2222-4222-8222-222222222222";
  await db.query("insert into auth.users(id,email) values($1,'allowed@example.test'),($2,'denied@example.test')", [allowed, denied]);
  await db.exec("update public.profiles set is_admin=false");
  await db.query("insert into public.profile_departments(user_id,department_slug) values($1,'indicadores')", [allowed]);
  await db.query("insert into public.profile_indicator_areas(user_id,area) values($1,'rh-marketing-clientes')", [allowed]);
  await db.exec(`
    insert into public.rentals(name,property_address,lessor_type,lessor_name,status,rentable,lease_start_date)
    select 'Imóvel ' || status || coalesce(rentable::text,'pendente'), 'Rua de teste', 'pf', 'Locador',
      status::public.rental_status, rentable, date '2026-01-01'
    from (values ('desocupado'),('alugado'),('aguardando_reforma')) s(status)
    cross join (values (true),(false),(null::boolean)) r(rentable);
  `);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: allowed, role: "authenticated" })]);
  await db.exec("set role authenticated");
  const result = await db.query<Record<string, number | string>>("select * from public.management_rental_snapshot()");
  assert.deepEqual(Object.fromEntries(Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)])), {
    total_properties: 9, available_properties: 1, rented_properties: 3, renovation_properties: 3,
  });
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: denied, role: "authenticated" })]);
  await assert.rejects(() => db.query("select * from public.management_rental_snapshot()"), /indicator_area_access_required/);
  await db.exec("reset role; set role anon");
  await assert.rejects(() => db.query("select * from public.management_rental_snapshot()"), /permission denied/);
});
