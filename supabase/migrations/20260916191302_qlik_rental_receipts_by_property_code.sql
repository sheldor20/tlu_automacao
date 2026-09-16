begin;
create table public.rental_qlik_receipts (
  rental_id uuid not null references public.rentals(id) on delete cascade,
  reference_month date not null check (extract(day from reference_month)=1 and reference_month between date '1900-01-01' and date '9999-12-01'),
  source_code text not null check (char_length(btrim(source_code)) between 1 and 200),
  received_amount numeric(18,2) not null check (received_amount > -1000000000000000 and received_amount < 1000000000000000),
  synchronized_at timestamptz not null,
  primary key (rental_id,reference_month)
);
create index rental_qlik_receipts_month_idx on public.rental_qlik_receipts(reference_month);
alter table public.rental_qlik_receipts enable row level security;
create policy rental_qlik_receipts_read on public.rental_qlik_receipts for select to authenticated
  using ((select public.has_department_access('alugueis')));
revoke all on public.rental_qlik_receipts from public,anon,authenticated;
grant select on public.rental_qlik_receipts to authenticated;
grant all on public.rental_qlik_receipts to service_role;

insert into public.data_connections(slug,provider,name,description,schedule_cron,active,settings)
values ('qlik-rental-receipts','qlik-cloud','Qlik — Recebimentos dos imóveis',
  'Recebimentos por mês: Cód. Imóvel = Cód Unidade Negócio. Rotina diária às 6h30 de Brasília.',
  '30 9 * * *',false,
  '{"app_id":"e3d13862-ec1f-4332-8a5b-df4c7b93fa7c","sheet_id":"bd84bea2-0f3c-4dc6-9081-0eab08502ba3","object_id":"b92ac856-4098-44d8-bc83-a21a48e68db5","property_code_field":"Cód Unidade Negócio","inventory_code_field":"Cód. Imóvel","date_field":"Período","mapping_verified":false}'::jsonb);
create policy rental_receipts_connection_read on public.data_connections for select to authenticated
  using (slug='qlik-rental-receipts' and (select public.has_department_access('alugueis')));

create function public.sync_qlik_rental_receipts(p_rows jsonb,p_started_at timestamptz)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare matched integer; total_count integer; previous_start timestamptz; sync_time timestamptz:=clock_timestamp();
begin
  if current_user<>'service_role' then raise exception 'rental_sync_server_only'; end if;
  -- Shared lock prevents inventory updates from changing the joins during a receipt load.
  perform pg_advisory_xact_lock(hashtextextended('qlik-rental-inventory',0));
  if not exists(select 1 from public.data_connections where slug='qlik-rental-receipts' and active and settings->>'mapping_verified'='true') then raise exception 'rental_mapping_not_verified'; end if;
  if not exists(select 1 from public.data_connections where slug='qlik-rental-inventory' and last_success_at is not null) then raise exception 'rental_inventory_required'; end if;
  if p_started_at is null or p_started_at>sync_time+interval '5 minutes' then raise exception 'invalid_rental_sync_time'; end if;
  select (settings->>'snapshot_started_at')::timestamptz into previous_start from public.data_connections where slug='qlik-rental-receipts';
  if previous_start is not null and p_started_at<=previous_start then raise exception 'stale_rental_snapshot'; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then raise exception 'empty_receipts_snapshot'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where coalesce(char_length(btrim(r->>'source_code')),0) not between 1 and 200
    or r->>'reference_month' is null or r->>'received_amount' is null or jsonb_typeof(r->'received_amount')<>'number') then raise exception 'invalid_receipt_source_row'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r group by btrim(r->>'source_code'),(r->>'reference_month')::date having count(*)>1) then raise exception 'duplicate_receipt_source_month'; end if;
  select count(*) into matched from jsonb_array_elements(p_rows) r join public.rentals property on property.qlik_property_id=btrim(r->>'source_code');
  if matched=0 then raise exception 'no_matching_property_codes'; end if;
  total_count:=jsonb_array_length(p_rows);
  -- Full, reconciled source snapshots replace previous imports atomically.
  delete from public.rental_qlik_receipts;
  insert into public.rental_qlik_receipts(rental_id,reference_month,source_code,received_amount,synchronized_at)
  select property.id,(r->>'reference_month')::date,btrim(r->>'source_code'),(r->>'received_amount')::numeric,sync_time
    from jsonb_array_elements(p_rows) r join public.rentals property on property.qlik_property_id=btrim(r->>'source_code');
  update public.data_connections set last_success_at=sync_time,last_error=null,last_error_at=null,
    settings=jsonb_set(settings,'{snapshot_started_at}',to_jsonb(p_started_at)) where slug='qlik-rental-receipts';
  return jsonb_build_object('matched_rows',matched,'unmatched_source_rows',total_count-matched,'source_rows',total_count);
end;
$$;
revoke all on function public.sync_qlik_rental_receipts(jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.sync_qlik_rental_receipts(jsonb,timestamptz) to service_role;

create function public.rental_qlik_receipt_totals(p_year integer,p_rental_id uuid default null)
returns table(reference_month date,received_amount numeric,property_count bigint)
language sql stable security invoker set search_path = ''
as $$
  select r.reference_month,sum(r.received_amount),count(*) from public.rental_qlik_receipts r
  where r.reference_month>=make_date(p_year,1,1) and r.reference_month<=make_date(p_year,12,1)
    and (p_rental_id is null or r.rental_id=p_rental_id)
  group by r.reference_month order by r.reference_month;
$$;
revoke all on function public.rental_qlik_receipt_totals(integer,uuid) from public,anon;
grant execute on function public.rental_qlik_receipt_totals(integer,uuid) to authenticated;
comment on table public.rental_qlik_receipts is 'Recebimentos importados da fonte financeira Qlik. Separados dos lançamentos manuais para não somar o mesmo recebimento duas vezes.';
commit;
