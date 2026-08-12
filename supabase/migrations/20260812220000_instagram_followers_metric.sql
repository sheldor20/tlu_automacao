begin;

insert into public.management_metric_catalog (
  area, metric_key, label, description, unit, display_order, allows_breakdown
) values (
  'rh-marketing-clientes',
  'instagram_seguidores',
  'Seguidores no Instagram',
  'Quantidade de seguidores do perfil oficial da Terra Lótus no Instagram.',
  'integer',
  70,
  false
)
on conflict (area, metric_key) do update set
  label = excluded.label,
  description = excluded.description,
  unit = excluded.unit,
  display_order = excluded.display_order,
  allows_breakdown = excluded.allows_breakdown,
  active = true;

commit;
