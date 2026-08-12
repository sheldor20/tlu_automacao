-- Terra Lótus Urbanismo — visão de Finanças e Compras.
-- Move as métricas financeiras de aluguéis sem perder o histórico e cria o novo catálogo.

begin;

alter table public.management_metric_catalog
  drop constraint if exists management_metric_catalog_area_check;

alter table public.management_metric_catalog
  add constraint management_metric_catalog_area_check
  check (area in (
    'empresa',
    'juridico-vendas-cobranca',
    'rh-marketing-clientes',
    'financas-compras'
  ));

-- A chave estrangeira usa ON UPDATE CASCADE, portanto os valores históricos
-- acompanham a mudança de área automaticamente.
update public.management_metric_catalog
set area = 'financas-compras'
where area = 'rh-marketing-clientes'
  and metric_key in (
    'saldo_conta_alugueis',
    'receita_alugueis_mes',
    'despesa_alugueis_mes'
  );

update public.management_metric_catalog
set display_order = case metric_key
  when 'saldo_conta_alugueis' then 10
  when 'receita_alugueis_mes' then 20
  when 'despesa_alugueis_mes' then 30
  else display_order
end
where area = 'financas-compras';

insert into public.management_metric_catalog (
  area, metric_key, label, description, unit, display_order, allows_breakdown
) values
  ('financas-compras', 'custo_evitado_total', 'Custo evitado total', 'Valor acumulado de custos evitados na competência.', 'currency', 40, false),
  ('financas-compras', 'compras_total', 'Total de compras', 'Quantidade total de compras realizadas no mês.', 'integer', 50, false),
  ('financas-compras', 'compras_sem_orcamento', 'Compras sem orçamento', 'Quantidade de compras realizadas sem orçamento no mês.', 'integer', 60, false)
on conflict (area, metric_key) do update set
  label = excluded.label,
  description = excluded.description,
  unit = excluded.unit,
  display_order = excluded.display_order,
  allows_breakdown = excluded.allows_breakdown,
  active = true;

commit;
