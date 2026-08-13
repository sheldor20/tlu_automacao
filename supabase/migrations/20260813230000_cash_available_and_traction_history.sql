-- Terra Lótus Urbanismo — caixa disponível e histórico mensal real da tração.

begin;

insert into public.management_metric_catalog (
  area, metric_key, label, description, unit, display_order, allows_breakdown
) values (
  'empresa',
  'caixa_disponivel',
  'Valor em caixa disponível',
  'Saldo bancário do grupo Terra Lotus menos o saldo da conta de aluguéis no fechamento mensal.',
  'currency',
  45,
  false
)
on conflict (area, metric_key) do update set
  label = excluded.label,
  description = excluded.description,
  unit = excluded.unit,
  display_order = excluded.display_order,
  allows_breakdown = excluded.allows_breakdown,
  active = true;

insert into public.management_indicator_values (
  area, metric_key, reference_month, dimension_key, dimension_label,
  value, source, notes, metadata
)
select
  'empresa',
  'caixa_disponivel',
  cash.reference_month,
  'total',
  null,
  cash.value - rental.value,
  'Cálculo financeiro',
  'Calculado por valor em caixa menos saldo da conta de aluguéis.',
  jsonb_build_object(
    'calculation', 'valor_caixa - saldo_conta_alugueis',
    'valor_caixa', cash.value,
    'saldo_conta_alugueis', rental.value,
    'backfilled_at', now()
  )
from public.management_indicator_values cash
join public.management_indicator_values rental
  on rental.area = 'financas-compras'
 and rental.metric_key = 'saldo_conta_alugueis'
 and rental.reference_month = cash.reference_month
 and rental.dimension_key = 'total'
where cash.area = 'empresa'
  and cash.metric_key = 'valor_caixa'
  and cash.dimension_key = 'total'
on conflict (area, metric_key, reference_month, dimension_key)
do update set
  value = excluded.value,
  source = excluded.source,
  notes = excluded.notes,
  metadata = excluded.metadata,
  updated_at = now();

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
        'valor_caixa', 'caixa_disponivel', 'receita_plano_contas', 'despesa_plano_contas'
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

update public.data_connections
set settings = jsonb_set(
  coalesce(settings, '{}'::jsonb),
  '{traction_history}',
  '"last-date-of-each-month"'::jsonb,
  true
)
where slug = 'qlik-legal-sales';

update public.management_metric_catalog
set description = case metric_key
  when 'unidades_quitadas' then 'Posição de unidades quitadas no último dia disponível de cada mês.'
  when 'unidades_sem_processo' then 'Posição de unidades quitadas sem processo no último dia disponível de cada mês.'
  when 'unidades_autorizadas_escrituracao' then 'Posição de unidades autorizadas no último dia disponível de cada mês.'
  else description
end
where area = 'juridico-vendas-cobranca'
  and metric_key in (
    'unidades_quitadas',
    'unidades_sem_processo',
    'unidades_autorizadas_escrituracao'
  );

commit;
