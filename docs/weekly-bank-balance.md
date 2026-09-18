# Saldo bancário do fluxo de caixa semanal

A tela Financeiro / Caixa projetado consulta automaticamente `/api/operations/cash/bank-balance` em paralelo aos movimentos. O botão Atualizar renova as duas consultas.

## Origem e cálculo

Reutiliza a composição `Composição Saldo Inicial | Contas` do DFC, configurada em `QLIK_FINANCE_APPS`, inclusive seu estado alternativo. A leitura usa sessão isolada, as variáveis `vPosicaoInicialDFC` e `vPosicaoFinalDFC` na data inicial escolhida e `%IdEmpresa` com o conjunto exato de empresas do catálogo selecionado. Não carrega filtros exclusivos das nove contas de aluguel. Não usa o KPI mensal `valor_caixa` nem o indicador calculado `caixa_disponivel` como se fossem saldos diários de todas as empresas.

O leitor existente soma a composição e confronta seu resultado com o total do Qlik. Zero e saldo negativo são válidos. Ausência de contas, valor não numérico, total divergente ou data não confirmada resultam em indisponibilidade, nunca em zero estimado. O valor confirmado passa a ser a abertura da projeção de 13 semanas; não é repetido como abertura em cada semana nem rateado entre empresas. A consulta individual ocorre ao selecionar a empresa.

## Atualização e segurança

Cache de cinco minutos por data e hash do conjunto de empresas; atualizações explícitas ignoram o cache, exceto a janela de 30 segundos para evitar consultas repetidas. Requisições simultâneas no mesmo processo compartilham a leitura. Falhas preservam o último saldo validado da mesma seleção e exibem aviso e horário. A tela descarta resultados de outra data ou empresa. Não existe execução em segundo plano fora da requisição.

Acesso exige a autorização Financeiro antes de consultar cache ou Qlik. Credenciais são as variáveis de servidor já existentes; não há novas chaves nem exposição ao navegador. A tabela `cash_bank_balance_snapshots` tem RLS ativo e grants apenas para service_role. A conexão qlik-finance pausada impede novas consultas à origem.

Saldo manual continua apenas como alternativa identificada, inclusive em cenários futuros. Não sobrescreve nem é somado ao saldo Qlik. Não há alteração dos indicadores mensais ou dos movimentos financeiros.

## Validação

Nove testes unitários cobrem referência, data exata, filtro, composição, ausência, saldo zero/negativo e respostas fora da seleção. Dez verificações transacionais do banco conferiram RLS, permissões, isolamento, zero/negativo e rejeição de NaN/escopo vazio/contagem inválida. Os registros sintéticos foram revertidos com ROLLBACK. Migration aplicada: `20260918010020_cash_bank_balance_snapshots`.

A primeira consulta real depende da autenticação Qlik existente no ambiente. Testes unitários e de banco não equivalem a uma conciliação bancária ao vivo. Fonte, data e horário permanecem visíveis para conferência no portal.
