# TLU Automação

Sistema de gestão integrada da Terra Lótus Urbanismo para Novos Negócios, Obras,
Projetos e Aluguéis.

## Módulos

- **Novos Negócios:** funil, VGV potencial, conversão, tempo por fase, mapa,
  arquivamento e transferência automática para Obras.
- **Obras:** portfólio, orçamento mensal, macro e microetapas, estoque e consumo
  calculado de insumos, modelos prontos, fotos opcionais nas vistorias, mapa de avanço
  sobre plantas PDF e relatório.
- **Projetos:** quadro de tarefas, diretório de usuários do Supabase, prazos,
  alertas, comentários, arquivos, envolvidos e e-mail de status.
- **Aluguéis:** imóveis, contratos, atualização direta de status e dados-base de
  locação, comissão e reajuste.
- **Processos:** catálogo de fluxos operacionais, regras, políticas, etapas e
  consulta assistida.
- **Pauta e RA:** preparação de reuniões, tópicos, tarefas, definições, ATA e
  envio opcional por e-mail.
- **Hoje:** tarefas atribuídas, projetos e obras sob responsabilidade do usuário,
  além das exceções dos departamentos que ele pode acessar.
- **Indicadores:** seis visões gerenciais com acesso individual por usuário.
- **Administração:** criação de usuários, acesso por departamento e seleção das
  visões de Indicadores, aplicados ao menu e às políticas RLS do Supabase.

## Permissões nos alertas do Hoje

Antes de publicar a correção, aplique a migration
`20260916202418_today_alert_department_permissions.sql`. Ela adiciona a consulta
das áreas permitidas na visão selecionada e restringe as notificações às tarefas
acessíveis e ainda atribuídas ao destinatário. O contador do menu usa essa mesma
regra de leitura por meio da função existente `current_user_today_alert_count`.

Ao consultar outra pessoa, o Hoje usa apenas os departamentos aos quais **ambos**
têm acesso. As permissões são recarregadas em Atualizar e ao voltar para a aba;
falhas de leitura não preservam alertas antigos. Administradores mantêm acesso a
todas as áreas na própria visão, conforme a regra da Administração.

O teste `tests/today-alert-permissions-database.test.ts` reproduz a exposição de
notificações antes da migration e valida permissões, revogação, liderança,
usuários inativos, leitura de notificações e o contador com as políticas reais.

## Resolver alertas no Hoje

Aplique `20260916203610_resolve_today_alerts.sql` depois da migration de
permissões e antes de publicar a interface. O botão **Resolver** retira o alerta
dos pendentes e atualiza o contador do menu, sem concluir a tarefa, a vistoria
ou alterar o imóvel. A resolução é individual e persiste entre sessões.

Em **Resolvidos**, o próprio usuário pode usar **Reabrir**. Ao consultar outra
pessoa, administradores e líderes veem o estado dos alertas, mas não podem
resolver por ela. As permissões de departamento e de cada item continuam valendo.

Novos prazos, ciclos de vistoria, reajustes, atribuições ou uma tarefa reaberta
geram novas ocorrências. Uma nova entrada do imóvel em reforma também volta a
alertar; atualizações cadastrais e sincronizações sem mudança de situação não
desfazem a resolução. A lista de resolvidos mostra as ocorrências ainda vigentes.

`today_alerts` e `current_user_today_alert_count` consultam a mesma origem no
banco. O teste `tests/today-alert-resolution-database.test.ts` cobre persistência,
reabertura, idempotência, novas ocorrências e tentativas de acesso indevido.

## Ideias no HOJE

O botão **Enviar ideia** abre um campo de texto para sugestões de melhoria do
TLU Space, da rotina do time e de automação. A tabela `improvement_ideas` guarda
a mensagem, o usuário conectado e a data do envio. Usuários ativos podem enviar
e ler suas próprias ideias; administradores podem consultar todas no banco.

Aplique `supabase/migrations/20260917122124_today_improvement_ideas.sql` antes
de publicar a interface. Não são necessárias novas variáveis de ambiente.

## Desenvolvimento

