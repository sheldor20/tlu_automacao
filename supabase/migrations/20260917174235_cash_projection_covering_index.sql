begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

-- The 13-week projection reads only open titles. Keep their aggregation fields
-- together so loading the projection does not scan the entire paid history.
-- These columns also cover the existing RLS publication and department checks.
create index operational_cash_projection_idx
  on public.operational_cash_entries(cash_date)
  include(company_id, work_key, kind, amount, synchronized_at)
  where active and kind in ('receivable', 'payable');

analyze public.operational_cash_entries;
commit;
