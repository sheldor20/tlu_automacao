begin;
-- Materialize small validated pages without changing the published financial snapshot.
create function public.stage_operational_entries(p_run uuid,p_rows jsonb) returns void language plpgsql security invoker set search_path='' set statement_timeout='30s' as $$
declare v_kind text;
begin
 select kind into v_kind from public.operational_imports where id=p_run and status='running';
 if v_kind is null or jsonb_array_length(p_rows)>5000 then raise exception 'invalid_import_page'; end if;
 if exists(select 1 from jsonb_array_elements(p_rows) r where r->>'entity'='entries' and r->'data'->>'kind'<>v_kind) then raise exception 'import_kind_mismatch'; end if;
 insert into public.client_accounts(id,name)
 select distinct on (r->>'id') r->>'id',r->'data'->>'name' from jsonb_array_elements(p_rows) r where r->>'entity'='clients' order by r->>'id'
 on conflict(id) do nothing;
 insert into public.client_contracts(id,client_id,company_id,work_key,contract_number,lot,block,status)
 select distinct on (r->>'id') r->>'id',r->'data'->>'client_id',r->'data'->>'company_id',r->'data'->>'work_key',r->'data'->>'contract_number',r->'data'->>'lot',r->'data'->>'block',r->'data'->>'status'
 from jsonb_array_elements(p_rows) r where r->>'entity'='contracts' order by r->>'id'
 on conflict(id) do nothing;
 insert into public.operational_cash_entries(id,company_id,work_key,contract_id,kind,title_key,cash_date,original_due_date,amount,description,counterparty,stage_name,source_category,active)
 select d->>'id',d->>'company_id',d->>'work_key',d->>'contract_id',d->>'kind',d->>'title_key',(d->>'cash_date')::date,(d->>'original_due_date')::date,(d->>'amount')::numeric,coalesce(d->>'description',''),d->>'counterparty',d->>'stage_name',d->>'source_category',false
 from (select r->'data' d from jsonb_array_elements(p_rows) r where r->>'entity'='entries') x
 on conflict(id) do nothing;
end $$;
revoke all on function public.stage_operational_entries(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.stage_operational_entries(uuid,jsonb) to service_role;
do $$ declare def text; start_pos integer; end_pos integer; replacement text; begin
 def:=pg_get_functiondef('public.publish_operational_import(uuid,integer,numeric)'::regprocedure);
 start_pos:=strpos(def,'  update public.operational_cash_entries set active=false where kind=r.kind and active;');
 end_pos:=strpos(def,' end if;'||chr(10)||' update public.cash_reconciliations');
 if start_pos=0 or end_pos=0 then raise exception 'publisher_definition_changed'; end if;
 replacement:=$r$
  if exists(select 1 from public.operational_import_rows s left join public.operational_cash_entries e on e.id=s.id where s.run_id=p_run and s.entity='entries' and (e.id is null or e.amount<>(s.data->>'amount')::numeric)) then raise exception 'import_page_missing'; end if;
  update public.operational_cash_entries e set active=false where e.kind=r.kind and e.active and not exists(select 1 from public.operational_import_rows s where s.run_id=p_run and s.entity='entries' and s.id=e.id);
  update public.operational_cash_entries e set active=true,synchronized_at=now() where e.kind=r.kind and not e.active and exists(select 1 from public.operational_import_rows s where s.run_id=p_run and s.entity='entries' and s.id=e.id);
$r$;
 def:=substring(def from 1 for start_pos-1)||replacement||substring(def from end_pos);
 -- Receivable ownership is current; a historical receipt must not replace it.
 def:=replace(def,'client_id=excluded.client_id,company_id=excluded.company_id','client_id=case when r.kind=''receivable'' then excluded.client_id else public.client_contracts.client_id end,company_id=excluded.company_id');
 execute def;
end $$;
notify pgrst,'reload schema';
commit;
