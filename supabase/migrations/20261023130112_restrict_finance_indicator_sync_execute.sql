begin;
revoke execute on function public.sync_qlik_finance_indicators(jsonb,text,date)
  from public,anon,authenticated;
grant execute on function public.sync_qlik_finance_indicators(jsonb,text,date)
  to service_role;
commit;