-- Terra Lótus Urbanismo — catálogo reutilizável de conexões e primeira carga Qlik.
-- As credenciais permanecem exclusivamente nas variáveis de ambiente da Vercel.

begin;

create table public.data_connections (
  slug text primary key check (slug ~ '^[a-z0-9-]+$'),
  provider text not null check (provider ~ '^[a-z0-9-]+$'),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text,
  schedule_cron text,
  active boolean not null default true,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.data_connection_runs (
  id uuid primary key default gen_random_uuid(),
  connection_slug text not null references public.data_connections(slug) on update cascade on delete restrict,
  status text not null check (status in ('running', 'success', 'error')),
  trigger_source text not null default 'api' check (trigger_source in ('api', 'cron')),
  rows_read integer not null default 0 check (rows_read >= 0),
  rows_written integer not null default 0 check (rows_written >= 0),
  error_message text,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index data_connection_runs_connection_started_idx
  on public.data_connection_runs (connection_slug, started_at desc);

create trigger set_data_connections_updated_at
before update on public.data_connections
for each row execute function public.set_updated_at();

insert into public.data_connections (
  slug, provider, name, description, schedule_cron, settings
) values (
  'qlik-delinquency',
  'qlik-cloud',
  'Qlik — Gestão de Inadimplência',
  'Competências fechadas da visão Overview Inadimplência Por Posição.',
  '30 10 * * 1',
  jsonb_build_object(
    'app_id', 'ce523abd-dce7-40f5-bd1c-93a23ffa4faa',
    'sheet_id', 'd70dcedc-9e36-4de1-bf01-71776b690a63',
    'object_id', 'jJTqUzF',
    'filters', jsonb_build_object(
      'Empreendimento?', 'Sim',
      'Cobrável?', 'Sim',
      'Venda Jurídico?', 'Não'
    ),
    'credentials', 'Vercel: QLIK_USERNAME e QLIK_PASSWORD'
  )
)
on conflict (slug) do update set
  provider = excluded.provider,
  name = excluded.name,
  description = excluded.description,
  schedule_cron = excluded.schedule_cron,
  settings = excluded.settings,
  active = true;

alter table public.data_connections enable row level security;
alter table public.data_connection_runs enable row level security;

create policy data_connections_admin_read
on public.data_connections
for select to authenticated
using (public.is_system_admin());

create policy data_connection_runs_admin_read
on public.data_connection_runs
for select to authenticated
using (public.is_system_admin());

grant select on public.data_connections to authenticated;
grant select on public.data_connection_runs to authenticated;
grant select, insert, update, delete on public.data_connections to service_role;
grant select, insert, update, delete on public.data_connection_runs to service_role;

create or replace function public.sync_data_connection_indicators(
  p_connection_slug text,
  p_source text,
  p_rows jsonb,
  p_clear_area text default null,
  p_clear_metric_keys text[] default null,
  p_clear_from date default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  written_count integer;
begin
  if not exists (
    select 1 from public.data_connections connection
    where connection.slug = p_connection_slug and connection.active
  ) then
    raise exception using message = 'data_connection_inactive_or_missing';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception using message = 'indicator_rows_must_be_an_array';
  end if;

  if p_clear_area is not null and p_clear_metric_keys is not null and p_clear_from is not null then
    delete from public.management_indicator_values value
    where value.area = p_clear_area
      and value.metric_key = any(p_clear_metric_keys)
      and value.source = p_source
      and value.reference_month >= p_clear_from;
  end if;

  insert into public.management_indicator_values (
    area,
    metric_key,
    reference_month,
    dimension_key,
    dimension_label,
    value,
    source,
    notes,
    metadata
  )
  select
    row.area,
    row.metric_key,
    row.reference_month,
    coalesce(nullif(row.dimension_key, ''), 'total'),
    row.dimension_label,
    row.value,
    p_source,
    row.notes,
    coalesce(row.metadata, '{}'::jsonb)
  from jsonb_to_recordset(p_rows) as row(
    area text,
    metric_key text,
    reference_month date,
    dimension_key text,
    dimension_label text,
    value numeric,
    notes text,
    metadata jsonb
  )
  on conflict (area, metric_key, reference_month, dimension_key)
  do update set
    dimension_label = excluded.dimension_label,
    value = excluded.value,
    source = excluded.source,
    notes = excluded.notes,
    metadata = excluded.metadata,
    updated_at = now();

  get diagnostics written_count = row_count;
  return written_count;
end;
$$;

revoke all on function public.sync_data_connection_indicators(text, text, jsonb, text, text[], date) from public;
grant execute on function public.sync_data_connection_indicators(text, text, jsonb, text, text[], date) to service_role;

commit;