```bash
npm install
cp .env.example .env.local
npm run dev
```

O banco e o passo a passo de configuração estão em [supabase/README.md](supabase/README.md).

## Criação de projetos com acesso liberado no Adm

Antes do deploy, aplique
`supabase/migrations/20260915140858_fix_project_creation_rls.sql` no Supabase.
Ela corrige a criação por usuários com **Gestão completa** em Projetos ou
Governança, mantendo as políticas de acesso por área e envolvimento.

O criador entra na lista de envolvidos. Se escolher outro responsável, ambos
ficam vinculados ao projeto; o vínculo do criador pode ser removido normalmente.
Projeto, envolvidos e tarefas do modelo são gravados na mesma transação.
O botão de criação consulta a permissão da área atual e só aparece após a
confirmação do banco.

`npm test` inclui testes de integração em PostgreSQL local em memória (PGlite),
com as migrations, funções, triggers e políticas RLS do repositório. A suíte
reproduz o erro anterior, aplica a correção e valida criação, modelos,
cancelamento integral em caso de falha e bloqueios de acesso. Não exige Docker
nem credenciais de produção.

## Pauta e RA

O fechamento de uma RA usa `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` para gerar e
persistir a ATA. O envio aos participantes é opcional e ocorre quando estas duas
variáveis estão configuradas no servidor/Vercel:

```env
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=Terra Lotus <projetos@seudominio.com.br>
```

`RESEND_FROM_EMAIL` deve usar um remetente válido e autorizado no Resend. Sem
essas variáveis, com destinatários inválidos ou se o provedor falhar, a RA ainda
é encerrada e a ATA permanece disponível no sistema; a interface informa que o
e-mail não foi enviado. Somente e-mails válidos dos participantes são usados.

Líderes e administradores podem arquivar uma RA para mantê-la disponível em
modo somente leitura ou excluí-la definitivamente. A exclusão remove pauta,
ATA, definições e histórico de envios, mas preserva as tarefas que já foram
criadas no sistema.

## Processos por PDF

Ao criar um processo, um gestor pode enviar um PDF de até 4 MB para gerar a
versão 1 em formato de rascunho. Nome, área, objetivo, regras, políticas e etapas
são preenchidos para revisão humana antes da criação. O documento original fica
no bucket privado `process-documents` e pode ser consultado por link temporário.

Depois do merge, execute
`supabase/migrations/20260822010000_process_pdf_v1.sql` no SQL Editor do
Supabase com a role `postgres`. Na Vercel, configure e publique um novo deploy:

```env
OPENAI_API_KEY=sk-...
OPENAI_PROCESS_MODEL=gpt-5.6
```

`OPENAI_PROCESS_MODEL` é opcional. Sem `OPENAI_API_KEY`, o cadastro manual de
processos continua funcionando, mas a geração por PDF mostra uma orientação de
configuração e não envia o arquivo.

Gestores podem arquivar/restaurar processos ou excluí-los definitivamente. A
exclusão também limpa as etapas e tenta remover o PDF fonte do bucket privado.

Para habilitar o arquivamento de RA e a limpeza segura dos documentos de
Processos, execute depois do merge:

`supabase/migrations/20260822020000_archive_delete_processes_ra.sql`

## Mapa de avanço físico

Depois do merge, execute `supabase/migrations/20260814230000_construction_progress_maps.sql`
no SQL Editor com a role `postgres`. A migration cria o bucket privado
`construction-plans`, as tabelas de plantas/camadas/medições e o processamento
atômico que atualiza a microetapa com a evidência correspondente.

O fluxo funcional é:

1. adicionar os PDFs no botão **Plantas técnicas** de Novos Negócios;
2. abrir a aba **Mapa físico** da obra e calibrar dois pontos com uma distância conhecida;
3. criar uma camada, vinculá-la a uma microetapa e desenhar o total previsto;
4. aprovar a base e registrar trechos executados, com foto opcional;
5. usar o mesmo mapa no link público de campo, inclusive offline após a primeira abertura.

Não existem novas variáveis de ambiente. PDFs ficam privados e o link público
entrega somente as bases aprovadas, sem expor arquivos financeiros.

