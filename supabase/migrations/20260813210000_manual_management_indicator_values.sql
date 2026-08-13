-- Terra Lótus Urbanismo — carga manual informada em 13/08/2026.
-- Idempotente: reaplicar atualiza as mesmas competências sem duplicar linhas.

begin;

update public.management_metric_catalog
set description = 'Valor de custos evitados no mês.'
where area = 'financas-compras'
  and metric_key = 'custo_evitado_total';

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
  ('rh-marketing-clientes', 'instagram_seguidores', date '2026-08-01', 'total', null, 3117, 'Carga manual — Instagram', 'Seguidores do perfil @terralotusurbanismo informados em 13/08/2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),

  ('financas-compras', 'custo_evitado_total', date '2026-01-01', 'total', null, 64288.22, 'Carga manual — Finanças e Compras', 'Custo evitado informado para janeiro de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('financas-compras', 'custo_evitado_total', date '2026-02-01', 'total', null, 0.00, 'Carga manual — Finanças e Compras', 'Custo evitado informado para fevereiro de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('financas-compras', 'custo_evitado_total', date '2026-03-01', 'total', null, 156840.00, 'Carga manual — Finanças e Compras', 'Custo evitado informado para março de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('financas-compras', 'custo_evitado_total', date '2026-04-01', 'total', null, 76400.64, 'Carga manual — Finanças e Compras', 'Custo evitado informado para abril de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('financas-compras', 'custo_evitado_total', date '2026-05-01', 'total', null, 258249.39, 'Carga manual — Finanças e Compras', 'Custo evitado informado para maio de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('financas-compras', 'custo_evitado_total', date '2026-06-01', 'total', null, 7246.00, 'Carga manual — Finanças e Compras', 'Custo evitado informado para junho de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('financas-compras', 'custo_evitado_total', date '2026-07-01', 'total', null, 0.00, 'Carga manual — Finanças e Compras', 'Custo evitado informado para julho de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),

  ('financas-compras', 'compras_total', date '2026-01-01', 'total', null, 15, 'Carga manual — Finanças e Compras', 'Total de compras informado para janeiro de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('financas-compras', 'compras_sem_orcamento', date '2026-01-01', 'total', null, 15, 'Carga manual — Finanças e Compras', 'Compras sem orçamento informadas para janeiro de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('financas-compras', 'compras_total', date '2026-02-01', 'total', null, 14, 'Carga manual — Finanças e Compras', 'Total de compras informado para fevereiro de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('financas-compras', 'compras_sem_orcamento', date '2026-02-01', 'total', null, 14, 'Carga manual — Finanças e Compras', 'Compras sem orçamento informadas para fevereiro de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('financas-compras', 'compras_total', date '2026-03-01', 'total', null, 0, 'Carga manual — Finanças e Compras', 'Total de compras informado para março de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('financas-compras', 'compras_sem_orcamento', date '2026-03-01', 'total', null, 0, 'Carga manual — Finanças e Compras', 'Compras sem orçamento informadas para março de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('financas-compras', 'compras_total', date '2026-04-01', 'total', null, 14, 'Carga manual — Finanças e Compras', 'Total de compras informado para abril de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('financas-compras', 'compras_sem_orcamento', date '2026-04-01', 'total', null, 0, 'Carga manual — Finanças e Compras', 'Compras sem orçamento informadas para abril de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('financas-compras', 'compras_total', date '2026-05-01', 'total', null, 83, 'Carga manual — Finanças e Compras', 'Total de compras informado para maio de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('financas-compras', 'compras_sem_orcamento', date '2026-05-01', 'total', null, 0, 'Carga manual — Finanças e Compras', 'Compras sem orçamento informadas para maio de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('financas-compras', 'compras_total', date '2026-06-01', 'total', null, 98, 'Carga manual — Finanças e Compras', 'Total de compras informado para junho de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('financas-compras', 'compras_sem_orcamento', date '2026-06-01', 'total', null, 0, 'Carga manual — Finanças e Compras', 'Compras sem orçamento informadas para junho de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('financas-compras', 'compras_total', date '2026-07-01', 'total', null, 77, 'Carga manual — Finanças e Compras', 'Total de compras informado para julho de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb),
  ('financas-compras', 'compras_sem_orcamento', date '2026-07-01', 'total', null, 0, 'Carga manual — Finanças e Compras', 'Compras sem orçamento informadas para julho de 2026.', '{"manual":true,"informed_on":"2026-08-13"}'::jsonb)
on conflict (area, metric_key, reference_month, dimension_key)
do update set
  dimension_label = excluded.dimension_label,
  value = excluded.value,
  source = excluded.source,
  notes = excluded.notes,
  metadata = excluded.metadata,
  updated_at = now();

commit;
