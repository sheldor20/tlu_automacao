# Ciência de acordos de performance

O líder direto cadastra e altera ciclos e metas. O liderado vê seus ciclos e assina a declaração de recebimento, compreensão e compromisso com nome completo e confirmação explícita. O banco atribui usuário e horário e salva uma cópia da revisão assinada. Não permite alteração ou exclusão da assinatura. Cada revisão aceita uma assinatura; uma edição do líder incrementa a revisão e exige nova ciência, preservando o histórico.

Os ciclos aparecem no acesso habitual do liderado, sem envio externo de mensagens. A assinatura é um registro de aceite na conta autenticada, sem certificado digital de terceiro.

Arquivos são compartilhados apenas entre o colaborador e o líder direto atual, em bucket privado `performance-files`, com limite de 20 MB por arquivo. Uploads usam caminhos por ciclo/usuário e identificador aleatório. Downloads autenticados são feitos como arquivos, sem abrir conteúdo enviado no domínio da aplicação.

Aplicar a migração `20261019133209_performance_acknowledgments_files.sql` antes de publicar o frontend. O trigger de assinatura vive em schema privado e usa privilégios elevados somente para bloquear a revisão enquanto registra o aceite; valida explicitamente identidade, vínculo ativo e revisão.

Verificação: `npm run typecheck`, `npm run build` e `node --experimental-strip-types --test tests/performance-agreements.test.ts tests/performance-signatures.test.ts`.

## Notificações internas

A migração `20261019133714_performance_agreement_notifications.sql` inclui avisos em Hoje e no contador da navegação. Criação ou edição de acordo avisa o liderado; assinatura retira a pendência e avisa o líder direto atual. Cada aviso abre o ciclo correto. Revisões subsequentes reabrem a pendência, sem duplicação. Ciclos anteriores ainda não assinados também recebem aviso. As notificações de performance são privadas ao destinatário e deixam de aparecer se ele perder acesso ao ciclo. Não há envio de e-mail ou mensagem externa.

Teste adicional: `node --experimental-strip-types --test tests/performance-notifications.test.ts`.