## Carteiras de Novos Negócios

Depois do merge, execute
`supabase/migrations/20260908120000_new_business_portfolios_and_files.sql`
no SQL Editor com a role `postgres`. A migration mantém os negócios existentes
na **Esteira de negócios**, cria as carteiras de **Prospecção** e **Landing Bank**,
os buckets privados de anexos e localização KMZ e restringe a exclusão definitiva
de áreas à Prospecção.

Novos cadastros exigem um KMZ. O sistema extrai o ponto central da área para o
atalho do Google Maps; imagens, PDFs e vídeos podem ser adicionados depois pelo
botão de arquivos de cada negócio atual.

Execute também, nesta ordem e em execuções separadas,
`supabase/migrations/20260908170000_add_awaiting_business_stage.sql` e
`supabase/migrations/20260908170100_single_business_funnel_by_stage.sql`.
A primeira migration cria e confirma a fase inicial **Aguardando**; a segunda
aplica os 21 status individuais da planilha recebida e transforma os três menus em partes de um único funil:
Landing Bank mostra Aguardando; Prospecção mostra Prospecção, Viabilidade,
Contrato e Mercado e negócio; e Esteira mostra Masterplan, Aprovação e Obra.
Ao alterar a fase, o negócio muda de menu automaticamente sem perder histórico,
KMZ, anexos ou o projeto relacionado.

Para liberar vídeos maiores, execute também
`supabase/migrations/20260908150000_business_video_upload_limit.sql` e configure
o **Global file size limit** do Storage em pelo menos 2 GB. Imagens e PDFs
continuam limitados a 100 MB; vídeos aceitam até 2 GB e usam envio retomável.

## Sincronização semanal do NPS

O endpoint `/api/cron/nps` autentica no ASCSAC e consulta separadamente os 12
meses do ano. Ele calcula somente a média agregada, de 0 a 5, da pergunta de
recomendação e faz `upsert` em `management_indicator_values`. Respostas
individuais e dados pessoais não são gravados.

No projeto da Vercel, configure estas variáveis apenas no ambiente **Production**:

- `ASCSAC_USERNAME`: usuário do portal;
- `ASCSAC_PASSWORD`: senha do portal;
- `ASCSAC_SURVEY_ID`: código da pesquisa (atualmente `1`);
- `CRON_SECRET`: segredo longo e aleatório usado pela Vercel para autenticar o cron;
- `SUPABASE_SERVICE_ROLE_KEY`: chave de servidor já usada pelo sistema;
- `NEXT_PUBLIC_SUPABASE_URL`: URL do projeto Supabase.

Nunca grave credenciais no Git. O `vercel.json` agenda a atualização para toda
segunda-feira às 09:00 UTC (06:00 no horário de Brasília). Para reprocessar um
ano manualmente, faça uma requisição autenticada para
`GET /api/cron/nps?year=2026` com o cabeçalho
`Authorization: Bearer <CRON_SECRET>`.

## Seguidores do Instagram

O endpoint `/api/cron/instagram-followers` consulta diariamente a contagem
agregada de seguidores do perfil público `@terralotusurbanismo`. A leitura é
anônima e tenta, em paralelo, o JSON público usado pela página, os metadados do
perfil e a versão incorporada. Não usa login, cookies, token nem coleta dados
individuais de seguidores. Se o Instagram bloquear uma execução ou alterar a
página, o último valor válido permanece no indicador.

Não existem variáveis específicas do Instagram para configurar. O endpoint usa
somente `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` e
`NEXT_PUBLIC_SUPABASE_URL`, que já são necessários para as outras rotinas.

O cron roda diariamente às 10:00 UTC (07:00 no horário de Brasília). Para uma
primeira carga manual, faça `GET /api/cron/instagram-followers` com o mesmo
cabeçalho `Authorization: Bearer <CRON_SECRET>` usado pelo cron de NPS.

## Sincronização da inadimplência no Qlik Cloud

