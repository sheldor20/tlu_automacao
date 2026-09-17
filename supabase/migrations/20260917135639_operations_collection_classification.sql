begin;
-- Financial prioritization works immediately; unknown legal status remains unknown.
create or replace view public.collection_worklist with(security_invoker=true) as
select f.*,case
 when overdue_count=0 then 'current'
 when c.legal_status in ('judicial','suspended') then 'judicial'
 when overdue_count<=2 and last_receipt>latest_due and coalesce(c.promise_status,'none')<>'broken' and not(coalesce(c.promise_status,'none')='open' and c.promise_date<(now() at time zone 'America/Sao_Paulo')::date) then 'easy'
 when oldest_due>=(now() at time zone 'America/Sao_Paulo')::date-90 and last_receipt is not null and coalesce(c.promise_status,'none')<>'broken' and not(coalesce(c.promise_status,'none')='open' and c.promise_date<(now() at time zone 'America/Sao_Paulo')::date) then 'negotiation'
 else 'difficult' end as collection_group,
 coalesce(c.promise_status='open' and c.promise_date<(now() at time zone 'America/Sao_Paulo')::date,false) as promise_overdue
from public.client_contract_financials f left join public.collection_cases c on c.contract_id=f.id;
notify pgrst,'reload schema';
commit;
