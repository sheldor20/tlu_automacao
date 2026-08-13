-- Terra Lótus Urbanismo — conexão financeira Qlik e carga manual de clima.
-- As credenciais continuam somente nas variáveis protegidas da Vercel.

begin;

insert into public.data_connections (
  slug, provider, name, description, schedule_cron, settings
) values (
  'qlik-finance',
  'qlik-cloud',
  'Qlik — Financeiro',
  'Saldos, receitas, despesas e composição por plano de contas para Empresa e Finanças e Compras.',
  '30 11 * * 1',
  jsonb_build_object(
    'app_id', 'e3d13862-ec1f-4332-8a5b-df4c7b93fa7c',
    'sheets', jsonb_build_array(
      '08b38935-ed14-4061-a170-b7fdffdfbdcf',
      'bd84bea2-0f3c-4dc6-9081-0eab08502ba3',
      'e21bae6c-5983-4ea5-a12d-ddc68f7659d0'
    ),
    'areas', jsonb_build_array('empresa', 'financas-compras'),
    'period', 'current-year-through-current-month',
    'breakdown_period', 'previous-closed-month',
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

create or replace function public.sync_qlik_finance_indicators(
  p_rows jsonb,
  p_source text,
  p_clear_from date
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
    where connection.slug = 'qlik-finance' and connection.active
  ) then
    raise exception using message = 'qlik_finance_connection_inactive_or_missing';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception using message = 'indicator_rows_must_be_an_array';
  end if;

  delete from public.management_indicator_values value
  where value.source = p_source
    and value.reference_month >= p_clear_from
    and (
      (value.area = 'empresa' and value.metric_key = any(array[
        'receita_consolidada', 'despesa_consolidada', 'resultado_gerencial',
        'valor_caixa', 'receita_plano_contas', 'despesa_plano_contas'
      ]::text[]))
      or
      (value.area = 'financas-compras' and value.metric_key = any(array[
        'saldo_conta_alugueis', 'receita_alugueis_mes', 'despesa_alugueis_mes'
      ]::text[]))
    );

  insert into public.management_indicator_values (
    area, metric_key, reference_month, dimension_key, dimension_label,
    value, source, notes, metadata
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

revoke all on function public.sync_qlik_finance_indicators(jsonb, text, date) from public;
grant execute on function public.sync_qlik_finance_indicators(jsonb, text, date) to service_role;

update public.management_metric_catalog
set description = case metric_key
  when 'receita_consolidada' then 'Receita acumulada do ano vigente; histórico armazenado por mês.'
  when 'despesa_consolidada' then 'Despesa acumulada do ano vigente; histórico armazenado por mês.'
  when 'resultado_gerencial' then 'Receita mensal menos despesa mensal.'
  when 'valor_caixa' then 'Saldo de caixa no último dia disponível do mês.'
  when 'receita_plano_contas' then 'Composição das receitas por plano de contas no mês anterior fechado.'
  when 'despesa_plano_contas' then 'Composição das despesas por plano de contas no mês anterior fechado.'
  else description
end
where area = 'empresa'
  and metric_key in (
    'receita_consolidada',
    'despesa_consolidada',
    'resultado_gerencial',
    'valor_caixa',
    'receita_plano_contas',
    'despesa_plano_contas'
  );

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
) values (
  'rh-marketing-clientes',
  'pesquisa_clima',
  date_trunc('month', now() at time zone 'America/Sao_Paulo')::date,
  'total',
  null,
  6.9,
  'Pesquisa de clima — carga manual',
  'Resultado vigente informado pela administração em 13/08/2026.',
  jsonb_build_object('scale_min', 0, 'scale_max', 10, 'manual', true)
)
on conflict (area, metric_key, reference_month, dimension_key)
do update set
  value = excluded.value,
  source = excluded.source,
  notes = excluded.notes,
  metadata = excluded.metadata,
  updated_at = now();

commit;
