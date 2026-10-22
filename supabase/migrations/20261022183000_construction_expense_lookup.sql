-- Resolve each linked key before looking up movements, so RLS does not cause
-- a scan of the entire cash-entry index for every construction.
create index if not exists operational_cash_construction_expense_idx
on public.operational_cash_entries(work_key,kind)
include(amount,cash_date,source_category)
where active and kind in ('paid','payable');

create or replace view public.construction_qlik_expense_summary
with (security_invoker = true) as
select c.id as construction_id, expense.realized_total,
  expense.realized_current_month, expense.payable_total
from public.constructions c
left join lateral (
  select
    sum(e.amount) filter (where e.kind='paid') as realized_total,
    sum(e.amount) filter (where e.kind='paid' and
      date_trunc('month',e.cash_date)=date_trunc('month',timezone('America/Sao_Paulo',now()))) as realized_current_month,
    sum(e.amount) filter (where e.kind='payable') as payable_total
  from (
    select distinct key from unnest(array_prepend(c.qlik_work_key,
      coalesce(c.qlik_additional_work_keys,'{}'::text[]))) as linked(key)
    where key is not null
  ) linked
  join public.operational_cash_entries e on e.work_key=linked.key
  where e.active and e.kind in ('paid','payable')
    and public.is_construction_renovation(e.source_category)
    and e.kind in (select p.kind from public.operational_publications p)
) expense on true;
