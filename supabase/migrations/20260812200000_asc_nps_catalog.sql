begin;

update public.management_metric_catalog
set
  label = 'NPS médio dos clientes',
  description = 'Média mensal, de zero a cinco, da pergunta de recomendação do ASCSAC.'
where area = 'rh-marketing-clientes'
  and metric_key = 'nps_clientes';

commit;
