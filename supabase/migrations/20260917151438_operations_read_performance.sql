begin;
set local lock_timeout='3s';
-- Module permission depends on the current user, not on each financial row.
-- Scalar subqueries are evaluated once per statement; row-dependent rules stay.
do $$ declare t text; access_expr text; begin
 foreach t in array array['qlik_companies','qlik_works','client_accounts','client_contracts','operational_cash_entries','collection_cases','client_events','cash_opening_balances','construction_commitments','construction_cost_estimates','cash_reconciliations','construction_stage_finances','construction_stage_mappings'] loop
  access_expr := case
   when t in ('qlik_companies','qlik_works') then '(select public.has_department_access(''financeiro'')) or (select public.has_department_access(''clientes'')) or (select public.has_department_access(''cobranca'')) or (select public.has_department_access(''obras'')) or (select public.has_department_access(''novos-negocios''))'
   when t in ('client_accounts','client_contracts','collection_cases','client_events') then '(select public.has_department_access(''clientes'')) or (select public.has_department_access(''cobranca''))'
   when t='operational_cash_entries' then '(select public.has_department_access(''financeiro'')) or ((select public.has_department_access(''obras'')) and work_key is not null) or (kind in (''receivable'',''received'') and ((select public.has_department_access(''clientes'')) or (select public.has_department_access(''cobranca''))))'
   when t in ('construction_commitments','construction_cost_estimates') then '(select public.has_department_access(''obras'')) or (select public.has_department_access(''financeiro''))'
   when t in ('construction_stage_finances','construction_stage_mappings') then '(select public.has_department_access(''obras''))'
   else '(select public.has_department_access(''financeiro''))' end;
  execute format('alter policy %I on public.%I using (%s)',t||'_read',t,access_expr);
 end loop;
end $$;
commit;
