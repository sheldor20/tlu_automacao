begin;

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
  select count(*) into matched from jsonb_array_elements(p_rows) r join public.rentals property on property.qlik_property_id=btrim(r->>'source_code');
  if matched=0 then raise exception 'no_matching_property_codes'; end if;
  total_count:=jsonb_array_length(p_rows);
  -- Full, reconciled source snapshots replace previous imports atomically.
  delete from public.rental_qlik_receipts where rental_id is not null;
  insert into public.rental_qlik_receipts(rental_id,reference_month,source_code,received_amount,synchronized_at)
  select property.id,(r->>'reference_month')::date,btrim(r->>'source_code'),(r->>'received_amount')::numeric,sync_time
    from jsonb_array_elements(p_rows) r join public.rentals property on property.qlik_property_id=btrim(r->>'source_code');
  update public.data_connections set last_success_at=sync_time,last_error=null,last_error_at=null,
    settings=jsonb_set(settings,'{snapshot_started_at}',to_jsonb(p_started_at)) where slug='qlik-rental-receipts';
  return jsonb_build_object('matched_rows',matched,'unmatched_source_rows',total_count-matched,'source_rows',total_count);
end;
$$;

commit;
