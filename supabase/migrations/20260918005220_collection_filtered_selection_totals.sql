-- Additive read-only totals; keep the legacy RPC for existing deployments.
create function public.collection_worklist_filtered_totals(
  p_company text default '',
  p_query text default ''
)
returns table(
  collection_group text,
  contracts bigint,
  amount numeric,
  promises bigint,
  installments bigint
)
language plpgsql stable security invoker set search_path = ''
as $$
begin
  if length(coalesce(p_company, '')) > 200 or length(coalesce(p_query, '')) > 200 then
    raise exception 'invalid_collection_filters' using errcode = '22023';
  end if;
  return query
    select w.collection_group,
      count(*),
      coalesce(sum(w.overdue_amount), 0),
      count(*) filter (where w.promise_overdue),
      coalesce(sum(w.overdue_count), 0)::bigint
    from public.collection_worklist w
    where (coalesce(p_company, '') = '' or w.company_id = p_company)
      and (coalesce(p_query, '') = ''
        or w.client_name ilike '%' || p_query || '%'
        or w.contract_number ilike '%' || p_query || '%'
        or w.lot ilike '%' || p_query || '%')
    group by w.collection_group;
end;
$$;
revoke all on function public.collection_worklist_filtered_totals(text,text) from public, anon;
grant execute on function public.collection_worklist_filtered_totals(text,text) to authenticated, service_role;
comment on function public.collection_worklist_filtered_totals(text,text) is
  'Collection totals by group across every page, filtered like the worklist and subject to caller RLS.';