O endpoint `/api/cron/qlik/delinquency` abre a planilha **Overview
Inadimplência Por Posição / Competência Fechada** em um navegador isolado,
autentica no Qlik e aplica novamente, em cada execução, os filtros obrigatórios:

- `Empreendimento? = Sim`;
- `Cobrável? = Sim`;
- `Venda Jurídico? = Não`.

Antes de gravar, a rotina valida as três seleções, os nomes das dez colunas e a
existência do mês anterior como `Concluído`. Linhas `Em Curso` são ignoradas.
`Inadimplência Saldo` alimenta `inadimplencia_total` e `Redução Inadimplência`
alimenta `eficiencia_cobranca`. Se a tela, os filtros ou o fechamento mudarem,
a carga falha e mantém o último valor válido.

No projeto da Vercel, configure somente no ambiente **Production**:

- `QLIK_USERNAME`: usuário do Qlik Cloud;
- `QLIK_PASSWORD`: senha do Qlik Cloud;
- `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` e `NEXT_PUBLIC_SUPABASE_URL`: as
  mesmas variáveis já usadas pelas outras rotinas.

Não grave usuário ou senha no Git nem no Supabase. A URL da planilha e o objeto
`jJTqUzF` já possuem valores padrão. `QLIK_DELINQUENCY_SHEET_URL` e
`QLIK_DELINQUENCY_TABLE_OBJECT_ID` são opcionais e servem apenas para uma futura
mudança no Qlik.

O cron roda toda segunda-feira às 10:30 UTC (07:30 em Brasília). Depois de
configurar as variáveis e publicar um novo deploy, a primeira carga pode ser
disparada no PowerShell:

```powershell
$secret = Read-Host "CRON_SECRET"
$headers = @{ Authorization = "Bearer $secret" }
Invoke-RestMethod -Method Get -Uri "https://www.terralotus.space/api/cron/qlik/delinquency" -Headers $headers
```

O retorno mostra a competência fechada mais recente, o saldo de inadimplência,
o percentual de redução e a série histórica importada.

Se a chamada retornar erro do servidor, valide primeiro somente o navegador,
sem abrir o Qlik e sem gravar dados:

```powershell
Invoke-RestMethod -Method Get -Uri "https://www.terralotus.space/api/cron/qlik/delinquency?diagnostic=browser" -Headers $headers
```

O diagnóstico informa se a falha ocorreu ao carregar ou ao iniciar o Chromium.
O navegador serverless usa `@sparticuz/chromium` com `puppeteer-core`, evitando
arquivos auxiliares do Playwright que não são empacotados nas funções da Vercel.
Na carga normal, erros também retornam o campo `phase`, que identifica se o
problema ocorreu no navegador, na abertura do Qlik, na validação da tabela ou na
gravação no Supabase. Nenhuma credencial é incluída nessas mensagens.

## Sincronização de vendas e escrituração no Qlik Cloud

O endpoint `/api/cron/qlik/legal-sales` usa a mesma autenticação protegida do
Qlik e alimenta oito indicadores da visão **Jurídico, Vendas e Cobrança**:

- estoque mensal de unidades disponíveis;
- vendas e distratos mensais;
- contagens acumuladas de quitadas, sem processo, autorizadas, em escrituração
  sem registro e registradas, usando **Último Recebimento** até o último dia
  de cada mês fechado (inclusive fins de semana).

A carga localiza as visualizações nas respectivas planilhas e recalcula de
janeiro até o último mês fechado em São Paulo a cada execução. Para as cinco
contagens, não se aplica limite inferior de data: recebimentos de anos anteriores
continuam incluídos. O cálculo subtrai do total apenas recebimentos posteriores
ao fechamento; unidades sem data permanecem no total, conforme a conciliação
de agosto (3.344 − 4 = 3.340). Julho exclui recebimentos de agosto em diante; agosto exclui
setembro em diante. O campo deve corresponder exatamente a **Último Recebimento**
(acentos e maiúsculas são normalizados), sem fallback para data de posição,
venda ou calendário. O gráfico Sem processo vs Autorizadas usa essas séries.

