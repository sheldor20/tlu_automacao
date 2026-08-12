-- Terra Lótus Urbanismo — base dos indicadores gerenciais.
-- Execute depois de 20260812100000_operational_simplicity.sql.

begin;

insert into public.departments (slug, name, position)
values ('indicadores', 'Indicadores', 5)
on conflict (slug) do update set
  name = excluded.name,
  position = excluded.position;

create table public.management_metric_catalog (
  area text not null check (area in (
    'empresa',
    'juridico-vendas-cobranca',
    'rh-marketing-clientes'
  )),
  metric_key text not null check (metric_key ~ '^[a-z0-9_]+$'),
  label text not null check (char_length(btrim(label)) between 2 and 140),
  description text,
  unit text not null check (unit in ('currency', 'percent', 'integer', 'score', 'decimal')),
  display_order smallint not null default 0,
  allows_breakdown boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (area, metric_key)
);

create table public.management_indicator_values (
  id uuid primary key default gen_random_uuid(),
  area text not null,
  metric_key text not null,
  reference_month date not null,
  dimension_key text not null default 'total',
  dimension_label text,
  value numeric(20,4) not null,
  source text,
  notes text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint management_indicator_catalog_fk
    foreign key (area, metric_key)
    references public.management_metric_catalog(area, metric_key)
    on update cascade on delete restrict,
  constraint management_indicator_month_start
    check (reference_month = date_trunc('month', reference_month)::date),
  constraint management_indicator_dimension_key
    check (dimension_key ~ '^[a-z0-9_-]+$'),
  unique (area, metric_key, reference_month, dimension_key)
);

create index management_indicator_values_area_month_idx
  on public.management_indicator_values (area, reference_month desc);

create table public.management_dashboard_signals (
  scope text primary key check (scope in (
    'novos-negocios',
    'obras-engenharia',
    'rh-marketing-clientes'
  )),
  updated_at timestamptz not null default now()
);

insert into public.management_dashboard_signals (scope)
values
  ('novos-negocios'),
  ('obras-engenharia'),
  ('rh-marketing-clientes')
on conflict (scope) do nothing;

insert into public.management_metric_catalog (
  area, metric_key, label, description, unit, display_order, allows_breakdown
) values
  ('empresa', 'receita_consolidada', 'Receita consolidada', 'Receita total reconhecida no mês.', 'currency', 10, false),
  ('empresa', 'despesa_consolidada', 'Despesas consolidadas', 'Despesa total reconhecida no mês.', 'currency', 20, false),
  ('empresa', 'resultado_gerencial', 'Resultado gerencial', 'Resultado gerencial consolidado do mês.', 'currency', 30, false),
  ('empresa', 'valor_caixa', 'Valor em caixa', 'Saldo de caixa ao fim do mês.', 'currency', 40, false),
  ('empresa', 'receita_plano_contas', 'Receitas por plano de contas', 'Composição das receitas por conta gerencial.', 'currency', 50, true),
  ('empresa', 'despesa_plano_contas', 'Despesas por plano de contas', 'Composição das despesas por conta gerencial.', 'currency', 60, true),
  ('juridico-vendas-cobranca', 'inadimplencia_total', 'Inadimplência total', 'Saldo total inadimplente no fechamento do mês.', 'currency', 10, false),
  ('juridico-vendas-cobranca', 'eficiencia_cobranca', 'Eficiência da cobrança', 'Percentual mensal de eficiência da cobrança.', 'percent', 20, false),
  ('juridico-vendas-cobranca', 'unidades_disponiveis', 'Unidades disponíveis', 'Estoque disponível para venda no mês.', 'integer', 30, false),
  ('juridico-vendas-cobranca', 'vendas_mes', 'Vendas no mês', 'Quantidade de vendas realizadas no mês.', 'integer', 40, false),
  ('juridico-vendas-cobranca', 'distratos_mes', 'Distratos no mês', 'Quantidade de distratos registrados no mês.', 'integer', 50, false),
  ('juridico-vendas-cobranca', 'unidades_quitadas', 'Unidades quitadas', 'Total de unidades quitadas.', 'integer', 60, false),
  ('juridico-vendas-cobranca', 'unidades_sem_processo', 'Unidades sem processo', 'Unidades quitadas ainda sem processo de escritura.', 'integer', 70, false),
  ('juridico-vendas-cobranca', 'unidades_autorizadas_escrituracao', 'Autorizadas para escrituração', 'Unidades autorizadas para iniciar a escrituração.', 'integer', 80, false),
  ('juridico-vendas-cobranca', 'unidades_escrituracao_sem_registro', 'Em escrituração sem registro', 'Unidades em processo de escritura ainda sem registro.', 'integer', 90, false),
  ('juridico-vendas-cobranca', 'unidades_registradas', 'Unidades registradas', 'Unidades com registro concluído.', 'integer', 100, false),
  ('rh-marketing-clientes', 'saldo_conta_alugueis', 'Saldo da conta de aluguéis', 'Saldo financeiro da conta dedicada aos aluguéis.', 'currency', 10, false),
  ('rh-marketing-clientes', 'receita_alugueis_mes', 'Aluguéis recebidos', 'Valor recebido de aluguéis no mês.', 'currency', 20, false),
  ('rh-marketing-clientes', 'despesa_alugueis_mes', 'Gastos com aluguéis', 'Valor gasto com a carteira de aluguéis no mês.', 'currency', 30, false),
  ('rh-marketing-clientes', 'imoveis_disponiveis', 'Imóveis disponíveis', 'Quantidade de imóveis disponíveis para locação no mês.', 'integer', 40, false),
  ('rh-marketing-clientes', 'pesquisa_clima', 'Pesquisa de clima', 'Nota semestral da pesquisa de clima, entre zero e dez.', 'score', 50, false),
  ('rh-marketing-clientes', 'nps_clientes', 'NPS dos clientes', 'Net Promoter Score mensal dos clientes.', 'score', 60, false)
