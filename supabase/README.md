# Configuração do Supabase

## 1. Criar o banco

No painel do Supabase, abra **SQL Editor > New query** e execute as migrations
abaixo, uma por vez e nesta ordem:

Antes de executar, confirme no seletor **Role** do SQL Editor que está marcado
`postgres`. Não use `authenticated`: essa função representa os usuários do app e
não é proprietária das tabelas, portanto recebe o erro `must be owner of table`.

1. `migrations/20260811120000_initial_schema.sql`
2. `migrations/20260811190000_business_project_link_and_project_archiving.sql`
3. `migrations/20260811203000_operational_archiving_supplies_and_user_directory.sql`
4. `migrations/20260811220000_rentals_and_department_access.sql`
5. `migrations/20260812100000_operational_simplicity.sql`
6. `migrations/20260812170000_management_indicators.sql`
7. `migrations/20260812200000_asc_nps_catalog.sql`
8. `migrations/20260812220000_instagram_followers_metric.sql`
9. `migrations/20260812230000_finance_purchases_area.sql`
10. `migrations/20260812240000_indicator_access_by_area.sql`
11. `migrations/20260812250000_data_connections_and_qlik_delinquency.sql`
12. `migrations/20260813110000_qlik_legal_sales_connection.sql`
13. `migrations/20260813150000_qlik_finance_and_climate.sql`
14. `migrations/20260813200000_operations_access_and_public_work_updates.sql`
15. `migrations/20260813210000_manual_management_indicator_values.sql`
16. `migrations/20260813220000_manual_rental_availability_history.sql`
17. `migrations/20260813230000_cash_available_and_traction_history.sql`
18. `migrations/20260813240000_manual_rental_availability_july.sql`
19. `migrations/20260813250000_validated_rental_balance_override.sql`
20. `migrations/20260814090000_business_property_registration.sql`
21. `migrations/20260814120000_work_schedule_inspections_and_standalone_tasks.sql`
22. `migrations/20260814220000_public_work_offline_submissions.sql`
23. `migrations/20260814230000_construction_progress_maps.sql`

Em instalações que já executaram as migrations anteriores, rode apenas a nova.

Esse SQL cria:

- tabelas, enums, índices e views dos quatro departamentos;
- histórico automático de fases de Novos Negócios;
- criação automática de uma obra ao mover um negócio para `Obra`;
- cálculo ponderado do avanço das obras;
- regra que exige uma nova evidência antes de alterar o avanço de uma micro etapa;
- cálculo de progresso e alertas de projetos;
- arquivamento e exclusão de negócios, obras e projetos;
- insumos opcionais com valor, quantidade total, estoque atual e consumo calculado;
- diretório de responsáveis sincronizado com os usuários do Supabase;
- departamento de Aluguéis com dados contratuais, locação, comissão e reajuste;
- modelos persistidos de loteamento, construção e projeto;
- criação transacional de obras e projetos a partir de modelos;
- resumos operacionais para a página Hoje e filtros por exceção;
- reaproveitamento de responsável, datas e documentos quando um negócio gera uma obra;
- RLS por departamento, com menu e dados limitados às permissões de cada usuário;
- buckets privados de evidências e arquivos.
- painel gerencial com seis visões, incluindo Finanças e Compras, catálogo de indicadores e valores mensais;
- resumos seguros de Novos Negócios, Obras e Aluguéis para a gestão;
- atualização automática do painel por Supabase Realtime.
- acesso individual às seis visões de Indicadores, protegido também por RLS.
- catálogo de conexões externas e histórico auditável das cargas do Qlik Cloud;
- conexão semanal de estoque, vendas, distratos e posições de escrituração.
- conexão semanal de saldos, receitas, despesas e planos de contas do Qlik Financeiro;
- carga inicial idempotente da pesquisa de clima com nota 6,9.
- acesso completo ou restrito às tarefas envolvidas em Projetos, com permissões separadas para arquivos e atualizações;
- links públicos revogáveis para atualização de avanço, estoque e fotos de Obras, sem exposição financeira;
- edição segura do histórico de avanço e exclusão transacional de etapas e microetapas.
- plantas PDF privadas, calibração por escala e medição linear/por área vinculada às microetapas;
- atualização do mapa pelo link de campo, inclusive offline, com foto e prevenção de dupla contagem.

