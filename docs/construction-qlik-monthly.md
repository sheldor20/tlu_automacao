# Financeiro da obra a partir do Qlik

Implementação local baseada no `main` `3995f8fdf4ec1544dbbc6e319e0fe707227aed8f`.
Nenhum vínculo real, sincronização, SQL remoto de escrita ou publicação foi realizado.

Conferência final do remoto: `main` avançou para `c33f4b264af73e42c8711b3ef6b69695df106ccf` (PR #150, 22/10/2026 14:43 UTC). Essa mudança toca apenas `components/payment-request-form.tsx` e `lib/payment-requests.ts`, sem sobreposição com este patch. Não foi incorporada nem revertida aqui. Os testes desta entrega usam a base `3995f8f`; a integração futura com o main mais recente deve ser validada separadamente.

## Comportamento

- Em Obras → obra → Financeiro (também no Resumo), “Vincular empresa e obra” recebe códigos digitados pelo usuário. Use `empresa|unidade`, um por linha; números simples só resolvem quando há exatamente uma unidade ativa. Zeros à esquerda são significativos. A interface mostra código, nome e empresa antes de “Salvar vínculo”. Não há correspondência por nome nem sugestão preenchida automaticamente.
- O primeiro código é o vínculo principal existente (`constructions.qlik_work_key`). A nova coluna `qlik_additional_work_keys` guarda até 49 unidades adicionais da mesma obra, inclusive de empresas diferentes. Vínculos existentes são preservados sem backfill. Consulta deduplica chaves e IDs dos lançamentos.
- Obras originadas de negócio conservam o principal herdado. Sua alteração continua centralizada em Novos Negócios; o endpoint da obra não escreve em outra área usando service role. Unidades extras pertencem à obra. Quando o principal do negócio ou a origem muda, extras antigos são limpos e precisam ser revistos. Não há alteração de grants/RLS.
- `GET /api/operations/construction` exige acesso a Obras, consulta obra e valores com o token do usuário, pagina todos os movimentos ativos `paid`/`payable` e agrega apenas as unidades salvas. A service role existente lê somente metadados de publicação/importação; não grava vínculos.
- Pagamentos usam o mês de `cash_date` (Data Baixa na origem); contas a pagar usam vencimento. Não se somam as duas naturezas. Linhas sem data ficam em grupo próprio. O filtro anual altera a tabela e o CSV; os cartões explicitam que abrangem todos os períodos.
- Ausência de vínculo, de publicação ou de registros não vira zero. `null` é exibido como “Sem registros”; zero é exibido apenas quando observado nos registros. São informadas unidades sem registros por natureza. Meses ausentes não são preenchidos com zeros. O total é a soma dos registros disponíveis, não uma certificação de completude contábil.
- A atualização vem de `data_connections.settings.paid/payable.at` de **qlik-operations**, e a situação do último `operational_imports` por natureza. Não se usa o máximo de `synchronized_at` das linhas (o incremental mantém datas antigas). Publicação ausente impede somar a carga inicial incompleta. Mudança da publicação durante a consulta invalida a leitura e pede recarga.
- CSV segue o padrão do produto: UTF-8 com BOM, `;`, decimais com vírgula, metadados de fonte/período/publicação, códigos e nomes, escape de fórmulas. Não inclui valores manuais.

## Legado e bloqueio de escrita

As competências de `construction_budgets` continuam visíveis em seção de legado. Compromissos, estimativas e orçamentos por etapa também permanecem consultáveis em seção própria. Não são somados ao Qlik. O cartão antigo “Realizado” foi retirado do detalhe; os indicadores da lista e o PDF existente que ainda usam a visão manual foram rotulados como legado. O orçamento geral cadastrado da obra e outros módulos permanecem com suas regras anteriores.

`POST /api/operations/construction` aceita apenas `link`, com validação estrita, confirmação por envio do formulário e controle de concorrência via `updated_at`. Comandos financeiros antigos (`commitment`, `estimate`, `stage_budget`, `stage_mapping` etc.) recebem 405; viewers não escrevem. O catálogo usado pela obra passa pela autenticação e RLS; o fluxo anterior de catálogo usado por outras telas foi preservado.

A migração nova é aditiva: coluna e triggers `SECURITY INVOKER`. Triggers rejeitam INSERT/UPDATE/DELETE nas quatro tabelas financeiras manuais, inclusive chamadas diretas de clientes antigos à Data API. Não exclui registros, não altera migrations históricas, grants, RLS ou credenciais. O bloqueio também impede exclusão em cascata de obras que ainda tenham esse histórico: arquivar continua disponível e preserva os dados.

## Validação local

- 15 novos testes: código composto/ambíguo, zeros à esquerda, unidades inativas, múltiplas unidades, separação paid/payable, meses/sem data, valores ausentes, exportação, conflito de atualização e restrições de papel.
- Testes dos handlers executam o código real com I/O simulado; incluem paginação de 1.003 linhas e troca da publicação durante leitura. Não são teste de credenciais de produção.
- Testes React renderizam os componentes e executam o evento do campo de código; cobrem ausência de vínculo, legado, falha de leitura e ausência de edição financeira.
- PGlite aplica as migrations reais necessárias e a nova migration. Testa preservação dos quatro históricos, rejeição de escrita direta, herança na criação e troca de principal, acesso do membro e negação ao usuário sem Obras. Compara `pg_policies` e ACLs das tabelas antes/depois: inalterados.
- Suíte completa: `npm test` — 480 passaram. `npm run typecheck` e `npm run build -- --webpack` passaram. Lint dos arquivos alterados passou.
- Lint geral tem dois erros preexistentes no main: `app/(app)/acordo-performance/page.tsx:122` (setState em effect) e `components/club-workspace.tsx:338` (Date.now no render). Esses arquivos estão idênticos ao commit base; não foram trazidas correções das branches de revisão anteriores.
- Servidor local: `npm run start -- --hostname 127.0.0.1 --port 3031` foi **negado** por `listen EPERM`. Não houve retry, troca de porta nem elevação para contornar. Teste visual/hidratado no navegador e fluxo HTTP completo ficam pendentes em ambiente permitido.

## Publicação posterior, somente após aprovação específica

1. Revisar diff e migration `20261022143304_construction_qlik_monthly_readonly.sql`, inclusive o bloqueio dos clientes antigos. Comparar o main atual com o commit base; manter as outras branches de revisão separadas.
2. Em ambiente de homologação aprovado, aplicar a migration **antes** do app, pois a API lê a nova coluna. Nenhum sync/backfill é necessário. Se houver restrição de privilégio, não ampliar grants/RLS para contornar: investigar separadamente.
3. Publicar a versão revisada e validar com usuário escritor de Obras, viewer e usuário sem acesso. Confirmar tela sem vínculo, códigos ambíguos/inválidos, unidade única e múltiplas, dado ausente, erro de carga, legado e CSV. Usar registros de teste autorizados para gravação.
4. Conferir que clientes antigos recebem bloqueio de escrita em `construction_budgets` e que os comandos financeiros do endpoint não escrevem. Validar propagação do negócio para obra e conflito de edição concorrente.
5. O usuário preenche os códigos reais. Esta entrega não decide vínculo de Jivago, Gênesis, Vale, Mineiros ou qualquer outra obra. Um rollout/reversão de aplicação não deve apagar dados nem remover os bloqueios sem revisão explícita.
