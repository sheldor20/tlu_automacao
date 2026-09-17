# Planejador orçamentário de cinco anos

Módulo na rota `/planejador-orcamentario`, fora do AppShell, sem item de menu. O link exige login e retorna à mesma página após autenticar. Segue a permissão de Financeiro: leitura para viewers, edição para membros/gestores e administradores. Curvas de negócios seguem as permissões de Novos Negócios. A API valida o usuário ativo e as permissões em todas as operações; o banco bloqueia acesso anônimo e escrita direta.

## Estrutura funcional

A estrutura considera o resumo fornecido da [Reunião DRE — TLUA](https://tldv.io/app/meetings/6aabf2a58661f10012141815/). Não substitui o plano de contas/CAP que Rosa e Marcinho devem validar.

1. Receitas: carteira atual, novos negócios e demais contas de entrada.
2. Custos operacionais: contas simplificadas configuráveis, com classificação por empresa, obra e categoria de origem.
3. Resultado gerencial: entradas menos custos operacionais. Investimentos ficam abaixo desse resultado.
4. Caixa: ajustes de competência e movimentos sem efeito no resultado (transferências, aportes e distribuições).
5. Investimentos: desembolsos de obras, seguidos da geração líquida e saldos de caixa.

A página oferece 60 meses e cinco anos, com Orçado, Realizado e Projeção. A projeção substitui o orçamento pelos valores realizados até o último mês fechado definido no cenário. Arrastar uma obra nunca desloca lançamentos reais. Na visão realizada, meses ainda abertos ficam sem valores e os totais anuais abrangem os meses fechados.

## Base zero e cenários

Cada cenário começa com despesas zeradas. As despesas exigem valor, competência, mês do caixa e justificativa. Repetições mensais são explícitas, até 60 meses. O histórico e contas a pagar não são repetidos automaticamente. O saldo inicial de caixa é informado à parte e pode ser negativo; em branco, o saldo final fica a apurar.

O cenário pode ser individual por empresa (padrão) ou reunir todas as empresas importadas. O cenário consolidado tem premissas próprias: não soma automaticamente outros cenários salvos. Os cenários podem ser duplicados para simulação. Versões impedem que uma gravação sobrescreva silenciosamente outra. A carteira a receber e as curvas são capturadas no cenário; os botões de atualização substituem essas premissas explicitamente. O realizado continua vindo da fonte atual.

Índices anuais de novas receitas, despesas e investimentos partem de zero e são configuráveis. Os valores manuais e curvas estão em reais do primeiro ano; aplica-se reajuste composto conforme o ano de competência. O pagamento recebe o mesmo valor reajustado da sua competência. Recebíveis contratados e valores realizados não sofrem novo reajuste.

## Curvas em Novos Negócios

O botão de calendário em cada negócio abre a curva mensal, editável por colagem ou upload CSV/TSV. Exemplo:

```csv
mes;vgv;investimento
1;100000,00;20000,00
2;150000,00;30000,00
3;200000,00;0,00
```

- `mes` é relativo, de 1 a 120; meses ausentes representam zero.
- Na coluna investimento, mês 1 é o início da obra.
- Na coluna VGV, mês 1 é o mês seguinte à conclusão da obra.
- VGV significa recebimentos previstos, conforme a projeção atual do sistema. Não é reconhecimento contábil de venda nem faturamento automático.
- A soma da curva de VGV atualiza o VGV total do negócio na mesma transação. O investimento permanece na curva, sem alterar o orçamento operacional da obra existente.
- Se o prazo muda, a curva de investimento é distribuída proporcionalmente na nova duração, preservando o total em centavos antes dos reajustes anuais.
- Valores fora dos cinco anos aparecem em um alerta, sem serem redistribuídos para dentro do horizonte.
- Negócios vinculados ao Qlik só entram na simulação após confirmação de que a curva é incremental, evitando dupla contagem da carteira.

## DRE e conciliação

A fonte atual fornece data de caixa, categoria e obra, mas não competência contábil validada nem o CAP personalizado completo. Até conciliar, o resultado gerencial realizado usa provisoriamente a data de caixa e mostra “A conciliar”. Ajustes de competência permitem diferir custos/receitas sem modificar o caixa importado. Exemplo: despesa paga em março referente a fevereiro → ajuste +100 de despesa em fevereiro e −100 em março.

A identidade de cálculo é:

`resultado gerencial + ajuste de competência + transferências/aportes líquidos − investimentos = geração de caixa`

`saldo inicial + geração de caixa = saldo final`

Classifique movimentações transitórias em contas de caixa sem receita/despesa. A classificação considera empresa + obra + categoria, para distinguir material de manutenção de material de construção. Não há eliminação automática de intercompanhias ou identificação presumida da empresa beneficiária: é necessário validar os pares e lançar os ajustes correspondentes. Reclassificações entre empresas, depreciação, ativos e CAP definitivo precisam da referência contábil da reunião; não se infere uma DRE contábil definitiva a partir de pagamentos.

## Fonte e limitações visíveis

O módulo usa as tabelas operacionais já sincronizadas do Qlik, sem um novo acesso direto ao UAU/UOL. O banco agrega parcelas por mês, empresa, obra e categoria. A tela mostra a cobertura e as datas de atualização. Se não houver recebimentos ou pagamentos carregados para a empresa, resultados dependentes e saldos ficam sem valor, nunca substituídos silenciosamente por zero. Contas sem data não entram no período. Recebíveis anteriores ao primeiro ano exigem uma premissa explícita de recuperação.

Na consulta de 17/09/2026, a carga de recebimentos estava em andamento; pagamentos e recebíveis já existiam. Não foram criados dados financeiros fictícios no banco conectado.

## Instalação e validação

Aplicar `supabase/migrations/20260917140745_five_year_budget.sql` depois das migrations de Financeiro/Clientes/Cobrança, publicar o código e acessar `/planejador-orcamentario` no domínio do sistema. Não há novas variáveis de ambiente. Reutiliza as credenciais existentes de servidor e Supabase.

A mudança foi verificada localmente com testes de cálculo, reajustes, totais anuais, transferência entre caixa e resultado, segregação por empresa, fonte incompleta, CSV, preservação dos realizados, migração em PostgreSQL/PGlite, RLS, total do negócio e conflito de versões. A navegação e o layout foram verificados em desktop e celular com dados de teste; os testes visuais não gravaram no banco real.

Pendente antes do uso como DRE oficial: validar o plano de contas e as categorias/CAP com Rosa e Marcinho, informar os saldos iniciais e confirmar a conclusão da carga de recebimentos. A migração e a publicação em produção são etapas separadas desta versão de revisão.
