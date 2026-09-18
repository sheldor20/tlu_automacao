begin;
set local lock_timeout = '3s';

-- Pure classification: absence of receivables is not evidence of payoff.
create function public.classify_client_contract_financial_status(
 p_ready boolean, p_overdue numeric, p_outstanding numeric, p_undated bigint,
 p_paid_off boolean, p_sale_status text
) returns text language sql immutable security invoker set search_path = '' as $$
 select case
  when not coalesce(p_ready,false) then 'unknown'
  when p_overdue is null or p_outstanding is null or p_undated is null
    or p_overdue < 0 or p_outstanding < 0 or p_undated < 0 then 'unknown'
  when p_overdue >= 0.01 then 'overdue'
  when p_sale_status = 'Cancelado' and p_outstanding >= 0.01 then 'cancelled_balance'
  when p_sale_status = 'Cancelado' then 'cancelled'
  when p_undated > 0 then 'review'
  when p_outstanding >= 0.01 then 'current'
  when p_paid_off is true and p_sale_status = 'Quitada' then 'paid'
  when p_sale_status = 'Normal' then 'current'
  else 'no_balance'
 end;
$$;
revoke all on function public.classify_client_contract_financial_status(boolean,numeric,numeric,bigint,boolean,text) from public, anon;
grant execute on function public.classify_client_contract_financial_status(boolean,numeric,numeric,bigint,boolean,text) to authenticated, service_role;

-- Additive version: old deployments continue to use the unchanged v1 RPC.
create function public.client_status_summary_v2(p_client_ids text[])
returns table(contract_id text, overdue_amount numeric, receivable_amount numeric,
 financial_status text, deed_status text, registration_status text,
 status_synced_at timestamptz, sale_status text)
language plpgsql stable security invoker set search_path = '' as $$
begin
 if coalesce(cardinality(p_client_ids),0)>30 then raise exception 'too_many_clients'; end if;
 return query
 with publication as (
  select exists(select 1 from public.operational_publications p where p.kind='receivable') as ready
 ), balances as (
  select c.id,
   coalesce(sum(e.amount) filter(where e.amount>0),0) as outstanding,
   coalesce(sum(e.amount) filter(where e.amount>0 and e.cash_date<(now() at time zone 'America/Sao_Paulo')::date),0) as overdue,
   count(*) filter(where e.amount>0 and e.cash_date is null) as undated
  from public.client_contracts c
  left join public.operational_cash_entries e on e.contract_id=c.id and e.active and e.kind='receivable'
  where c.client_id=any(p_client_ids)
  group by c.id
 )
 select b.id,b.overdue,b.outstanding,
  public.classify_client_contract_financial_status(p.ready,b.overdue,b.outstanding,b.undated,s.paid_off,s.sale_status),
  s.deed_status,s.registration_status,s.synchronized_at,s.sale_status
 from balances b cross join publication p
 left join public.client_property_statuses s on s.contract_id=b.id;
end $$;
revoke all on function public.client_status_summary_v2(text[]) from public, anon;
grant execute on function public.client_status_summary_v2(text[]) to authenticated, service_role;
comment on function public.client_status_summary_v2(text[]) is 'Financial status with explicit cancelled, cancelled_balance, no_balance and review states. No balance is not proof of payoff. Invoker RLS and the 30-client limit are preserved.';

-- Transactional regression checks: any mismatch rolls back this migration.
do $$
begin
 if exists (
  select 1 from (values
   (false,0::numeric,0::numeric,0::bigint,false,null::text,'unknown'),
   (false,0,0,0,true,'Quitada','unknown'),
   (true,10,100,0,false,'Normal','overdue'),
   (true,10,100,0,true,'Quitada','overdue'),
   (true,10,100,0,false,'Cancelado','overdue'),
   (true,0,100,0,false,'Cancelado','cancelled_balance'),
   (true,0,0,0,false,'Cancelado','cancelled'),
   (true,0,100,1,false,null,'review'),
   (true,0,100,0,false,null,'current'),
   (true,0,0,0,true,'Quitada','paid'),
   (true,0,0,0,false,'Normal','current'),
   (true,0,0,0,false,null,'no_balance'),
   (true,0,0,0,true,null,'no_balance'),
   (true,0,0,0,false,'Quitada','no_balance'),
   (true,null,0,0,false,null,'unknown'),
   (true,0,-1,0,false,null,'unknown'),
   (true,0,0,null,false,null,'unknown'),
   (true,0,0.01,0,false,null,'current')
  ) as x(ready,overdue,outstanding,undated,paid_off,sale_status,expected)
  where public.classify_client_contract_financial_status(x.ready,x.overdue,x.outstanding,x.undated,x.paid_off,x.sale_status) is distinct from x.expected
 ) then raise exception 'client_status_regression_failed'; end if;
 if has_function_privilege('anon','public.client_status_summary_v2(text[])','execute') then
  raise exception 'client_status_anonymous_access';
 end if;
end $$;
notify pgrst,'reload schema';
commit;
