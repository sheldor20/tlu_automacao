-- Terra Lótus Urbanismo — conexão Qlik para vendas e escrituração.
-- As credenciais permanecem exclusivamente nas variáveis protegidas da Vercel.

begin;

insert into public.data_connections (
  slug, provider, name, description, schedule_cron, settings
) values (
  'qlik-legal-sales',
  'qlik-cloud',
  'Qlik — Vendas e Escrituração',
  'Estoque, vendas, distratos e posições de escrituração para o painel Jurídico, Vendas e Cobrança.',
  '0 11 * * 1',
  jsonb_build_object(
    'apps', jsonb_build_array(
      jsonb_build_object(
        'app_id', '91fec9e0-bcf1-4b6e-9675-fc02d9d3c804',
        'sheets', jsonb_build_array('8f9a709f-a02a-4f53-9bea-5e7d0236d7d3'),
        'metrics', jsonb_build_array('unidades_disponiveis')
      ),
      jsonb_build_object(
        'app_id', '465cc478-f1b4-4969-b057-d80a623b6de8',
        'sheets', jsonb_build_array(
          '3a8144df-05ae-4132-9e90-6e73fd51714d',
          'cdc4d2c1-2344-49c8-a279-2b390061fa06',
          'b6e58857-ecec-46f7-bda7-e64bdc60a656',
          '626f7856-4a17-40ee-bf06-2896e76c6083',
          '8b69801a-0e28-4d6f-86a9-a2b04bbd2485',
          '63544267-64b1-4568-8498-a8217f2c04a6'
        ),
        'metrics', jsonb_build_array(
          'vendas_mes',
          'distratos_mes',
          'unidades_quitadas',
          'unidades_sem_processo',
          'unidades_autorizadas_escrituracao',
          'unidades_escrituracao_sem_registro',
          'unidades_registradas'
        )
      )
    ),
    'period', 'current-year-through-current-month',
    'object_resolution', 'sheet-title-and-measure-label',
    'credentials', 'Vercel: QLIK_USERNAME e QLIK_PASSWORD'
  )
)
on conflict (slug) do update set
  provider = excluded.provider,
  name = excluded.name,
  description = excluded.description,
  schedule_cron = excluded.schedule_cron,
  settings = excluded.settings,
  active = true;

commit;
