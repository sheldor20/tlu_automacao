begin;

alter table public.management_metric_catalog drop constraint if exists management_metric_catalog_area_check;
alter table public.management_metric_catalog add constraint management_metric_catalog_area_check
  check (area in ('empresa', 'juridico-vendas-cobranca', 'rh-marketing-clientes', 'financas-compras', 'novos-negocios'));

insert into public.management_metric_catalog (area, metric_key, label, description, unit, display_order, allows_breakdown)
values
  ('novos-negocios', 'vgv_total_receber', 'VGV total a receber', 'Contas A Receber com Grupo Empresa = Terra Lótus.', 'currency', 10, false),
  ('novos-negocios', 'vgv_inadimplencia_atual', 'Inadimplência atual', 'Percentual da visão geral Multi Análises | Inadimplência, sem seleções adicionais.', 'percent', 20, false),
  ('novos-negocios', 'vgv_projetado_liquido', 'VGV projetado após inadimplência', 'VGV total a receber multiplicado por um menos o percentual de inadimplência.', 'currency', 30, false),
  ('novos-negocios', 'vgv_saldo_anual', 'Saldo de VGV por ano', 'Saldo após os vencimentos futuros de cada ano. Valores vencidos permanecem no saldo sem data presumida de recuperação.', 'currency', 40, true)
on conflict (area, metric_key) do update set label = excluded.label, description = excluded.description,
  unit = excluded.unit, display_order = excluded.display_order, allows_breakdown = excluded.allows_breakdown, active = true;

insert into public.data_connections (slug, provider, name, description, schedule_cron, settings)
values ('qlik-vgv', 'qlik-cloud', 'Qlik — VGV projetado', 'Carteira Terra Lótus por vencimento e taxa geral atual de inadimplência.', '0 12 * * 1',
  jsonb_build_object('finance_app_id', 'e3d13862-ec1f-4332-8a5b-df4c7b93fa7c', 'finance_sheet_id', '32a488c2-14d8-4bde-ba4f-35211d75376b',
    'delinquency_app_id', 'ce523abd-dce7-40f5-bd1c-93a23ffa4faa', 'delinquency_sheet_id', '09d28f42-6159-480c-b251-43e1aa39265a',
    'filters', jsonb_build_object('Grupo Empresa', 'Terra Lótus'), 'date_field', 'Data Vencimento'))
on conflict (slug) do update set name = excluded.name, description = excluded.description, schedule_cron = excluded.schedule_cron, settings = excluded.settings;

commit;
