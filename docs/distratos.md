# Distratos

Menu independente `/distratos`, com acesso individual pela Administração. Administradores têm acesso; usuários precisam do departamento `distratos`. Leitores consultam o histórico e baixam os documentos. Geração exige nível de edição.

Aplicar `20261023115525_distratos_module.sql` antes de publicar. Nenhum usuário recebe o novo departamento automaticamente. A migração cria snapshots imutáveis, com RLS na leitura e escrita restrita ao servidor autorizado.

## Origem e seleção

Empreendimento/obra → quadra → lote → um ou mais contratos. A empresa e o cliente são mostrados antes da geração. A seleção usa o ID exato do contrato: nomes iguais não unem pessoas/contratos, e o mesmo contrato selecionado por mais de um titular produz um único documento. Não unir contratos de empresas diferentes pelo nome ou pelo número do lote. Não há rateio entre titulares.

Recebimentos vêm da publicação completa de `operational_cash_entries`, `kind=received`, `active=true`, com vínculo exato por `contract_id`, empresa e obra. São mantidos os componentes e estornos assinados, sem usar vencimento como data de pagamento. A data de publicação é mostrada e preservada. `sourceRevision` detecta mudanças entre consulta, cálculo e gravação.

A consulta opcional da venda usa o aplicativo de vendas do Qlik, `%IdVenda` exato, `Data Venda` e um campo inequívoco de valor original. Se o campo não existir ou for ambíguo, o usuário deve preencher valor e data pelo contrato. Não inferir o preço da soma de pagamentos ou saldo a receber. Data e valor original válidos são preenchidos a cada seleção e respostas atrasadas de outro contrato são descartadas. Atualizar até inicia na data atual. Corretagem e tributos não têm fonte contratual confirmada no modelo atual: ficam em branco, exigem conferência e não recebem zero por ausência de informação. CNPJ, CPF, matrícula, posse e condições de devolução também não são deduzidos dos pagamentos.

## Regras da planilha de referência

- **Com Lei do Distrato (Fernando):** 10% do imóvel atualizado para despesas administrativas e penais, corretagem informada, fruição de 0,75% do imóvel por mês informado, tributos municipais informados.
- **Sem Lei do Distrato (Erica):** 5% dos pagamentos atualizados para despesas administrativas, mais 5% para despesas tributárias, multa de 10% do imóvel atualizado, corretagem informada, fruição de 1% do imóvel por mês informado, tributos municipais informados.

A escolha é do usuário, sem determinação automática pela data. Os percentuais reproduzem o material fornecido, sem afirmar validade jurídica universal. Por regra de negócio solicitada, meses de fruição correspondem à quantidade de parcelas pagas, não à diferença entre datas. O aplicativo agrupa recebimentos pelo `title_key` exato dentro do contrato e conta uma vez cada parcela com recebimento líquido positivo e sem saldo positivo na base de recebíveis. Pagamentos parciais, previsões sem recebimento e estornos integrais não contam. A base de recebíveis deve estar publicada e não ser anterior à de recebimentos; as publicações são conferidas antes/depois da leitura. Sem identificação suficiente ou bases coerentes, o campo fica sem confirmação e mantém preenchimento manual de um total conferido. A quantidade e suas publicações integram o snapshot da unidade; o servidor rejeita uma quantidade diferente da confirmada. Esta é uma regra operacional solicitada pelo usuário, não uma validação jurídica. Somam-se os descontos sem arredondamento intermediário, conforme o Excel; eventual centavo de diferença na apresentação consta como ajuste de arredondamento.

## Correção e documento

O servidor usa o endpoint público do serviço TJDFT `POST https://juriscalc.tjdft.jus.br/public/calculos`, o mesmo utilizado pela página `https://juriscalc.tjdft.jus.br/publico/calculos`. `indiceString=INPC`, `juros=null`, sem multas ou honorários judiciais. Imóvel e pagamentos são entradas independentes de espécie `DEBITO`; assim o site corrige cada pagamento em vez de compensá-lo como pagamento de uma dívida judicial.

