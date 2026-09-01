-- Terra Lótus Urbanismo — atualização dos indicadores manuais de agosto de 2026.
-- A disponibilidade de imóveis é capturada da operação do próprio TLU Space.

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
  'instagram_seguidores',
  date '2026-08-01',
  'total',
  null,
  3499,
  'Carga manual — Instagram',
  'Seguidores do perfil @terralotusurbanismo informados para agosto de 2026.',
  '{"manual":true,"informed_on":"2026-09-01"}'::jsonb
)
on conflict (area, metric_key, reference_month, dimension_key)
do update set
  dimension_label = excluded.dimension_label,
  value = excluded.value,
  source = excluded.source,
  notes = excluded.notes,
  metadata = excluded.metadata,
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
values (
  'rh-marketing-clientes',
  'imoveis_disponiveis',
  date '2026-08-01',
  'total',
  null,
  7,
  'TLU Space — Aluguéis',
  'Imóveis disponíveis em agosto de 2026, capturados do cadastro de aluguéis do TLU Space.',
  '{"manual":true,"informed_on":"2026-09-01","derived_from":"rentals.status=desocupado","captured_value":7}'::jsonb
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
