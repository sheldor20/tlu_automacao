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
