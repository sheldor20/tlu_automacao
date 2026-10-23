# Prestação de contas BETA

Rota: `/prestacao-contas`. O ADM libera o departamento `prestacao-contas` no cadastro do usuário. As consultas e o envio validam a permissão no servidor; as tabelas aplicam RLS. Somente o servidor altera os registros de envio.

O painel usa o ano vigente em America/Sao_Paulo. Os 15 empreendimentos foram conferidos no filtro Qlik. Janeiro a setembro de 2026 estão fechados e possuem 135 registros históricos, conforme confirmação do solicitante. Um teste BETA conserva `historical_sent` e registra o resultado BETA separadamente.

Todos os envios têm destinatário fixo `rosangela@terralotusurbanismo.com.br`; o navegador não recebe opção de destinatário. Nenhuma lista de terceiros foi configurada. `sent_beta` significa aceitação pelo provedor, não confirmação de entrega na caixa de entrada. Timeout durante o envio gera `uncertain`, sem reenvio automático.

## Conexão nativa Qlik

Variáveis do servidor: `QLIK_ACCOUNTABILITY_ENABLED=true`, `QLIK_USERNAME`, `QLIK_PASSWORD`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` e as chaves Supabase existentes. Não há exportador externo. O navegador do servidor mantém segurança de origem habilitada para esta operação.

O servidor abre uma sessão Qlik isolada, seleciona exatamente um empreendimento e um período no filtro nativo e verifica as seleções. Expande todos os níveis da DRE consolidada por alteração temporária de apresentação, captura um bookmark temporário e solicita uma composição nativa das 13 pastas na ordem especificada. A aplicação Qlik não é salva nem seus dados alterados. O timestamp de recarga deve permanecer estável durante a exportação.

O Excel de recebíveis é exportado pelo serviço nativo de relatórios Qlik. A receita detalhada mantém sua página nativa e recebe um apêndice paginado com todas as células formatadas da tabela original. A ordem de apresentação das células QIX é preservada; somente os metadados de cabeçalhos e totais são associados à ordem de colunas. Não há recálculo, arredondamento ou alteração de valores.

O servidor adiciona capa e contracapa com empreendimento e referência. Arquivos ficam em bucket privado, com hashes SHA256 e revisão da origem registrados. Tentativas posteriores reutilizam os mesmos bytes. O envio possui chave de idempotência e marcação atômica de processamento para evitar duplicidades. A resposta inicial inicia a geração e o painel acompanha o status automaticamente.

## Validação real

Em 22/10/2026 foi gerado e conferido o book de setembro de 2026 do Residencial Vale das Águas: 25 páginas, 13 pastas nativas, receita completa com 180 linhas e Excel nativo com 52.025 linhas de dados. A revisão incluiu capa, DRE expandida e associação de valores às colunas da receita. O provedor aceitou o envio BETA para Rosângela e o registro passou para `sent_beta`, preservando o histórico anterior.

Testes automatizados cobrem destinatário fixo, meses fechados/futuros, calendário de São Paulo, composição das 13 pastas, seleções ambíguas, erros de exportação, origem dos downloads, recarga da aplicação e ordem nativa das células. O teste de envio não comprova entrega na caixa de entrada nem substitui a conferência dos demais empreendimentos.

## Recuperação de processamento (patch local de 23/10/2026)

O endpoint de geração agora separa `name` (assunto/corpo do email) de `qlik_value` (filtro da exportação). O destinatário BETA permanece fixo. Não há alteração no exportador Qlik.

Cada tentativa recebe um token e horário de início. Antes do POST ao provedor, o servidor grava `provider_attempted_at` e o envelope do email. A gravação e as atualizações de anexos/resultado exigem o token e o estado atuais: um worker antigo não pode enviar depois que sua tentativa foi recuperada. O limite de 15 minutos supera o `maxDuration=800` da rota e é verificado novamente antes do envio.

“Conferir processamento” chama `POST /api/accountability` com `action=recover` e o ID do registro. Exige a mesma permissão de Prestação de contas; não aceita ID de provedor, destinatário, status ou evidência enviados pelo navegador. Essa ação não gera arquivos, não acessa Qlik e não envia emails. Funciona mesmo com a exportação Qlik desabilitada.

- Tentativa ainda ativa: recusa a recuperação.
- Interrupção anterior ao envio, comprovada pelo token e ausência da marca persistida: libera uma nova tentativa explícita, preservando o histórico e os anexos.
- Tentativa que pode ter chegado ao provedor: consulta somente por GET. Usa o ID persistido; se o ID se perdeu, procura candidatos paginados e valida destinatário, envelope e tags do registro/tentativa.
- Evidência positiva: registra `sent_beta` com o ID e o horário retornados pelo provedor. Isso significa aceitação, nunca prova de entrega.
- Resultado ausente, ambíguo, sem acesso, inválido ou fora do limite da busca: mantém `uncertain`, sem liberar reenvio. HTTP não-2xx e respostas de aceitação inválidas também exigem conferência.
- Registros antigos sem token/marca não permitem inferir que o provedor não foi chamado. Permanecem bloqueados para conferência quando não existe ID confiável. Não há backfill que invente a fase anterior.

A chave de idempotência não é usada como autorização para reenvio de resultado incerto: a [Resend mantém essa chave por 24 horas](https://resend.com/docs/dashboard/emails/idempotency-keys). Reconciliação usa [listagem paginada](https://resend.com/docs/api-reference/emails/list-emails) e [consulta do email](https://resend.com/docs/api-reference/emails/retrieve-email), incluindo tags. A credencial já configurada precisa permitir essas leituras; falta de acesso bloqueia a conferência e não é contornada com novas permissões.

### Migração e publicação futura

`20261023114858_accountability_dispatch_recovery.sql` foi criada pela CLI e testada somente em PGlite local. Acrescenta quatro colunas anuláveis; não muda grants/RLS, apaga histórico nem altera registros remotos. Deve ser revisada/aplicada antes da versão do aplicativo, após encerrar os workers antigos (até 800 segundos). Publicação e aplicação remota dependem de aprovação específica. Não executar um lote de migrations: o histórico remoto possui divergências independentes que exigem revisão própria.

A única tabela alterada é `public.accountability_dispatches`: `processing_token uuid`, `processing_started_at timestamptz`, `provider_attempted_at timestamptz` e `email_snapshot jsonb`, todas opcionais e sem default/backfill. Nenhuma função, trigger, índice, policy ou grant é criado/alterado. A versão anterior do aplicativo ignora essas colunas; a versão de recuperação depende delas para iniciar e registrar tentativas. Enquanto estiverem ausentes, manter o PR em rascunho, sem merge nem testes de geração na prévia.

O `ALTER TABLE` exige um lock breve; uma transação concorrente longa pode atrasar sua aplicação. Revisar/aplicar em janela controlada, sem novos processamentos, e conferir colunas, contagem/histórico e grants/RLS antes de publicar. Em falha antes do commit, a transação desfaz a migração inteira. Após commit, o rollback recomendado é do aplicativo, mantendo as colunas e evidências; não apagar colunas nem redefinir estados para liberar reenvios. Reverter o aplicativo restaura suas limitações anteriores e exige encerrar os workers da versão nova antes. Nenhuma dessas operações remotas faz parte da preparação do PR.

### Testes locais

Os testes executam os módulos reais de envio, recuperação e rota com rede/armazenamento simulados. Cobrem concorrência, worker antigo, interrupção pré-envio, timeout, respostas inválidas, perda do ID, paginação, correspondência de tags, revogação de acesso, preservação de anexos e resposta perdida após commit. O teste PGlite aplica as migrations reais de Prestação, compara todos os registros e políticas/grants antes/depois e verifica a atualização condicional e a negação de escrita ao usuário autenticado.

Nenhum teste automatizado envia email real ou chama Qlik. A validação autenticada de produção em 23/10 confirmou leituras e downloads dos artefatos já existentes; a recuperação nova permanece apenas local e ainda não foi testada com um provedor real.
