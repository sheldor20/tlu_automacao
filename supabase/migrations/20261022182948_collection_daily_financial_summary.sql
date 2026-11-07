begin;
set local statement_timeout='120s';
create table public.collection_financial_summary as
select contract_id,
 sum(amount) filter(where kind='receivable' and amount>0 and cash_date<(now() at time zone 'America/Sao_Paulo')::date) as overdue_amount,
 count(*) filter(where kind='receivable' and amount>0 and cash_date<(now() at time zone 'America/Sao_Paulo')::date) as overdue_count,
 min(coalesce(original_due_date,cash_date)) filter(where kind='receivable' and amount>0 and cash_date<(now() at time zone 'America/Sao_Paulo')::date) as oldest_due,
 max(coalesce(original_due_date,cash_date)) filter(where kind='receivable' and amount>0 and cash_date<(now() at time zone 'America/Sao_Paulo')::date) as latest_due,
 max(cash_date) filter(where kind='received') as last_receipt,
 sum(amount) filter(where kind='received') as received_amount,
 sum(amount) filter(where kind='receivable') as receivable_amount
 from public.operational_cash_entries where active and contract_id is not null and kind in ('receivable','received') and kind in (select kind from public.operational_publications) group by contract_id;
alter table public.collection_financial_summary add primary key(contract_id);
alter table public.collection_financial_summary enable row level security;
revoke all on public.collection_financial_summary from public,anon,authenticated;
grant select on public.collection_financial_summary to authenticated;
grant all on public.collection_financial_summary to service_role;
create policy collection_financial_summary_read on public.collection_financial_summary
for select to authenticated using ((select public.has_department_access('clientes')) or (select public.has_department_access('cobranca')));
create schema if not exists private;
create function private.refresh_collection_financial_summary() returns void
language plpgsql security invoker set search_path=public,pg_temp set statement_timeout='120s' as $$
begin
 if not pg_try_advisory_xact_lock(hashtext('collection_financial_summary')) then return; end if;
 -- MVCC keeps the previous complete summary visible until this transaction commits.
 delete from public.collection_financial_summary;
 insert into public.collection_financial_summary
select contract_id,
 sum(amount) filter(where kind='receivable' and amount>0 and cash_date<(now() at time zone 'America/Sao_Paulo')::date) as overdue_amount,
 count(*) filter(where kind='receivable' and amount>0 and cash_date<(now() at time zone 'America/Sao_Paulo')::date) as overdue_count,
 min(coalesce(original_due_date,cash_date)) filter(where kind='receivable' and amount>0 and cash_date<(now() at time zone 'America/Sao_Paulo')::date) as oldest_due,
 max(coalesce(original_due_date,cash_date)) filter(where kind='receivable' and amount>0 and cash_date<(now() at time zone 'America/Sao_Paulo')::date) as latest_due,
 max(cash_date) filter(where kind='received') as last_receipt,
 sum(amount) filter(where kind='received') as received_amount,
 sum(amount) filter(where kind='receivable') as receivable_amount
 from public.operational_cash_entries where active and contract_id is not null and kind in ('receivable','received') and kind in (select kind from public.operational_publications) group by contract_id;
end;
$$;
revoke all on function private.refresh_collection_financial_summary() from public,anon,authenticated,service_role;
create or replace view public.client_contract_financials with(security_invoker=true) as
select c.*,a.name as client_name,a.phone,a.email,
coalesce(f.overdue_amount,0) as overdue_amount,coalesce(f.overdue_count,0) as overdue_count,
f.oldest_due,f.latest_due,f.last_receipt,coalesce(f.received_amount,0) as received_amount,coalesce(f.receivable_amount,0) as receivable_amount
from public.client_contracts c join public.client_accounts a on a.id=c.client_id
left join public.collection_financial_summary f on f.contract_id=c.id;
create extension if not exists pg_cron;
select cron.schedule('collection-financial-summary-daily','15 10 * * *','select private.refresh_collection_financial_summary()');
notify pgrst,'reload schema';
commit;
