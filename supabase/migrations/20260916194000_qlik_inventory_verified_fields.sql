begin;

-- Verified source-owned fields cannot be changed by client requests.
revoke update (property_type,rentable) on public.rentals from authenticated;

create or replace function public.sync_qlik_rental_inventory(p_rows jsonb, p_started_at timestamptz)
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
  -- Only explicitly reviewed legacy contracts may remain pending. No fuzzy matching.
  if exists(select 1 from public.rentals r where r.qlik_property_id is null
    and not exists(select 1 from public.data_connections c,
      jsonb_array_elements_text(coalesce(c.settings->'pending_legacy_ids', '[]'::jsonb)) pending(id)
      where c.slug='qlik-rental-inventory' and pending.id=r.id::text))
    then raise exception 'rental_legacy_mapping_required'; end if;
  update public.rentals set qlik_present=false where qlik_property_id is not null
    and not exists(select 1 from jsonb_array_elements(p_rows) r where btrim(r->>'source_id')=qlik_property_id);
  update public.data_connections set last_success_at=sync_time,last_error=null,last_error_at=null,
    settings=jsonb_set(settings,'{snapshot_started_at}',to_jsonb(p_started_at)) where slug='qlik-rental-inventory';
  return jsonb_build_object('created',created_count,'updated',updated_count,'source_count',jsonb_array_length(p_rows),'pending_contracts',(select count(*) from public.rentals where qlik_property_id is null));
end;
$$;

commit;
