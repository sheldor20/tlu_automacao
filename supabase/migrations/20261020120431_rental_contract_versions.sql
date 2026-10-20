begin;
alter table public.rentals
 add column tenant_name text check (char_length(tenant_name)<=500),
 add column due_day integer check (due_day between 1 and 31),
 add column adjustment_index text check (char_length(adjustment_index)<=160),
 add column renewal_terms text check (char_length(renewal_terms)<=3000),
 add column iptu_payer text not null default 'unknown' check (iptu_payer in ('tlu','tenant','shared','unknown')),
 add column iptu_clause text check (char_length(iptu_clause)<=3000);
grant update (tenant_name,due_day,adjustment_index,renewal_terms,iptu_payer,iptu_clause) on public.rentals to authenticated;

create table public.rental_contract_versions (
 id uuid primary key default gen_random_uuid(),
 rental_id uuid not null references public.rentals(id),
 created_at timestamptz not null default clock_timestamp(),
 created_by uuid not null default auth.uid() references auth.users(id),
 files jsonb not null check (jsonb_typeof(files)='array' and jsonb_array_length(files) between 1 and 8),
 snapshot jsonb not null check (jsonb_typeof(snapshot)='object')
);
create index rental_contract_versions_rental on public.rental_contract_versions(rental_id,created_at desc);
alter table public.rental_contract_versions enable row level security;
revoke all on public.rental_contract_versions from public,anon,authenticated;
grant select,insert on public.rental_contract_versions to authenticated;
grant all on public.rental_contract_versions to service_role;
create policy rental_contracts_read on public.rental_contract_versions for select to authenticated
 using ((select public.has_department_access('alugueis')));
create policy rental_contracts_insert on public.rental_contract_versions for insert to authenticated
 with check ((select public.has_department_access('alugueis')) and created_by=(select auth.uid()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('rental-contracts','rental-contracts',false,26214400,array['application/pdf']);
create policy rental_contract_files_read on storage.objects for select to authenticated
 using(bucket_id='rental-contracts' and (select public.has_department_access('alugueis')));
create policy rental_contract_files_insert on storage.objects for insert to authenticated
 with check(bucket_id='rental-contracts' and (select public.has_department_access('alugueis'))
 and exists(select 1 from public.rentals where id::text=split_part(name,'/',1)) and storage.extension(name)='pdf');

create function public.save_rental_contract(p_rental_id uuid,p_expected_updated_at timestamptz,p_contract jsonb,p_files jsonb)
returns uuid language plpgsql security invoker set search_path=''
as $$
declare r public.rentals; version_id uuid;
begin
 if not public.has_department_access('alugueis') then raise exception 'rental_forbidden'; end if;
 select * into r from public.rentals where id=p_rental_id for update;
 if not found then raise exception 'rental_not_found'; end if;
 if p_expected_updated_at is null or r.updated_at<>p_expected_updated_at then raise exception 'rental_conflict'; end if;
 if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) not between 1 and 8 then raise exception 'rental_files_required'; end if;
 if exists(select 1 from jsonb_array_elements(p_files) f where
  coalesce(f->>'name','')='' or char_length(f->>'name')>240 or
  not exists(select 1 from storage.objects o where o.bucket_id='rental-contracts' and o.name=f->>'path'
    and split_part(o.name,'/',1)=p_rental_id::text)) then raise exception 'rental_invalid_file'; end if;
 if jsonb_typeof(p_contract) is distinct from 'object' then raise exception 'rental_invalid_contract'; end if;
 update public.rentals set
  property_address=p_contract->>'property_address', status=(p_contract->>'status')::public.rental_status,
  monthly_rent=(p_contract->>'monthly_rent')::numeric,
  lessor_type=(p_contract->>'lessor_type')::public.lessor_type,lessor_name=p_contract->>'lessor_name',
  lease_start_date=nullif(p_contract->>'lease_start_date','')::date,
  lease_end_date=nullif(p_contract->>'lease_end_date','')::date,
  annual_adjustment_percent=(p_contract->>'annual_adjustment_percent')::numeric,
  tenant_name=nullif(p_contract->>'tenant_name',''),due_day=nullif(p_contract->>'due_day','')::integer,
  adjustment_index=nullif(p_contract->>'adjustment_index',''),renewal_terms=nullif(p_contract->>'renewal_terms',''),
  iptu_payer=coalesce(p_contract->>'iptu_payer','unknown'),iptu_clause=nullif(p_contract->>'iptu_clause',''),
  notes=nullif(p_contract->>'notes','')
 where id=p_rental_id returning * into r;
 insert into public.rental_contract_versions(rental_id,files,snapshot)
 values(p_rental_id,p_files,to_jsonb(r)) returning id into version_id;
 return version_id;
end;
$$;
revoke all on function public.save_rental_contract(uuid,timestamptz,jsonb,jsonb) from public,anon;
grant execute on function public.save_rental_contract(uuid,timestamptz,jsonb,jsonb) to authenticated;


-- Keep Supabase safeupdate enabled; scope replacement to imported rows.
create or replace function public.sync_qlik_rental_receipts(p_rows jsonb,p_started_at timestamptz)
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
  select count(*) into matched from jsonb_array_elements(p_rows) r join public.rentals property on property.qlik_property_id=btrim(r->>'source_code') and property.status='alugado';
  if matched=0 then return jsonb_build_object('matched_rows',0,'source_rows',jsonb_array_length(p_rows),'unmatched_source_rows',jsonb_array_length(p_rows)); end if;
  total_count:=jsonb_array_length(p_rows);
  -- Replace the complete history of currently rented properties only. Preserve histories of former leases.
  delete from public.rental_qlik_receipts where rental_id in (select id from public.rentals where status='alugado');
  insert into public.rental_qlik_receipts(rental_id,reference_month,source_code,received_amount,synchronized_at)
  select property.id,(r->>'reference_month')::date,btrim(r->>'source_code'),(r->>'received_amount')::numeric,sync_time
    from jsonb_array_elements(p_rows) r join public.rentals property on property.qlik_property_id=btrim(r->>'source_code') and property.status='alugado';
  update public.data_connections set last_success_at=sync_time,last_error=null,last_error_at=null,
    settings=jsonb_set(settings,'{snapshot_started_at}',to_jsonb(p_started_at)) where slug='qlik-rental-receipts';
  return jsonb_build_object('matched_rows',matched,'unmatched_source_rows',total_count-matched,'source_rows',total_count);
end;
$$;

commit;
