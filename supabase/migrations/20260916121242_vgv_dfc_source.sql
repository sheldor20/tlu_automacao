begin;

update public.management_metric_catalog
set description = 'Previsto de Entrada (coluna azul) do Detalhamento Fluxo de Caixa Realizado + Projetado (DFC), Grupo Empresa = Terra Lótus, do início do mês até 31/12/2200, incluindo todos os agrupadores financeiros.'
where area = 'novos-negocios' and metric_key = 'vgv_total_receber';

update public.management_metric_catalog
set description = 'Saldo remanescente após as entradas previstas por Período no DFC em cada ano; cronograma conciliado com o total da coluna azul.'
where area = 'novos-negocios' and metric_key = 'vgv_saldo_anual';

update public.data_connections
set description = 'Previsto de Entrada do DFC do grupo Terra Lótus, por período; inadimplência mantém a fonte existente.',
    settings = settings || jsonb_build_object(
      'finance_sheet_id', '72ebe537-eacc-4f5e-95f7-6172c3788a51',
      'finance_object_id', 'e700f385-3486-49eb-ac6b-e9ab723b253e',
      'date_field', 'Período',
      'period_start', 'first_day_of_reference_month',
      'period_end', '2200-12-31',
      'financial_group', 'all',
      'measure', '(+) Previsto Entrada')
where slug = 'qlik-vgv';

commit;
