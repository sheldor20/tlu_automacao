begin;
alter table public.operational_imports
 add column source_revision text,
 add column source_rows integer,
 add column source_total numeric,
 add column continuation_ready boolean not null default false,
 add column lease_started_at timestamptz,
 add column attempts integer not null default 0;

create or replace function public.begin_operational_import(p_kind text) returns uuid
language plpgsql security invoker set search_path='' set statement_timeout='55s' as $$
declare r public.operational_imports%rowtype; v_id uuid;
begin
 perform pg_advisory_xact_lock(hashtext('operational-'||p_kind));
 select * into r from public.operational_imports where kind=p_kind and status='running' order by started_at desc limit 1 for update;
 if found then
  if not r.continuation_ready and coalesce(r.lease_started_at,r.started_at)>now()-interval '15 minutes' then raise exception 'import_busy'; end if;
  if r.attempts>=12 then raise exception 'import_retry_limit'; end if;
  update public.operational_imports set continuation_ready=false,lease_started_at=now(),attempts=attempts+1 where id=r.id;
  return r.id;
 end if;
 insert into public.operational_imports(kind,lease_started_at,attempts) values(p_kind,now(),1) returning id into v_id;
 delete from public.operational_import_rows where run_id in (select id from public.operational_imports where status='error' and started_at<now()-interval '2 days');
 return v_id;
end $$;
create function public.operational_import_progress(p_run uuid)
returns table(rows bigint,total numeric) language sql stable security invoker set search_path='' as $$
 select count(*),coalesce(sum((data->>'amount')::numeric),0) from public.operational_import_rows where run_id=p_run and entity='entries';
$$;
revoke all on function public.operational_import_progress(uuid) from public,anon,authenticated;
grant execute on function public.operational_import_progress(uuid) to service_role;
notify pgrst,'reload schema';
commit;