## 2. Alimentar os indicadores gerenciais

As integrações e cargas futuras devem gravar em `management_indicator_values`.
Cada competência usa sempre o primeiro dia do mês e o par
`area + metric_key` deve existir em `management_metric_catalog`.

Exemplo de atualização idempotente:

```sql
insert into public.management_indicator_values (
  area, metric_key, reference_month, dimension_key, value, source
) values (
  'empresa', 'receita_consolidada', '2026-08-01', 'total', 1250000, 'ERP'
)
on conflict (area, metric_key, reference_month, dimension_key)
do update set
  value = excluded.value,
  source = excluded.source,
  updated_at = now();
```

Para abrir receitas ou despesas por plano de contas, use uma linha por conta,
preenchendo `dimension_key` e `dimension_label`. O dashboard identifica a
competência mais recente e monta a composição automaticamente.

## 3. Administrar usuários

Depois da migration, o usuário mais antigo do Supabase vira o administrador
inicial. Entre no sistema e abra **Administração** para criar novos usuários,
liberar departamentos e escolher quais visões de Indicadores cada pessoa pode
abrir. Não habilite cadastro público no aplicativo.

## 4. Configurar o Vercel

Em **Settings > Environment Variables** do projeto Vercel, adicione:

```env
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=SUA-CHAVE-PUBLICA
SUPABASE_SERVICE_ROLE_KEY=SUA-CHAVE-SERVICE-ROLE
```

Use somente a chave pública (`anon`/publishable) no `NEXT_PUBLIC_*`. A chave
`service_role` é usada somente pelo endpoint protegido do servidor para criar
usuários. Nunca use o prefixo `NEXT_PUBLIC_` nessa variável.

Para as cargas de inadimplência, vendas, escrituração e financeiro, adicione também em **Production**:

```env
CRON_SECRET=um-segredo-longo-e-aleatorio
QLIK_USERNAME=seu-usuario-do-qlik
QLIK_PASSWORD=sua-senha-do-qlik
```

Para os resumos executivos da pauta de Projetos e a leitura da captura semanal
do Instagram, configure opcionalmente:

```env
OPENAI_API_KEY=sua-chave-da-api
OPENAI_MEETING_MODEL=gpt-5.6
OPENAI_VISION_MODEL=gpt-5.6
OPENAI_PROCESS_MODEL=gpt-5.6
```

Sem `OPENAI_API_KEY`, a pauta continua sendo gerada com resumo determinístico e
o Instagram tenta as superfícies públicas HTML/JSON. Capturas do Instagram são
processadas somente em memória e não são gravadas.

A mesma chave habilita a geração da versão 1 de Processos a partir de um PDF.
Esse fluxo não possui fallback: sem a chave, o cadastro manual permanece
disponível. Depois do merge, execute também a migration
`20260822010000_process_pdf_v1.sql`, que cria o bucket privado
`process-documents` e as políticas de acesso.

Para disponibilizar arquivamento, restauração e exclusão em Processos e Pauta e
RA, execute em seguida `20260822020000_archive_delete_processes_ra.sql`. A
migration mantém RAs arquivadas em modo somente leitura e permite que o PDF
fonte seja limpo depois da exclusão definitiva de um processo.

As credenciais são lidas apenas pelo endpoint no servidor e não são armazenadas
nas tabelas. `data_connections` guarda somente a configuração não sensível;
`data_connection_runs` registra sucesso, falha, duração e quantidade de linhas.
Após salvar as variáveis na Vercel, faça um novo deploy e execute a primeira
carga conforme o comando PowerShell descrito no README principal.

## 5. Habilitar os e-mails de status e das ATAs

Crie uma chave no Resend e adicione no Vercel:

```env
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=Terra Lotus <projetos@seudominio.com.br>
```

O endpoint valida o token do Supabase antes do envio e registra cada disparo em
`email_dispatches` ou `ra_email_dispatches`. O remetente precisa estar
autorizado no Resend. Para a RA, essas variáveis são opcionais: sem elas ou em
caso de falha do provedor, a reunião ainda é encerrada e a ATA é persistida.
