begin;

-- IR é opcional por competência; históricos existentes ficam com retenção zero.
alter table public.rental_receipts add column income_tax numeric(15,2) not null default 0
  check (income_tax >= 0 and income_tax < 10000000000000);
drop function public.rental_receipt_monthly_totals(integer);
alter table public.rental_receipts drop column net_received;
alter table public.rental_receipts add column net_received numeric(16,2) generated always as
  (rent_received + fines + reimbursements - administration_fee - reserve_fund - property_tax - income_tax) stored;
create function public.rental_receipt_monthly_totals(p_year integer)
returns table (reference_month date, receipt_count bigint, rent_received numeric,
  administration_fee numeric, reserve_fund numeric, fines numeric, reimbursements numeric,
  property_tax numeric, income_tax numeric, net_received numeric)
language sql stable security invoker set search_path = ''
as $$
  select r.reference_month, count(*), sum(r.rent_received), sum(r.administration_fee),
    sum(r.reserve_fund), sum(r.fines), sum(r.reimbursements), sum(r.property_tax), sum(r.income_tax), sum(r.net_received)
  from public.rental_receipts r
  where r.reference_month >= make_date(p_year,1,1) and r.reference_month <= make_date(p_year,12,1)
  group by r.reference_month order by r.reference_month;
$$;
revoke all on function public.rental_receipt_monthly_totals(integer) from public, anon;
grant execute on function public.rental_receipt_monthly_totals(integer) to authenticated;

alter table public.rentals
  add column property_type text check (property_type is null or char_length(btrim(property_type)) between 1 and 120),
  add column rentable boolean,
  add column qlik_property_id text unique check (qlik_property_id is null or char_length(btrim(qlik_property_id)) between 1 and 200),
  add column qlik_synced_at timestamptz,
  add column qlik_present boolean,
  alter column created_by drop not null;

-- Cadastro, exclusão e nome pertencem à origem; usuários editam o contrato e a operação.
drop policy rentals_department_access on public.rentals;
create policy rentals_read on public.rentals for select to authenticated
  using ((select public.has_department_access('alugueis')));
create policy rentals_update on public.rentals for update to authenticated
  using ((select public.has_department_access('alugueis')))
  with check ((select public.has_department_access('alugueis')));
revoke all on public.rentals from public, anon, authenticated;
grant select on public.rentals to authenticated;
grant update (property_address,status,monthly_rent,lessor_type,lessor_name,lease_start_date,
  lease_end_date,annual_adjustment_percent,notes,property_type,rentable) on public.rentals to authenticated;
grant select,insert,update,delete on public.rentals to service_role;

insert into public.data_connections(slug,provider,name,description,schedule_cron,active,settings)
values ('qlik-rental-inventory','qlik-cloud','Qlik — Carteira de imóveis',
  'Atualização diária às 6h de Brasília. Aguardando validação do código estável, nome e vínculo dos imóveis existentes.',
  '0 9 * * *',false,
  '{"app_id":"5073ca65-2740-43d7-9688-70b76e124382","sheet_id":"14e708cf-cef9-49a2-8e26-71fe61bed660","mapping_verified":false,"property_details_source":"manual","id_column":"Cód. Imóvel"}'::jsonb);
create policy rental_inventory_connection_read on public.data_connections for select to authenticated
  using (slug='qlik-rental-inventory' and (select public.has_department_access('alugueis')));

create function public.sync_qlik_rental_inventory(p_rows jsonb, p_started_at timestamptz)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  item jsonb;
  local_id uuid;
  candidates uuid[];
  linked_source text;
  sync_time timestamptz := clock_timestamp();
  previous_start timestamptz;
  updated_count integer := 0;
  created_count integer := 0;