Datas, valores iniciais, identificadores, índice, juros, quantidade de linhas e total são conferidos no retorno. O cálculo registra a competência efetivamente disponível. Falha do TJDFT impede a emissão; não há estimativa alternativa. A interface não envia nomes, documentos, endereços ou identificadores reais ao TJDFT, apenas valores, datas e rótulos sequenciais.

PDF com memória, descontos, todos os recebimentos e termo. Campos incompletos ou saldo negativo mantêm a marca de minuta. Saldo negativo não vira dívida reconhecida. Os registros guardam integralmente dados, retorno normalizado, regra e termo; downloads posteriores usam o snapshot salvo.

## Vários contratos e resumo

Cada seleção tem formulário, data/preço original, regime, fruição, encargos, pagamentos, revisão da base, histórico e PDF próprios. Remover um contrato desmonta seu formulário e exclui seus valores do resumo; trocar obra/quadra/lote limpa a seleção. Respostas atrasadas das consultas removidas são descartadas. Alterar campos invalida o documento atual do resumo. Consultar um documento histórico não o incorpora ao resumo dos dados atuais.

“Gerar documentos selecionados” usa o endpoint individual existente, sequencialmente e uma vez por ID de contrato. Uma falha não apaga os documentos concluídos nem impede os contratos seguintes. “Parar após contrato atual” aguarda a operação em andamento e não inicia as próximas; não promete desfazer documento já gerado. Repetir a geração com os mesmos campos, ator e revisão reutiliza a chave da operação. O navegador mantém em `sessionStorage` apenas o hash desses dados e o UUID, permitindo recuperar uma resposta incerta após recarregar a mesma aba. Nenhum valor, nome, documento pessoal ou credencial é gravado nesse diário. Se o armazenamento estiver indisponível, a geração não é iniciada. Uma nova aba/sessão não compartilha esse diário; para documentos anteriores, consultar o histórico. O servidor continua validando acesso, idempotência, fruição e revisões, sem alteração da API ou do banco.

O resumo mostra cada saldo e restituição separadamente e soma pagamentos/descontos/restituições em centavos. Soma **as restituições individuais**; não compensa um saldo negativo com a restituição de outro contrato. Não soma o valor dos imóveis nem meses de fruição. Contrato/recebimento duplicado não é contado duas vezes: IDs de contratos são deduplicados e recebimentos repetidos bloqueiam a consolidação. Resultados parciais são identificados e o CSV exige documento atual para todos os contratos selecionados. PDFs continuam individuais.

**Faturamento esclarecido pelo usuário em 04/11/2026:** significa mostrar o valor individual no resumo, não criar Solicitação de Pagamento nem cobrança. O resumo e o CSV distinguem data/valor de venda consultados na origem, pagamentos nominais da origem, base de venda efetivamente usada e resultados calculados. A consulta de venda existente alimenta os valores de origem, preservados mesmo se o usuário ajustar a base do cálculo; ausência aparece como “Não confirmado”, nunca zero presumido. Pagamentos nominais só aparecem após a consulta do contrato. O total é dos documentos disponíveis, explicitamente parcial quando faltam gerações. O fluxo separado de Solicitação de Pagamento possui campos e descontos próprios (`docs/payment-requests.md`) e não é acionado por esta implementação.

## Validação

`npm run typecheck` e `node --experimental-strip-types --test tests/distratos*.test.ts tests/qlik-operational-stream.test.ts`. Exemplos da planilha: Fernando: descontos R$ 89.437,44, saldo -R$ 11.534,60, restituição R$ 0,00. Erica: descontos R$ 27.966,59, restituição R$ 61.585,49.

Referência normativa para revisão do termo: art. 32-A da Lei 6.766/1979, incluído pela Lei 13.786/2018, https://www.planalto.gov.br/ccivil_03/leis/l6766compilado.htm . A minuta não impõe foro, renúncia genérica ou prazo de restituição presumido.
