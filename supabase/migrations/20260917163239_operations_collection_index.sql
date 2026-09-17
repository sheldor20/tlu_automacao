begin;
set local lock_timeout='5s';
set local statement_timeout='600s';
set local work_mem='16MB';
set local maintenance_work_mem='64MB';
-- Complete an already-reconciled first history without maintaining secondary
-- indexes row by row. This transaction retains the primary key, foreign keys,
-- access rules and the publication gate throughout.
do $$ declare r public.operational_imports%rowtype; begin
 select * into r from public.operational_imports
 where kind='received' and status='running' and row_count=source_rows and row_count>0
 and total is not null and source_total is not null
 and abs(total-source_total)<=greatest(0.01,row_count*0.000001)
 and not exists(select 1 from public.operational_publications where kind='received')
 for update;
 if found then
  drop index public.operational_cash_company_date_idx;
  drop index public.operational_cash_work_idx;
  drop index public.operational_cash_contract_idx;
  drop index public.operational_cash_title_idx;
  update public.operational_cash_entries set active=true,synchronized_at=now() where kind='received' and not active;
  create index operational_cash_company_date_idx on public.operational_cash_entries(company_id,cash_date) where active;
  create index operational_cash_work_idx on public.operational_cash_entries(work_key) where active;
  create index operational_cash_contract_idx on public.operational_cash_entries(contract_id) where active;
  create index operational_cash_title_idx on public.operational_cash_entries(title_key,company_id,amount) where active;
  update public.operational_imports set activation_ready=true where id=r.id;
  perform public.publish_operational_import(r.id,r.row_count,r.total);
 end if;
end $$;
create index if not exists operational_cash_client_summary_idx
 on public.operational_cash_entries(contract_id)
 include(kind,cash_date,original_due_date,amount,work_key)
 where active and kind in ('receivable','received');
analyze public.operational_cash_entries;
commit;