As oito séries são validadas e substituídas em uma única transação. Falhas na
leitura ou validação preservam a última carga válida. A atualização manual e o
cron usam a mesma regra e reprocessam também os meses anteriores.

Não há novas credenciais para configurar: o endpoint reutiliza
`QLIK_USERNAME`, `QLIK_PASSWORD`, `CRON_SECRET`,
`SUPABASE_SERVICE_ROLE_KEY` e `NEXT_PUBLIC_SUPABASE_URL`. O cron roda toda
segunda-feira às 11:00 UTC (08:00 em Brasília), depois da inadimplência.

Depois do merge e do deploy, execute a migration
`20260813110000_qlik_legal_sales_connection.sql` no SQL Editor do Supabase. No
Mac, a primeira carga pode ser disparada no Terminal com:

```bash
read -s "CRON_SECRET?CRON_SECRET: "; echo
curl --fail-with-body \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://www.terralotus.space/api/cron/qlik/legal-sales"
unset CRON_SECRET
```

O JSON de sucesso traz `current` com os oito valores vigentes, `series` com os
meses de estoque, vendas, distratos, quitadas, sem processo e autorizadas, além
do total de linhas lidas e gravadas.

## Sincronização financeira no Qlik Cloud

O endpoint `/api/cron/qlik/finance` reutiliza a autenticação protegida do Qlik
e alimenta as visões **Empresa** e **Finanças e Compras**. A carga aplica os
recortes de grupo, conta bancária, plano de contas e fluxo financeiro de cada
indicador, percorre de janeiro ao mês vigente e grava:

- saldo da conta de aluguéis, recebimentos e gastos de aluguel;
- receitas, despesas, resultado gerencial e caixa mensais;
- composição de receitas e despesas por plano de contas no mês anterior
  fechado.

Os cards de receita e despesa da Empresa somam os meses do ano vigente. O
resultado gerencial continua mensal e é calculado por receita menos despesa. A
posição de caixa preserva no metadado a última data encontrada no mês.

O saldo de aluguéis vem da tabela **Composição Saldo Inicial | Contas** do
DFC (objeto `883da608-a05c-442b-9304-c5bb1d8eaa5e`). A leitura seleciona
exatamente as nove contas da Caixa definidas em
`data_connections.settings.rental_bank_accounts` (configuração protegida,
fora do repositório público),
no estado `<estado alternativo 01>`, e ajusta `vPosicaoInicialDFC` e
`vPosicaoFinalDFC` para o último dia de cada mês (hoje para o mês em aberto).
Isso reproduz o período exibido no DFC e preserva sua medida nativa de saldo
inicial, sem substituí-la pelo saldo projetado ou pela data de vencimento.
Todas as linhas são somadas e reconciliadas com o total do Qlik; os valores
por conta ficam nos metadados. Ajustes manuais antigos desse indicador são
ignorados. Sessões de extração isoladas impedem que ações da tela alterem os
filtros durante a leitura.

