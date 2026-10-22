-- One published Qlik expense scope for every construction indicator.
create or replace function public.is_construction_renovation(category text)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select coalesce(lower(category) ~ '(^|[^a-z0-9])reformas($|[^a-z0-9])'
    or category ~ '(^|[^0-9.])9[.]118($|[.][0-9]|[^0-9.])', false)
$$;

create or replace view public.construction_qlik_expense_summary
with (security_invoker = true) as
select c.id as construction_id,
  sum(e.amount) filter (where e.kind = 'paid') as realized_total,
  sum(e.amount) filter (where e.kind = 'paid' and
    date_trunc('month', e.cash_date) = date_trunc('month', timezone('America/Sao_Paulo', now()))) as realized_current_month,
  sum(e.amount) filter (where e.kind = 'payable') as payable_total
from public.constructions c
left join public.operational_cash_entries e on
  e.work_key = any(array_remove(array_prepend(c.qlik_work_key, coalesce(c.qlik_additional_work_keys, '{}'::text[])), null))
  and e.active and e.kind in ('paid','payable')
  and public.is_construction_renovation(e.source_category)
  and e.kind in (select p.kind from public.operational_publications p)
group by c.id;
revoke all on public.construction_qlik_expense_summary from anon;
grant select on public.construction_qlik_expense_summary to authenticated, service_role;

-- Preserve the view's column order, permissions and all physical/schedule fields.
do $$
declare old_definition text; projection text;
begin
  old_definition := regexp_replace(pg_get_viewdef('public.construction_progress_summary'::regclass, true), ';\s*$', '');
  select string_agg(case when a.attname in ('realized_total','realized_current_month')
    then format('expense.%I', a.attname) else format('old.%I', a.attname) end, ', ' order by a.attnum)
  into projection from pg_attribute a
  where a.attrelid = 'public.construction_progress_summary'::regclass and a.attnum > 0 and not a.attisdropped;
  execute 'create or replace view public.construction_progress_summary with (security_invoker=true) as select '
    || projection || ' from (' || old_definition || ') old left join public.construction_qlik_expense_summary expense on expense.construction_id=old.id';
end $$;

-- Retain the existing Indicators authorization and physical-progress calculation.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.management_construction_snapshot()'::regprocedure);
  if position('sum(item.realized_amount)' in definition) = 0 then
    raise exception 'Unexpected construction snapshot definition';
  end if;
  definition := replace(definition,
    'select item.construction_id, sum(item.realized_amount) as realized',
    'select item.construction_id, item.realized_total as realized');
  definition := replace(definition, 'from public.construction_budgets item', 'from public.construction_qlik_expense_summary item');
  definition := replace(definition, 'group by item.construction_id', '');
  definition := replace(definition, 'coalesce(budget.realized, 0)', 'budget.realized');
  definition := replace(definition, 'else 0', 'else null');
  execute definition;
end $$;
