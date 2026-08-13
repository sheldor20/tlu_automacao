# TLU Automação

Sistema de gestão integrada da Terra Lótus Urbanismo para Novos Negócios, Obras,
Projetos e Aluguéis.

## Módulos

- **Novos Negócios:** funil, VGV potencial, conversão, tempo por fase, mapa,
  arquivamento e transferência automática para Obras.
- **Obras:** portfólio, orçamento mensal, macro e microetapas, estoque e consumo
  calculado de insumos, modelos prontos, evidências obrigatórias e relatório PDF.
- **Projetos:** quadro de tarefas, diretório de usuários do Supabase, prazos,
  alertas, comentários, arquivos, envolvidos e e-mail de status.
- **Aluguéis:** imóveis, contratos, atualização direta de status e dados-base de
  locação, comissão e reajuste.
- **Hoje:** tarefas atribuídas, projetos e obras sob responsabilidade do usuário,
  além das exceções dos departamentos que ele pode acessar.
- **Indicadores:** seis visões gerenciais com acesso individual por usuário.
- **Administração:** criação de usuários, acesso por departamento e seleção das
  visões de Indicadores, aplicados ao menu e às políticas RLS do Supabase.

## Desenvolvimento

```bash
npm install
cp .env.example .env.local
npm run dev
```

O banco e o passo a passo de configuração estão em [supabase/README.md](supabase/README.md).

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
- histórico acumulado de unidades quitadas e autorizadas, com a série de
  unidades sem processo derivada por competência;
- posições atuais de unidades sem processo, em escrituração sem registro e
  registradas.

A carga localiza cada visualização pelo título e pelos nomes das medidas dentro
da planilha, aplica os campos de ano e mês de janeiro até o mês vigente e valida
as oito séries antes de gravar. Se um título ficar ausente ou ambíguo, um mês não
existir ou qualquer contagem não for inteira e não negativa, nenhuma linha da
execução é persistida e o último painel válido permanece disponível.

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
posição de saldo e caixa preserva no metadado a última data encontrada no mês.

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

## Segurança

- sem cadastro público no front-end;
- autenticação pelo Supabase;
- RLS em todas as tabelas operacionais;
- storage privado e URLs temporárias;
- validação do token no endpoint de e-mail;
- variáveis sensíveis apenas no servidor;
- credenciais de integrações somente em variáveis protegidas da Vercel;
- acesso efetivo por departamento no menu, nas tabelas e nos arquivos privados.
