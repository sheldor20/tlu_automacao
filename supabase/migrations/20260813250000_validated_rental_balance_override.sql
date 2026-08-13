-- Terra Lótus Urbanismo — saldo validado da conta de aluguéis em julho/2026.
-- O Qlik retornou um agregado incorreto; preservamos o retorno original nos
-- metadados e aplicamos o fechamento validado no painel e nas próximas cargas.

begin;

update public.data_connections
set settings = jsonb_set(
  coalesce(settings, '{}'::jsonb),
  '{metric_overrides}',
  coalesce(settings -> 'metric_overrides', '{}'::jsonb)
    || jsonb_build_object(
      'saldo_conta_alugueis',
      coalesce(settings #> '{metric_overrides,saldo_conta_alugueis}', '{}'::jsonb)
        || jsonb_build_object('2026-07-01', 616800.00)
    ),
  true
)
where slug = 'qlik-finance';

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
  'financas-compras',
  'saldo_conta_alugueis',
  date '2026-07-01',
  'total',
  null,
  616800.00,
  'Ajuste validado — Aluguéis',
  'Fechamento de julho validado em R$ 616.800,00.',
  jsonb_build_object(
    'manual_override', true,
    'validated_value', 616800.00,
    'reference_month', '2026-07-01',
    'validated_on', '2026-08-13'
  )
)
on conflict (area, metric_key, reference_month, dimension_key)
do update set
  dimension_label = excluded.dimension_label,
  value = excluded.value,
  source = excluded.source,
  notes = excluded.notes,
  metadata = coalesce(public.management_indicator_values.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = now();

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
  'empresa',
  'caixa_disponivel',
  date '2026-08-01',
  'total',
  null,
  cash.value - 616800.00,
  'Cálculo financeiro',
  'Saldo bancário atual menos saldo validado da conta de aluguéis de julho.',
  jsonb_build_object(
    'calculation', 'valor_caixa_atual - saldo_conta_alugueis_julho',
    'valor_caixa', cash.value,
    'saldo_conta_alugueis', 616800.00,
    'saldo_conta_alugueis_reference_month', '2026-07-01',
    'recalculated_on', '2026-08-13'
  )
from public.management_indicator_values cash
where cash.area = 'empresa'
  and cash.metric_key = 'valor_caixa'
  and cash.reference_month = date '2026-08-01'
  and cash.dimension_key = 'total'
on conflict (area, metric_key, reference_month, dimension_key)
do update set
  dimension_label = excluded.dimension_label,
  value = excluded.value,
  source = excluded.source,
  notes = excluded.notes,
  metadata = excluded.metadata,
  updated_at = now();

commit;
