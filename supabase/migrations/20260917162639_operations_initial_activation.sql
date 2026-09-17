begin;
set local lock_timeout='3s';
create table public.operational_publications(kind text primary key check(kind in ('received','receivable','paid','payable')),published_at timestamptz not null default now());
alter table public.operational_publications enable row level security;
revoke all on public.operational_publications from anon,authenticated;
grant select on public.operational_publications to authenticated;
grant all on public.operational_publications to service_role;
create policy operational_publications_read on public.operational_publications for select to authenticated using (
 (select public.has_department_access('financeiro')) or (select public.has_department_access('obras')) or
 (kind in ('received','receivable') and ((select public.has_department_access('clientes')) or (select public.has_department_access('cobranca'))))
);
insert into public.operational_publications(kind,published_at)
select kind,max(finished_at) from public.operational_imports where status='success' and kind<>'catalog' group by kind;
alter policy operational_cash_entries_read on public.operational_cash_entries using (
 kind=any(array(select kind from public.operational_publications)) and
 ((select public.has_department_access('financeiro')) or ((select public.has_department_access('obras')) and work_key is not null) or
 (kind in ('receivable','received') and ((select public.has_department_access('clientes')) or (select public.has_department_access('cobranca')))))
);
alter table public.operational_imports add column activation_cursor text,add column activation_ready boolean not null default false;
create function public.prepare_initial_operational_publication(p_run uuid,p_batch integer default 2000)
returns boolean language plpgsql security invoker set search_path='' set statement_timeout='55s' as $$
declare r public.operational_imports%rowtype; ids text[];
begin
 if p_batch<1 or p_batch>5000 then raise exception 'invalid_activation_batch'; end if;
 select * into r from public.operational_imports where id=p_run and status='running' for update;
 if not found then raise exception 'import_not_running'; end if;
 if r.kind='catalog' or exists(select 1 from public.operational_publications where kind=r.kind) then return true; end if;
 if r.row_count is null or r.row_count<>r.source_rows or r.total is null or r.source_total is null or abs(r.total-r.source_total)>greatest(0.01,r.row_count*0.000001) then raise exception 'initial_import_not_verified'; end if;
 if r.activation_ready then return true; end if;
 select array_agg(id order by id) into ids from (select id from public.operational_import_rows where run_id=p_run and entity='entries' and (r.activation_cursor is null or id>r.activation_cursor) order by id limit p_batch) x;
 if ids is not null then
  update public.operational_cash_entries set active=true,synchronized_at=now() where id=any(ids) and kind=r.kind and not active;
  update public.operational_imports set activation_cursor=ids[array_length(ids,1)] where id=p_run;
 end if;
 if ids is null or array_length(ids,1)<p_batch then
  update public.operational_imports set activation_ready=true where id=p_run;
  return true;
 end if;
 return false;
end $$;
revoke all on function public.prepare_initial_operational_publication(uuid,integer) from public,anon,authenticated;
grant execute on function public.prepare_initial_operational_publication(uuid,integer) to service_role;
do $$ declare def text; marker text; begin
 def:=pg_get_functiondef('public.publish_operational_import(uuid,integer,numeric)'::regprocedure);
 marker:='if r.kind<>''catalog'' and n=0 then raise exception ''empty_import''; end if;';
 if strpos(def,marker)=0 then raise exception 'publish_definition_changed'; end if;
 def:=replace(def,marker,marker||' if r.kind<>''catalog'' and not exists(select 1 from public.operational_publications where kind=r.kind) and not r.activation_ready then raise exception ''initial_activation_pending''; end if;');
 marker:='update public.operational_imports set status=''success'',finished_at=now(),row_count=n,total=v_total where id=p_run;';
 if strpos(def,marker)=0 then raise exception 'publish_completion_changed'; end if;
 def:=replace(def,marker,'if r.kind<>''catalog'' then insert into public.operational_publications(kind) values(r.kind) on conflict(kind) do update set published_at=now(); end if; '||marker);
 execute def;
 def:=pg_get_functiondef('public.save_collection_case(jsonb,uuid)'::regprocedure);
 marker:='if p_data->>''promise_status''=''fulfilled'' then';
 if strpos(def,marker)=0 then raise exception 'receipt_validation_changed'; end if;
 def:=replace(def,marker,marker||' if not exists(select 1 from public.operational_publications where kind=''received'') then raise exception ''receipt_invalid''; end if;');
 execute def;
end $$;
notify pgrst,'reload schema';
commit;
