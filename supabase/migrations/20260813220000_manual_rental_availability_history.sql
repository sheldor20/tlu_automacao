-- Terra Lótus Urbanismo — histórico manual de imóveis disponíveis em 2026.
-- Idempotente: reaplicar atualiza as mesmas competências sem duplicar linhas.

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
) values
  ('rh-marketing-clientes', 'imoveis_disponiveis', date '2026-01-01', 'total', null, 9, 'Carga manual — Aluguéis', 'Imóveis disponíveis informados para janeiro de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('rh-marketing-clientes', 'imoveis_disponiveis', date '2026-02-01', 'total', null, 8, 'Carga manual — Aluguéis', 'Imóveis disponíveis informados para fevereiro de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('rh-marketing-clientes', 'imoveis_disponiveis', date '2026-03-01', 'total', null, 8, 'Carga manual — Aluguéis', 'Imóveis disponíveis informados para março de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('rh-marketing-clientes', 'imoveis_disponiveis', date '2026-04-01', 'total', null, 7, 'Carga manual — Aluguéis', 'Imóveis disponíveis informados para abril de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('rh-marketing-clientes', 'imoveis_disponiveis', date '2026-05-01', 'total', null, 7, 'Carga manual — Aluguéis', 'Imóveis disponíveis informados para maio de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('rh-marketing-clientes', 'imoveis_disponiveis', date '2026-06-01', 'total', null, 7, 'Carga manual — Aluguéis', 'Imóveis disponíveis informados para junho de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb)
on conflict (area, metric_key, reference_month, dimension_key)
do update set
  dimension_label = excluded.dimension_label,
  value = excluded.value,
  source = excluded.source,
  notes = excluded.notes,
  metadata = excluded.metadata,
  updated_at = now();

commit;
