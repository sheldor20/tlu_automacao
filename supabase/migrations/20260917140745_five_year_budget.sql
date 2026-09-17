begin;
create table public.budget_plans (
 id uuid primary key default gen_random_uuid(), name text not null,
 start_year integer not null check(start_year between 2020 and 2095),
 data jsonb not null check(jsonb_typeof(data)='object'), version integer not null default 1,
 created_by uuid not null references public.profiles(user_id), updated_by uuid not null references public.profiles(user_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index budget_plans_created_by_idx on public.budget_plans(created_by);
create index budget_plans_updated_by_idx on public.budget_plans(updated_by);
create table public.business_budget_curves (
 business_id uuid primary key references public.businesses(id) on delete cascade,
 curve jsonb not null check(jsonb_typeof(curve)='array'), version integer not null default 1,
 updated_by uuid not null references public.profiles(user_id), updated_at timestamptz not null default now()
);
create index business_budget_curves_updated_by_idx on public.business_budget_curves(updated_by);
alter table public.budget_plans enable row level security;
alter table public.business_budget_curves enable row level security;
revoke all on public.budget_plans,public.business_budget_curves from anon,authenticated;
grant select on public.budget_plans,public.business_budget_curves to authenticated;
grant all on public.budget_plans,public.business_budget_curves to service_role;
create policy budget_plans_read on public.budget_plans for select to authenticated using(public.has_department_access('financeiro'));
create policy business_budget_curves_read on public.business_budget_curves for select to authenticated using(public.has_department_access('financeiro') or public.has_department_access('novos-negocios'));

-- Executed only by the authenticated server handler after permission and schema checks.
create function public.save_business_budget_curve(p_business uuid,p_curve jsonb,p_version integer,p_actor uuid)
returns public.business_budget_curves language plpgsql security invoker set search_path='' as $$
declare v public.business_budget_curves%rowtype; total numeric;
begin
 perform 1 from public.businesses where id=p_business and archived_at is null for update;
 if not found then raise exception 'budget_business_missing'; end if;
 if jsonb_typeof(p_curve)<>'array' or jsonb_array_length(p_curve) not between 1 and 120 then raise exception 'budget_curve_invalid'; end if;
 if exists(select 1 from jsonb_array_elements(p_curve) r where (r->>'month')::numeric not between 1 and 120 or (r->>'month')::numeric<>trunc((r->>'month')::numeric) or coalesce((r->>'vgv')::numeric,-1)<0 or coalesce((r->>'investment')::numeric,-1)<0) then raise exception 'budget_curve_invalid'; end if;
 if (select count(distinct r->>'month') from jsonb_array_elements(p_curve) r)<>jsonb_array_length(p_curve) then raise exception 'budget_curve_invalid'; end if;
 select * into v from public.business_budget_curves where business_id=p_business for update;
 if coalesce(v.version,0)<>p_version then raise exception 'budget_conflict'; end if;
 insert into public.business_budget_curves(business_id,curve,updated_by) values(p_business,p_curve,p_actor)
 on conflict(business_id) do update set curve=excluded.curve,updated_by=excluded.updated_by,updated_at=now(),version=business_budget_curves.version+1 returning * into v;
 select sum((r->>'vgv')::numeric) into total from jsonb_array_elements(p_curve) r;
 update public.businesses set potential_vgv=total where id=p_business;
 return v;
end $$;
revoke all on function public.save_business_budget_curve(uuid,jsonb,integer,uuid) from public,anon,authenticated;
grant execute on function public.save_business_budget_curve(uuid,jsonb,integer,uuid) to service_role;

-- Aggregate in Postgres: hundreds of thousands of installments never leave the server.
create function public.budget_source_months(p_year integer) returns jsonb
language plpgsql stable security invoker set search_path='' set statement_timeout='25s' as $$
declare result jsonb;
begin
 if p_year not between 2020 and 2095 then raise exception 'budget_year_invalid'; end if;
 select jsonb_build_object(
  'rows',coalesce((select jsonb_agg(r order by r.month,r.kind,r.category) from (
    select to_char(cash_date,'YYYY-MM') as month,company_id,work_key,kind,coalesce(source_category,'Sem classificação') category,round(sum(amount),2) amount,count(*) count
    from public.operational_cash_entries where active and cash_date>=make_date(p_year,1,1) and cash_date<make_date(p_year+5,1,1)
      and (kind in ('receivable','payable') or cash_date<=(now() at time zone 'America/Sao_Paulo')::date)
    group by 1,2,3,4,5)r),'[]'::jsonb),
  'coverage',coalesce((select jsonb_agg(r) from(select kind,company_id,count(*) count,max(synchronized_at) updated_at,count(*) filter(where cash_date is null) undated from public.operational_cash_entries where active group by kind,company_id)r),'[]'::jsonb),
  'overdue_receivables',coalesce((select round(sum(amount),2) from public.operational_cash_entries where active and kind='receivable' and cash_date<make_date(p_year,1,1)),0),
  'companies',coalesce((select jsonb_agg(r order by r.name) from(select id,name from public.qlik_companies)r),'[]'::jsonb)
 ) into result;
 return result;
end $$;
revoke all on function public.budget_source_months(integer) from public,anon,authenticated;
grant execute on function public.budget_source_months(integer) to service_role;
commit;