Não há novas variáveis de ambiente: são reutilizadas `QLIK_USERNAME`,
`QLIK_PASSWORD`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` e
`NEXT_PUBLIC_SUPABASE_URL`. O cron roda às segundas-feiras, 11:30 UTC (08:30 em
Brasília), depois das outras cargas do Qlik.

Depois do merge e do deploy, execute a migration
`20260813150000_qlik_finance_and_climate.sql` no SQL Editor do Supabase. Ela
também grava de forma idempotente a nota atual de clima `6,9`. Em seguida,
dispare a primeira carga no Terminal do Mac:

```bash
read -s "CRON_SECRET?CRON_SECRET: "; echo
curl --fail-with-body \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://www.terralotus.space/api/cron/qlik/finance"
unset CRON_SECRET
```

Se algum nome de campo ou visualização do aplicativo financeiro for diferente,
o retorno informa a etapa, os candidatos procurados e os campos ou valores
disponíveis no Qlik; nesse caso, envie o JSON completo para ajustar o mapeamento
sem substituir a última carga válida.

## Resumo individual por email em dias úteis

O cron `/api/cron/daily-digest` gera os resumos de segunda a sexta às **07:45
de Brasília** (`45 10 * * 1-5` em UTC). O cron `/api/cron/daily-digest/retry`
processa somente a fila já criada a cada cinco minutos; não gera novos resumos.
Ambas as rotas exigem `Authorization: Bearer <CRON_SECRET>` e são executadas
automaticamente somente no ambiente de produção da Vercel.

Cada perfil ativo, não excluído e com email válido recebe uma mensagem individual:

- tarefas pendentes com prazo hoje e tarefas vencidas, incluindo tarefas com
  subtarefas pendentes atribuídas à pessoa (prazo da tarefa principal);
- movimentações de solicitações próprias; administradores e gestores de
  pagamentos também recebem as movimentações que podem gerir;
- botão **Acessar o sistema**, levando a `/hoje`, e links para os itens;
- na ausência desses itens, **Comece a usar o Terra Lótus Space**, com botão
  **Começar a usar**. Tarefas futuras não contam como pendência do resumo.

O email apresenta até dez itens por seção e o total completo. Tarefas concluídas,
projetos arquivados e departamentos não autorizados são excluídos. Eventos de
pagamento são agrupados por solicitação, mostrando a última movimentação no
intervalo. Não são incluídos anexos, dados bancários ou links públicos com token.
O intervalo vai do corte do último resumo enviado até 07:45 de hoje; no primeiro
envio, usa 07:45 do dia útil anterior. Assim, a segunda-feira inclui o fim de
semana e uma falha de envio não descarta as movimentações do dia anterior.

Antes de publicar, aplique a migration
`20260917121514_weekday_daily_digest.sql`. Configure no servidor:
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`,
`RESEND_API_KEY`, `RESEND_FROM_EMAIL` e a origem HTTPS `APP_URL`. Na ausência de
`APP_URL`, reaproveita `PAYMENT_APP_URL` ou `VERCEL_PROJECT_PRODUCTION_URL`.
O remetente deve estar autorizado no Resend e o plano Vercel deve suportar
agendamento por minuto.

A tabela privada para a API `daily_digest_outbox` registra um envio por usuário e
data, estados, tentativas e identificador do provedor. Locks com lease impedem
workers simultâneos de assumir a mesma mensagem. O corpo fica congelado antes do
primeiro envio, com chave de idempotência estável no Resend. Novas tentativas têm
espera progressiva, até oito tentativas e no máximo até meia-noite de Brasília;
um resumo vencido não é reenviado no dia seguinte. A função revalida o usuário,
email e acesso aos itens antes de enviar, inclusive nas tentativas seguintes.

As verificações `tests/daily-digest*.test.ts` exercitam o banco com as migrations
reais e o envio com provedor simulado, sem enviar mensagens reais. Para acompanhar
falhas, consulte os estados `failed`, `expired` e `skipped` da fila e os logs das
rotas. `sent` indica aceite pelo provedor, não confirmação de entrega na caixa de entrada.

## Segurança

- sem cadastro público no front-end;
- autenticação pelo Supabase;
- RLS em todas as tabelas operacionais;
- storage privado e URLs temporárias;
- validação do token no endpoint de e-mail;
- variáveis sensíveis apenas no servidor;
- credenciais de integrações somente em variáveis protegidas da Vercel;
- acesso efetivo por departamento no menu, nas tabelas e nos arquivos privados.

## VGV projetado em Novos Negócios

A visão `/indicadores/novos-negocios` apresenta o total a receber da carteira,
a taxa geral atual de inadimplência e o valor ajustado por essa taxa. A curva
mostra o saldo após os recebimentos previstos até o final de cada ano.

A rotina `/api/cron/qlik/vgv` usa as credenciais Qlik já configuradas e roda às
segundas-feiras às 12:00 UTC (09:00 em Brasília). O botão **Atualizar** do painel
executa a mesma rotina com validação da sessão e do acesso a Novos Negócios.

- Fonte do VGV: **BI — Gestão Financeira → Detalhamento Fluxo de Caixa
  Realizado + Projetado (DFC) → (+) Previsto Entrada**, a coluna azul.
