begin;
create or replace function public.publish_operational_import(p_run uuid,p_count integer,p_total numeric) returns void language plpgsql security invoker set search_path='' as $$
declare r public.operational_imports%rowtype; n integer; v_total numeric;
begin
 select * into r from public.operational_imports where id=p_run and status='running' for update;
 if not found then raise exception 'import_not_running'; end if;
 select count(*),coalesce(sum((data->>'amount')::numeric),0) into n,v_total from public.operational_import_rows where run_id=p_run and entity='entries';
 if n<>p_count or abs(v_total-p_total)>0.01 then raise exception 'import_not_reconciled'; end if;
 if r.kind<>'catalog' and n=0 then raise exception 'empty_import'; end if;
 insert into public.qlik_companies(id,name,company_key) select data->>'id',data->>'name',data->>'company_key' from public.operational_import_rows where run_id=p_run and entity='companies'
 on conflict(id) do update set name=excluded.name,company_key=excluded.company_key,synchronized_at=now();
 if r.kind='catalog' then update public.qlik_works set active=false; end if;
 insert into public.qlik_works(key,company_id,work_id,name,active) select data->>'key',data->>'company_id',data->>'work_id',data->>'name',coalesce((data->>'active')::boolean,true) from public.operational_import_rows where run_id=p_run and entity='works'
 on conflict(key) do update set company_id=excluded.company_id,work_id=excluded.work_id,name=excluded.name,active=excluded.active,synchronized_at=now();
 insert into public.client_accounts(id,name) select data->>'id',data->>'name' from public.operational_import_rows where run_id=p_run and entity='clients'
 on conflict(id) do update set name=excluded.name,synchronized_at=now();
 insert into public.client_contracts(id,client_id,company_id,work_key,contract_number,lot,block,status)
 select data->>'id',data->>'client_id',data->>'company_id',data->>'work_key',data->>'contract_number',data->>'lot',data->>'block',data->>'status'
 from public.operational_import_rows where run_id=p_run and entity='contracts'
 on conflict(id) do update set client_id=excluded.client_id,company_id=excluded.company_id,work_key=excluded.work_key,contract_number=excluded.contract_number,lot=excluded.lot,block=excluded.block,status=excluded.status,synchronized_at=now();
 if r.kind<>'catalog' then
  if exists(select 1 from public.operational_import_rows where run_id=p_run and entity='entries' and data->>'kind'<>r.kind) then raise exception 'import_kind_mismatch'; end if;
  update public.operational_cash_entries set active=false where kind=r.kind and active;
  insert into public.operational_cash_entries(id,company_id,work_key,contract_id,kind,title_key,cash_date,original_due_date,amount,description,counterparty,stage_name,source_category)
  select data->>'id',data->>'company_id',data->>'work_key',data->>'contract_id',data->>'kind',data->>'title_key',(data->>'cash_date')::date,(data->>'original_due_date')::date,(data->>'amount')::numeric,coalesce(data->>'description',''),data->>'counterparty',data->>'stage_name',data->>'source_category'
  from public.operational_import_rows where run_id=p_run and entity='entries'
  on conflict(id) do update set company_id=excluded.company_id,work_key=excluded.work_key,contract_id=excluded.contract_id,kind=excluded.kind,title_key=excluded.title_key,cash_date=excluded.cash_date,original_due_date=excluded.original_due_date,amount=excluded.amount,description=excluded.description,counterparty=excluded.counterparty,stage_name=excluded.stage_name,source_category=excluded.source_category,active=true,synchronized_at=now();
 end if;
 update public.cash_reconciliations cr set cash_entry_id=x.next_id,updated_at=now()
 from (select old.id,min(fresh.id) next_id from public.operational_cash_entries old join public.operational_cash_entries fresh on fresh.title_key=old.title_key and fresh.company_id=old.company_id and fresh.amount=old.amount and fresh.active and fresh.kind in ('paid','payable') where not old.active and old.id in (select cash_entry_id from public.cash_reconciliations where cash_entry_id is not null union select cash_entry_id from public.construction_commitments where cash_entry_id is not null) group by old.id having count(*)=1) x
 where cr.cash_entry_id=x.id;
 update public.construction_commitments cc set cash_entry_id=x.next_id
 from (select old.id,min(fresh.id) next_id from public.operational_cash_entries old join public.operational_cash_entries fresh on fresh.title_key=old.title_key and fresh.company_id=old.company_id and fresh.amount=old.amount and fresh.active and fresh.kind in ('paid','payable') where not old.active and old.id in (select cash_entry_id from public.cash_reconciliations where cash_entry_id is not null union select cash_entry_id from public.construction_commitments where cash_entry_id is not null) group by old.id having count(*)=1) x
 where cc.cash_entry_id=x.id;
 update public.operational_imports set status='success',finished_at=now(),row_count=n,total=v_total where id=p_run;
 update public.data_connections set last_success_at=now(),last_error=null,last_error_at=null,settings=settings||jsonb_build_object(r.kind,jsonb_build_object('at',now(),'rows',n,'total',v_total),'mapping_verified',true) where slug='qlik-operations';
 delete from public.operational_import_rows where run_id=p_run;
end $$;
create index operational_cash_title_idx on public.operational_cash_entries(title_key,company_id,amount) where active;

-- Evaluate module grants once per query rather than once per financial row.
do $$ declare r record; expr text; begin
 for r in select tablename,policyname,qual from pg_policies where schemaname='public' and tablename in ('qlik_companies','qlik_works','client_accounts','client_contracts','operational_cash_entries','collection_cases','client_events','cash_opening_balances','construction_commitments','construction_cost_estimates','cash_reconciliations','construction_stage_finances','construction_stage_mappings') loop
  expr:=regexp_replace(r.qual,'has_department_access\(([^)]*)\)','(select public.has_department_access(\1))','g');
  execute format('alter policy %I on public.%I using (%s)',r.policyname,r.tablename,expr);
 end loop;
end $$;

commit;
