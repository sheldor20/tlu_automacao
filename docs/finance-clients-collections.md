# Financeiro, Clientes, Cobrança e orçamento de obras

- Financeiro → Caixa projetado: 13 períodos de sete dias, começando na data escolhida, por empresa ou consolidado. O saldo inicial é informado por empresa/data. Sem saldo inicial, a tela não afirma sobra ou falta de caixa.
- Títulos vencidos e sem data permanecem separados da previsão futura. O detalhe semanal permite consultar títulos, clientes/fornecedores e valores.
- Solicitações aprovadas/agendadas passam por conciliação: adicional ou já registrada no Qlik. A tela apresenta também o cenário com solicitações ainda não conciliadas.
- Clientes: busca por nome, contrato, lote ou empreendimento; histórico de pagamentos, cobrança, renegociação, jurídico, documentos, atendimentos e regularização. Os acompanhamentos são registrados pela equipe. PDFs/JPGs/PNGs ficam em armazenamento privado, com acesso temporário, até 4 MB por arquivo.
- Cobrança: carteira paginada por contrato, responsável, último contato, próxima ação e promessa. A confirmação exige recebimento ativo do próprio contrato e valor suficiente; atualizações concorrentes são rejeitadas com orientação para recarregar.
- Novos negócios e Obras compartilham a chave de obra do Qlik. A solicitação de pagamento filtra obras pela empresa e valida essa relação no banco.
- Obras: realizado, comprometido, estimativa ainda não contratada, custo final e desvio do orçamento. Categorias de custo do Qlik podem ser associadas às etapas; cada etapa aceita orçamento e estimativa restante. Filtros por fornecedor e etapa.

## Origem e regras

O aplicativo financeiro do Qlik fornece IDs de empresa, obra, emitente, venda e parcela. A chave de obra contém empresa e código, inclusive para obras sem movimentação associada. Registros com código de obra vazio são tratados como lançamentos sem obra; cadastro sem descrição permanece fora da seleção pública.

A extração utiliza as medidas oficiais já existentes no Qlik, com as mesmas variáveis de desembolso e período. Datas: recebimentos usam Período; pagamentos usam Data Baixa; contas a pagar usam Data Vencimento; contas a receber usam Data Prorrogação Vencimento. A data original também é preservada. CAP é categoria de custo, não uma etapa física automática.

Cada carga é preparada em páginas, confere quantidade e total e publica o conjunto financeiro em transação. Falhas preservam a carga financeira anterior. Os valores da origem são armazenados com seis casas decimais para preservar rateios; a interface apresenta reais e centavos. Vínculos de solicitações e compromissos evitam repetição de despesas.

O Qlik financeiro não fornece, nesta integração, telefones/e-mails, documentos, processos judiciais ou acordos detalhados. Esses acompanhamentos são próprios do Space. A carteira é classificada pelo histórico financeiro, preservando a situação jurídica como desconhecida até ser preenchida pela equipe. Casos registrados como judiciais ou suspensos ficam em grupo próprio.

## Acesso e manutenção

Administração controla os departamentos Financeiro, Clientes e Cobrança. As novas permissões não são concedidas automaticamente a todos. Escritas operacionais passam por rotas autenticadas com verificação de perfil/nível; tabelas de importação são exclusivas do servidor. Documentos não são públicos.

A sincronização diária ocorre em cinco etapas, às 08:00, 08:10, 08:20, 08:30 e 08:40 UTC: catálogo, contas a receber, contas a pagar, recebimentos e pagamentos. A rota de cron exige CRON_SECRET. As tabelas data_connections e operational_imports registram execução, origem, quantidade, total e falhas.

O navegador necessário à extração está incluído explicitamente no pacote da rota. A função de publicação tem limite próprio de execução, conforme a [documentação do Supabase](https://supabase.com/docs/guides/database/postgres/timeouts), preservando os limites das consultas comuns.

## Validação

Testes de projeção e virada de ano, fontes duplicadas, classificação de cobrança, custo de obra, dados duais do Qlik e catálogo sem movimento. Testes com Postgres local verificam permissões, integridade empresa/obra, concorrência, comprovação de recebimento e publicação atômica. Verificação visual local das telas e da troca empresa/obra, incluindo largura móvel. Cargas reais são conferidas por quantidade e total.