- Filtro: `Grupo Empresa = Terra Lótus`. O total inclui todos os agrupadores
  e fluxos financeiros; selecionar apenas Dividendos excluiria outras entradas.
- Período: primeiro dia do mês da leitura até **31/12/2200**. As variáveis
  `vPosicaoInicialDFC` e `vPosicaoFinalDFC` são aplicadas como datas numéricas
  com apresentação brasileira e conferidas antes da leitura. Previsões ficam
  habilitadas e movimentos InterCompany continuam incluídos, como no Qlik.
- O total vem do rodapé da coluna azul. O cronograma reutiliza a mesma medida
  e agrega por `Período`, sem importar dados de clientes ou parcelas.
- Fonte da taxa: segunda medida do KPI **Inadimplência** em **Multi Análises |
  Inadimplência**, visão geral sem filtros adicionais. Essa origem não mudou.
- O ajuste usa `total a receber × (1 − taxa / 100)` com a precisão numérica
  original. A interface exibe a taxa com duas casas decimais.
- A soma das entradas previstas por ano deve conciliar com o total da coluna.
  O saldo anual desconta as entradas de cada ano, incluindo todo o mês inicial
  selecionado. Falhas preservam o último snapshot válido; cartões e anos são
  gravados na mesma transação, com origem, filtros, período e data da carga.
- A leitura do DFC usa uma sessão isolada, sem alterar a visão de outros usuários.

A migration `20260916121242_vgv_dfc_source.sql` atualiza a descrição e a origem
financeira da conexão existente. Os indicadores, acessos, frequência automática
 e origem da inadimplência são preservados.

## Fotos opcionais nas vistorias de obras

A migration `20260914195733_optional_construction_inspection_photos.sql` deve
ser aplicada antes do deploy. Ela permite registros sem imagem, mantendo o
histórico, os comentários e a identificação de cada envio para evitar duplicatas.
Vistorias com o mesmo percentual de avanço também aparecem no histórico.

A foto é opcional na atualização da microetapa e na medição pelo mapa, tanto
no acesso interno quanto no link público, inclusive na fila offline. Se uma
foto for anexada, as validações de formato e tamanho continuam valendo.

## Arquivos e comentários nas tarefas

No quadro de tarefas, **Arquivos e comentários** permite anexar múltiplos
arquivos (até 20 MB cada), baixar anexos e registrar comentários. O histórico
da tarefa mantém autor e data/hora de cada registro. Em tarefas vinculadas,
os mesmos eventos aparecem em **Atualizações → Atividades das tarefas** no
projeto. As tarefas avulsas usam o mesmo fluxo.

A migration `20260916183159_task_files_comments_activity.sql` cria a tabela
`project_task_activity` e o bucket privado `task-files`. Deve ser aplicada antes
do deploy. As regras exigem acesso à tarefa e respeitam `allow_files` e
`allow_updates`. O banco determina autor, horário, tamanho e tipo do arquivo;
os registros não são editáveis pela API. Downloads usam links temporários.

Os testes em `tests/task-activity.test.ts` cobrem formato e tamanho, registros
vazios, autoria, acesso indevido, bloqueios por perfil e preservação do histórico.

## Carregamento e navegação

A migration `20260917120504_today_dashboard_performance.sql` deve ser aplicada
antes de publicar esta interface. O Hoje usa `today_dashboard` para buscar, em
uma única chamada, as permissões atualizadas, pessoas visíveis, tarefas da pessoa
selecionada e alertas. As tarefas são filtradas no banco e retornam somente os
campos exibidos, incluindo atribuições por subtarefa.

O menu e os Indicadores usam `current_user_app_access` para reunir as leituras
de perfil, departamentos e visões permitidas. As duas funções executam com RLS
do usuário; não há cache persistente de permissões. Eventos de foco e visibilidade
simultâneos são agrupados, e consultas de atualização não se sobrepõem.

`tests/today-dashboard-performance.test.ts` verifica usuário, administrador,
líder, atribuição por subtarefa, resolução e revogação de acesso com as migrations
reais. `tests/refresh-scheduler.test.ts` verifica a deduplicação e cancelamento.
