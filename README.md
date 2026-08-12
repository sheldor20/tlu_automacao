# TLU Automação

Sistema de gestão integrada da Terra Lótus Urbanismo para Novos Negócios, Obras,
Projetos e Aluguéis.

## Módulos

- **Novos Negócios:** funil, VGV potencial, conversão, tempo por fase, mapa,
  arquivamento e transferência automática para Obras.
- **Obras:** portfólio, orçamento mensal, macro e micro etapas, pesos, insumos
  estruturados, modelos prontos, evidências obrigatórias, arquivamento e relatório PDF.
- **Projetos:** quadro de tarefas, diretório de usuários do Supabase, prazos,
  alertas, comentários, arquivos, envolvidos e e-mail de status.
- **Aluguéis:** imóveis, contratos, atualização direta de status e dados-base de
  locação, comissão e reajuste.
- **Hoje:** tarefas e exceções operacionais com ações rápidas por departamento.
- **Administração:** criação de usuários e acesso a um ou mais departamentos,
  aplicado ao menu e às políticas RLS do Supabase.

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
agregada de seguidores do perfil `@terralotusurbanismo` pela API oficial do
Instagram/Meta. O valor do mês corrente é atualizado no indicador
`instagram_seguidores`; nenhum dado individual de seguidores é coletado.

Configure apenas no ambiente **Production** da Vercel:

- `INSTAGRAM_ACCOUNT_ID`: ID da conta profissional no Instagram;
- `INSTAGRAM_ACCESS_TOKEN`: token de acesso mantido como segredo;
- `INSTAGRAM_USERNAME`: `terralotusurbanismo`;
- `INSTAGRAM_GRAPH_API_VERSION`: `v25.0`;
- `INSTAGRAM_GRAPH_BASE_URL`: `https://graph.instagram.com`.

O cron roda diariamente às 10:00 UTC (07:00 no horário de Brasília). Para uma
primeira carga manual, faça `GET /api/cron/instagram-followers` com o mesmo
cabeçalho `Authorization: Bearer <CRON_SECRET>` usado pelo cron de NPS.

## Segurança

- sem cadastro público no front-end;
- autenticação pelo Supabase;
- RLS em todas as tabelas operacionais;
- storage privado e URLs temporárias;
- validação do token no endpoint de e-mail;
- variáveis sensíveis apenas no servidor;
- acesso efetivo por departamento no menu, nas tabelas e nos arquivos privados.