begin
  if current_user <> 'service_role' then raise exception 'rental_sync_server_only'; end if;
  perform pg_advisory_xact_lock(hashtextextended('qlik-rental-inventory',0));
  if not exists (select 1 from public.data_connections where slug='qlik-rental-inventory'
    and active and settings->>'mapping_verified'='true') then raise exception 'rental_mapping_not_verified'; end if;
  if p_started_at is null or p_started_at > sync_time + interval '5 minutes' then raise exception 'invalid_rental_sync_time'; end if;
  select (settings->>'snapshot_started_at')::timestamptz into previous_start
    from public.data_connections where slug='qlik-rental-inventory';
  if previous_start is not null and p_started_at <= previous_start then raise exception 'stale_rental_snapshot'; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then raise exception 'empty_rental_snapshot'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r group by btrim(r->>'source_id') having count(*)>1)
    then raise exception 'duplicate_rental_source_id'; end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    if coalesce(char_length(btrim(item->>'source_id')),0) not between 1 and 200
      or coalesce(char_length(btrim(item->>'name')),0) not between 2 and 140 then raise exception 'invalid_rental_source_row'; end if;
    if item ? 'rentable' and jsonb_typeof(item->'rentable') <> 'boolean' then raise exception 'invalid_rental_rentable'; end if;
    select id into local_id from public.rentals where qlik_property_id=btrim(item->>'source_id');
    if item ? 'existing_rental_id' then
      if local_id is not null and local_id<>(item->>'existing_rental_id')::uuid then raise exception 'rental_mapping_conflict'; end if;
      select qlik_property_id into linked_source from public.rentals where id=(item->>'existing_rental_id')::uuid;
      if not found or (linked_source is not null and linked_source<>btrim(item->>'source_id')) then raise exception 'rental_mapping_conflict'; end if;
      local_id := (item->>'existing_rental_id')::uuid;
    end if;
    if local_id is null then
      select array_agg(id) into candidates from public.rentals
        where qlik_property_id is null and lower(btrim(name))=lower(btrim(item->>'name'));
      if coalesce(array_length(candidates,1),0)>1 then raise exception 'ambiguous_rental_legacy_match'; end if;
      if array_length(candidates,1)=1 then
        if (select count(*) from jsonb_array_elements(p_rows) r where lower(btrim(r->>'name'))=lower(btrim(item->>'name')))>1
          then raise exception 'ambiguous_rental_legacy_match'; end if;
        local_id := candidates[1];
      end if;
    end if;
    if local_id is null then
      insert into public.rentals(name,property_address,lessor_type,lessor_name,qlik_property_id,qlik_present,qlik_synced_at,property_type,rentable)
      values (btrim(item->>'name'),'A informar','pf','A definir',btrim(item->>'source_id'),true,sync_time,
        item->>'property_type',(item->>'rentable')::boolean) returning id into local_id;
      created_count := created_count+1;
    else
      update public.rentals set name=btrim(item->>'name'),qlik_property_id=btrim(item->>'source_id'),qlik_present=true,qlik_synced_at=sync_time,
        property_type=case when item ? 'property_type' then item->>'property_type' else property_type end,
        rentable=case when item ? 'rentable' then (item->>'rentable')::boolean else rentable end
      where id=local_id;
      updated_count := updated_count+1;
    end if;
  end loop;
  -- Never silently create a second copy of a historical property under a different name.
  if exists(select 1 from public.rentals where qlik_property_id is null) then raise exception 'rental_legacy_mapping_required'; end if;
  update public.rentals set qlik_present=false where qlik_property_id is not null
    and not exists(select 1 from jsonb_array_elements(p_rows) r where btrim(r->>'source_id')=qlik_property_id);
  update public.data_connections set last_success_at=sync_time,last_error=null,last_error_at=null,
    settings=jsonb_set(settings,'{snapshot_started_at}',to_jsonb(p_started_at)) where slug='qlik-rental-inventory';
  return jsonb_build_object('created',created_count,'updated',updated_count,'source_count',jsonb_array_length(p_rows));
end;
$$;
revoke all on function public.sync_qlik_rental_inventory(jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.sync_qlik_rental_inventory(jsonb,timestamptz) to service_role;

comment on column public.rentals.rentable is 'Permissão para locação, independente da ocupação atual. NULL significa ainda não informado.';
comment on column public.rental_receipts.income_tax is 'IR retido no recebimento mensal, em reais.';
commit;