on conflict (area, metric_key) do update set
  label = excluded.label,
  description = excluded.description,
  unit = excluded.unit,
  display_order = excluded.display_order,
  allows_breakdown = excluded.allows_breakdown,
  active = true;

create trigger set_management_indicator_values_updated_at
before update on public.management_indicator_values
for each row execute function public.set_updated_at();

alter table public.management_metric_catalog enable row level security;
alter table public.management_indicator_values enable row level security;
alter table public.management_dashboard_signals enable row level security;

create policy management_metric_catalog_read
on public.management_metric_catalog
for select to authenticated
using (public.has_department_access('indicadores'));

create policy management_indicator_values_read
on public.management_indicator_values
for select to authenticated
using (public.has_department_access('indicadores'));

create policy management_indicator_values_admin_write
on public.management_indicator_values
for all to authenticated
using (public.is_system_admin())
with check (public.is_system_admin());

create policy management_dashboard_signals_read
on public.management_dashboard_signals
for select to authenticated
using (public.has_department_access('indicadores'));

grant select on public.management_metric_catalog to authenticated;
grant select, insert, update, delete on public.management_indicator_values to authenticated;
grant select on public.management_dashboard_signals to authenticated;

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
  if not public.has_department_access('indicadores') then
    raise exception using message = 'department_access_required';
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
  if not public.has_department_access('indicadores') then
    raise exception using message = 'department_access_required';
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
  if not public.has_department_access('indicadores') then
    raise exception using message = 'department_access_required';
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

revoke all on function public.management_business_funnel_snapshot() from public;
revoke all on function public.management_construction_snapshot() from public;
revoke all on function public.management_rental_snapshot() from public;
grant execute on function public.management_business_funnel_snapshot() to authenticated;
grant execute on function public.management_construction_snapshot() to authenticated;
grant execute on function public.management_rental_snapshot() to authenticated;

create or replace function public.signal_management_dashboard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_scope text;
begin
  target_scope := case
    when tg_table_name in ('businesses', 'business_stage_history') then 'novos-negocios'
    when tg_table_name in (
      'constructions',
      'construction_budgets',
      'construction_macro_stages',
      'construction_micro_stages'
    ) then 'obras-engenharia'
    when tg_table_name = 'rentals' then 'rh-marketing-clientes'
    else null
  end;

  if target_scope is not null then
    insert into public.management_dashboard_signals (scope, updated_at)
    values (target_scope, now())
    on conflict (scope) do update set updated_at = excluded.updated_at;
  end if;

  return null;
end;
$$;

revoke all on function public.signal_management_dashboard() from public;

create trigger signal_management_from_businesses
after insert or update or delete on public.businesses
for each statement execute function public.signal_management_dashboard();
create trigger signal_management_from_business_history
after insert or update or delete on public.business_stage_history
for each statement execute function public.signal_management_dashboard();
create trigger signal_management_from_constructions
after insert or update or delete on public.constructions
for each statement execute function public.signal_management_dashboard();
create trigger signal_management_from_construction_budgets
after insert or update or delete on public.construction_budgets
for each statement execute function public.signal_management_dashboard();
create trigger signal_management_from_construction_macro_stages
after insert or update or delete on public.construction_macro_stages
for each statement execute function public.signal_management_dashboard();
create trigger signal_management_from_construction_micro_stages
after insert or update or delete on public.construction_micro_stages
for each statement execute function public.signal_management_dashboard();
create trigger signal_management_from_rentals
after insert or update or delete on public.rentals
for each statement execute function public.signal_management_dashboard();

alter table public.management_indicator_values replica identity full;
alter table public.management_dashboard_signals replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'management_indicator_values'
    ) then
      execute 'alter publication supabase_realtime add table public.management_indicator_values';
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'management_dashboard_signals'
    ) then
      execute 'alter publication supabase_realtime add table public.management_dashboard_signals';
    end if;
  end if;
end;
$$;

commit;
