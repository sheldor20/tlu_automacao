-- Terra Lótus Urbanismo — imóveis disponíveis em julho de 2026.
-- Idempotente: reaplicar atualiza a competência sem duplicar a linha.

begin;

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
  'imoveis_disponiveis',
  date '2026-07-01',
  'total',
  null,
  7,
  'Carga manual — Aluguéis',
  'Imóveis disponíveis informados para julho de 2026.',
  '{"manual":true,"informed_on":"2026-08-13"}'::jsonb
)
on conflict (area, metric_key, reference_month, dimension_key)
do update set
  dimension_label = excluded.dimension_label,
  value = excluded.value,
  source = excluded.source,
  notes = excluded.notes,
  metadata = excluded.metadata,
  updated_at = now();

commit;
