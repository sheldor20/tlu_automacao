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
  await db.exec("reset role");

  const historyQuery = `select reference_month, value, metadata from public.management_indicator_values
    where area='rh-marketing-clientes' and metric_key='imoveis_disponiveis'
      and reference_month <> date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
    order by reference_month`;
  const historyBefore = (await db.query(historyQuery)).rows;
  await migrate(db, "20260916202303_rental_availability_monthly_history.sql");
  const currentAvailability = async () => {
    const result = await db.query<{ value: string }>(`select value from public.management_indicator_values
      where area='rh-marketing-clientes' and metric_key='imoveis_disponiveis'
        and reference_month=date_trunc('month', now() at time zone 'America/Sao_Paulo')::date`);
    assert.equal(result.rows.length, 1);
    return Number(result.rows[0].value);
  };
  assert.equal(await currentAvailability(), 1);
  assert.equal(Number((await db.query<{ count: string }>("select count(*) from public.rentals")).rows[0].count), 9);
  await db.exec("set role service_role");
  await db.exec("update public.rentals set rentable=true where status='desocupado' and rentable=false");
  await db.exec("reset role");
  assert.equal(await currentAvailability(), 2);
  await db.query("insert into public.profile_departments(user_id,department_slug) values($1,'alugueis')", [allowed]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: allowed, role: "authenticated" })]);
  await db.exec("set role authenticated");
  await db.exec("update public.rentals set status='alugado' where status='desocupado' and rentable=true");
  await db.exec("reset role");
  assert.equal(await currentAvailability(), 0);
  await db.exec("insert into public.rentals(name,property_address,lessor_type,lessor_name,status,rentable) values('Disponível novo','Rua de teste','pf','Locador','desocupado',true)");
  assert.equal(await currentAvailability(), 1);
  await db.exec("delete from public.rentals where name='Disponível novo'");
  assert.equal(await currentAvailability(), 0);
  assert.deepEqual((await db.query(historyQuery)).rows, historyBefore);
  const privileges = await db.query<{ allowed: boolean }>("select has_function_privilege('anon','public.record_rental_availability_month()','execute') or has_function_privilege('authenticated','public.record_rental_availability_month()','execute') as allowed");
  assert.equal(privileges.rows[0].allowed, false);
});
