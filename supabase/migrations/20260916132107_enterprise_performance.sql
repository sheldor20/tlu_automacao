begin;

create table public.enterprise_performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  captured_at timestamptz not null default now(),
  as_of date not null,
  source text not null default 'Qlik Cloud — Financeiro',
  metadata jsonb not null default '{}'::jsonb
);
create index enterprise_performance_latest_idx on public.enterprise_performance_snapshots (captured_at desc, id);

create table public.enterprise_performance_companies (
  snapshot_id uuid not null references public.enterprise_performance_snapshots(id) on delete cascade,
  company_key text not null check (length(company_key) between 1 and 500),
  name text not null check (length(btrim(name)) between 1 and 500),
  primary key (snapshot_id, company_key)
);
create table public.enterprise_performance_flows (
  snapshot_id uuid not null,
  company_key text not null,
  cash_date date,
  kind text not null check (kind in ('received','paid','receivable','payable')),
  amount numeric(20,2) not null check (amount between -1000000000000000 and 1000000000000000),
  foreign key (snapshot_id, company_key) references public.enterprise_performance_companies(snapshot_id, company_key) on delete cascade,
  unique nulls not distinct (snapshot_id, company_key, cash_date, kind)
);
create index enterprise_performance_date_idx on public.enterprise_performance_flows (snapshot_id, cash_date);

alter table public.enterprise_performance_snapshots enable row level security;
alter table public.enterprise_performance_companies enable row level security;
alter table public.enterprise_performance_flows enable row level security;

create policy enterprise_performance_snapshot_read on public.enterprise_performance_snapshots
for select to authenticated using ((select public.has_department_access('novos-negocios')));
create policy enterprise_performance_company_read on public.enterprise_performance_companies
for select to authenticated using ((select public.has_department_access('novos-negocios')));
create policy enterprise_performance_flow_read on public.enterprise_performance_flows
for select to authenticated using ((select public.has_department_access('novos-negocios')));

revoke all on public.enterprise_performance_snapshots, public.enterprise_performance_companies, public.enterprise_performance_flows from anon, authenticated;
grant select on public.enterprise_performance_snapshots, public.enterprise_performance_companies, public.enterprise_performance_flows to authenticated;
grant all on public.enterprise_performance_snapshots, public.enterprise_performance_companies, public.enterprise_performance_flows to service_role;

create function public.sync_enterprise_performance(p_as_of date, p_companies jsonb, p_flows jsonb, p_metadata jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  if p_companies is null or p_flows is null or p_metadata is null
    or jsonb_typeof(p_companies) <> 'array' or jsonb_array_length(p_companies) = 0
    or jsonb_typeof(p_flows) <> 'array' or jsonb_typeof(p_metadata) <> 'object'
    or p_as_of is null then raise exception 'invalid_performance_snapshot'; end if;
  perform pg_advisory_xact_lock(hashtext('enterprise-performance-sync'));
  insert into public.enterprise_performance_snapshots(as_of,metadata) values(p_as_of,p_metadata) returning id into v_id;
  insert into public.enterprise_performance_companies(snapshot_id,company_key,name)
    select v_id, company_key, name from jsonb_to_recordset(p_companies) as item(company_key text, name text);
  insert into public.enterprise_performance_flows(snapshot_id,company_key,cash_date,kind,amount)
    select v_id, company_key, cash_date, kind, amount
    from jsonb_to_recordset(p_flows) as item(company_key text,cash_date date,kind text,amount numeric);
  return v_id;
end;
$$;
revoke all on function public.sync_enterprise_performance(date,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.sync_enterprise_performance(date,jsonb,jsonb,jsonb) to service_role;

create function public.enterprise_performance_snapshot(p_company text default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_snapshot public.enterprise_performance_snapshots%rowtype; v_companies jsonb; v_rows jsonb;
begin
  if not public.has_department_access('novos-negocios') then raise exception 'department_access_required' using errcode='42501'; end if;
  select * into v_snapshot from public.enterprise_performance_snapshots order by captured_at desc,id desc limit 1;
  if v_snapshot.id is null then
    return jsonb_build_object('synchronized_at',null,'as_of',null,'companies','[]'::jsonb,'rows','[]'::jsonb,'source','Qlik Cloud — Financeiro');
  end if;
  if p_company is not null and not exists(select 1 from public.enterprise_performance_companies where snapshot_id=v_snapshot.id and company_key=p_company) then
    raise exception 'performance_company_not_found' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('key',company_key,'name',name) order by name),'[]'::jsonb) into v_companies
    from public.enterprise_performance_companies where snapshot_id=v_snapshot.id;
  select coalesce(jsonb_agg(to_jsonb(item) order by item.date nulls last),'[]'::jsonb) into v_rows from (
    select cash_date as date,
      coalesce(sum(amount) filter(where kind='received'),0) as received,
      coalesce(sum(amount) filter(where kind='paid'),0) as paid,
      coalesce(sum(amount) filter(where kind='receivable'),0) as receivable,
      coalesce(sum(amount) filter(where kind='payable'),0) as payable
    from public.enterprise_performance_flows
    where snapshot_id=v_snapshot.id and (p_company is null or company_key=p_company)
    group by cash_date
  ) item;
  return jsonb_build_object('synchronized_at',v_snapshot.captured_at,'as_of',v_snapshot.as_of,'companies',v_companies,'rows',v_rows,'source',v_snapshot.source);
end;
$$;
revoke all on function public.enterprise_performance_snapshot(text) from public,anon;
grant execute on function public.enterprise_performance_snapshot(text) to authenticated;

insert into public.data_connections(slug,provider,name,description,schedule_cron,active,settings)
values('qlik-enterprise-performance','qlik-cloud','Qlik — Performance de empreendimentos',
  'Recebimentos, pagamentos e saldos em aberto por empresa e data. Ativação após validar as medidas nas três planilhas de origem.',
  '0 13 * * 1',false,jsonb_build_object(
    'app_id','e3d13862-ec1f-4332-8a5b-df4c7b93fa7c','company_field','Empresa','mapping_verified',false,
    'validation_status','pending_source_access',
    'sheets',jsonb_build_object('received','bd84bea2-0f3c-4dc6-9081-0eab08502ba3','payments','96551230-06b0-4e0f-9881-890030e2992a','receivables','32a488c2-14d8-4bde-ba4f-35211d75376b')
  )) on conflict(slug) do nothing;

commit;
