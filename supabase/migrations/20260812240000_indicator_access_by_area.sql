-- Terra Lótus Urbanismo — permissões individuais para as visões de Indicadores.
-- Usuários que já possuíam o departamento recebem todas as visões nesta migração.

begin;

create table public.profile_indicator_areas (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  area text not null check (area in (
    'empresa',
    'juridico-vendas-cobranca',
    'rh-marketing-clientes',
    'financas-compras',
    'novos-negocios',
    'obras-engenharia'
  )),
  created_at timestamptz not null default now(),
  primary key (user_id, area)
);

insert into public.profile_indicator_areas (user_id, area)
select access.user_id, area.slug
from public.profile_departments access
cross join (values
  ('empresa'),
  ('juridico-vendas-cobranca'),
  ('rh-marketing-clientes'),
  ('financas-compras'),
  ('novos-negocios'),
  ('obras-engenharia')
) as area(slug)
where access.department_slug = 'indicadores'
on conflict (user_id, area) do nothing;

create or replace function public.has_indicator_area_access(p_area text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.user_id = auth.uid()
      and profile.active
      and (
        profile.is_admin
        or (
          exists (
            select 1
            from public.profile_departments department_access
            where department_access.user_id = profile.user_id
              and department_access.department_slug = 'indicadores'
          )
          and exists (
            select 1
            from public.profile_indicator_areas area_access
            where area_access.user_id = profile.user_id
              and area_access.area = p_area
          )
        )
      )
  );
$$;

revoke all on function public.has_indicator_area_access(text) from public;
grant execute on function public.has_indicator_area_access(text) to authenticated;

alter table public.profile_indicator_areas enable row level security;

create policy profile_indicator_areas_read
on public.profile_indicator_areas
for select to authenticated
using (user_id = auth.uid() or public.is_system_admin());

create policy profile_indicator_areas_admin_insert
on public.profile_indicator_areas
for insert to authenticated
with check (public.is_system_admin());

create policy profile_indicator_areas_admin_update
on public.profile_indicator_areas
for update to authenticated
using (public.is_system_admin())
with check (public.is_system_admin());

create policy profile_indicator_areas_admin_delete
on public.profile_indicator_areas
for delete to authenticated
using (public.is_system_admin());

grant select, insert, update, delete on public.profile_indicator_areas to authenticated;

drop policy if exists management_metric_catalog_read on public.management_metric_catalog;
create policy management_metric_catalog_read
on public.management_metric_catalog
for select to authenticated
using (public.has_indicator_area_access(area));

drop policy if exists management_indicator_values_read on public.management_indicator_values;
create policy management_indicator_values_read
on public.management_indicator_values
for select to authenticated
using (public.has_indicator_area_access(area));

drop policy if exists management_dashboard_signals_read on public.management_dashboard_signals;
create policy management_dashboard_signals_read
on public.management_dashboard_signals
for select to authenticated
using (public.has_indicator_area_access(scope));

create or replace function public.management_business_funnel_snapshot()
returns table (
  stage public.business_stage,
  area_count bigint,
  potential_vgv numeric,
  average_days numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_indicator_area_access('novos-negocios') then
    raise exception using message = 'indicator_area_access_required';
  end if;

  return query
  select
    business.stage,
    count(*)::bigint,
    coalesce(sum(business.potential_vgv), 0)::numeric,
    coalesce(round(avg(greatest(
      0,
      floor(extract(epoch from (now() - history.entered_at)) / 86400)
    )), 1), 0)::numeric
  from public.businesses business
  left join public.business_stage_history history
    on history.business_id = business.id and history.exited_at is null
  where business.archived_at is null
  group by business.stage;
end;
$$;

create or replace function public.management_construction_snapshot()
returns table (
  id uuid,
  name text,
  status public.construction_status,
  planned_budget numeric,
  realized_total numeric,
  physical_progress numeric,
  financial_progress numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_indicator_area_access('obras-engenharia') then
    raise exception using message = 'indicator_area_access_required';
  end if;

  return query
  with micro_progress as (
    select
      macro.construction_id,
      sum((macro.weight_percent / 100.0) * coalesce(micro.average_progress, 0)) as progress
    from public.construction_macro_stages macro
    left join lateral (
      select avg(stage.progress_percent) as average_progress
      from public.construction_micro_stages stage
      where stage.macro_stage_id = macro.id
    ) micro on true
    group by macro.construction_id
  ), budget as (
    select item.construction_id, sum(item.realized_amount) as realized
    from public.construction_budgets item
    group by item.construction_id
  )
  select
    construction.id,
    construction.name,
    construction.status,
    construction.planned_budget,
    coalesce(budget.realized, 0)::numeric,
    coalesce(micro_progress.progress, 0)::numeric,
    case
      when construction.planned_budget > 0
        then round(100 * coalesce(budget.realized, 0) / construction.planned_budget, 2)
      else 0
    end::numeric
  from public.constructions construction
  left join micro_progress on micro_progress.construction_id = construction.id
  left join budget on budget.construction_id = construction.id
  where construction.archived_at is null
    and construction.status = 'em_andamento'
  order by construction.name;
end;
$$;

create or replace function public.management_rental_snapshot()
returns table (
  total_properties bigint,
  available_properties bigint,
  rented_properties bigint,
  renovation_properties bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_indicator_area_access('rh-marketing-clientes') then
    raise exception using message = 'indicator_area_access_required';
  end if;

  return query
  select
    count(*)::bigint,
    count(*) filter (where rental.status = 'desocupado')::bigint,
    count(*) filter (where rental.status = 'alugado')::bigint,
    count(*) filter (where rental.status = 'aguardando_reforma')::bigint
  from public.rentals rental;
end;
$$;

commit;
