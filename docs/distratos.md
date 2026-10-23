# Distratos

Menu independente `/distratos`, com acesso individual pela Administração. Administradores têm acesso; usuários precisam do departamento `distratos`. Leitores consultam o histórico e baixam os documentos. Geração exige nível de edição.

Aplicar `20261023114330_distratos_module.sql` antes de publicar. Nenhum usuário recebe o novo departamento automaticamente. A migração cria snapshots imutáveis, com RLS na leitura e escrita restrita ao servidor autorizado.

## Origem e seleção

Empreendimento/obra → quadra → lote → contrato, quando há mais de um. A empresa e o cliente são mostrados antes da geração. Não unir contratos de empresas diferentes pelo nome ou pelo número do lote.

Recebimentos vêm da publicação completa de `operational_cash_entries`, `kind=received`, `active=true`, com vínculo exato por `contract_id`, empresa e obra. São mantidos os componentes e estornos assinados, sem usar vencimento como data de pagamento. A data de publicação é mostrada e preservada. `sourceRevision` detecta mudanças entre consulta, cálculo e gravação.

A consulta opcional da venda usa o aplicativo de vendas do Qlik, `%IdVenda` exato, `Data Venda` e um campo inequívoco de valor original. Se o campo não existir ou for ambíguo, o usuário deve preencher valor e data pelo contrato. Não inferir o preço da soma de pagamentos ou saldo a receber. CNPJ, CPF, matrícula, posse, tributos, corretagem e condições de devolução também não são deduzidos dos pagamentos.

## Regras da planilha de referência

- **Com Lei do Distrato (Fernando):** 10% do imóvel atualizado para despesas administrativas e penais, corretagem informada, fruição de 0,75% do imóvel por mês informado, tributos municipais informados.
- **Sem Lei do Distrato (Erica):** 5% dos pagamentos atualizados para despesas administrativas, mais 5% para despesas tributárias, multa de 10% do imóvel atualizado, corretagem informada, fruição de 1% do imóvel por mês informado, tributos municipais informados.

A escolha é do usuário, sem determinação automática pela data. Os percentuais reproduzem o material fornecido, sem afirmar validade jurídica universal. O período de fruição é informado explicitamente. Somam-se os descontos sem arredondamento intermediário, conforme o Excel; eventual centavo de diferença na apresentação consta como ajuste de arredondamento.

## Correção e documento

O servidor usa o endpoint público do serviço TJDFT `POST https://juriscalc.tjdft.jus.br/public/calculos`, o mesmo utilizado pela página `https://juriscalc.tjdft.jus.br/publico/calculos`. `indiceString=INPC`, `juros=null`, sem multas ou honorários judiciais. Imóvel e pagamentos são entradas independentes de espécie `DEBITO`; assim o site corrige cada pagamento em vez de compensá-lo como pagamento de uma dívida judicial.

Datas, valores iniciais, identificadores, índice, juros, quantidade de linhas e total são conferidos no retorno. O cálculo registra a competência efetivamente disponível. Falha do TJDFT impede a emissão; não há estimativa alternativa. A interface não envia nomes, documentos, endereços ou identificadores reais ao TJDFT, apenas valores, datas e rótulos sequenciais.

PDF com memória, descontos, todos os recebimentos e termo. Campos incompletos ou saldo negativo mantêm a marca de minuta. Saldo negativo não vira dívida reconhecida. Os registros guardam integralmente dados, retorno normalizado, regra e termo; downloads posteriores usam o snapshot salvo.

## Validação

`npm run typecheck` e `node --experimental-strip-types --test tests/distratos*.test.ts tests/qlik-operational-stream.test.ts`. Exemplos da planilha: Fernando: descontos R$ 89.437,44, saldo -R$ 11.534,60, restituição R$ 0,00. Erica: descontos R$ 27.966,59, restituição R$ 61.585,49.

Referência normativa para revisão do termo: art. 32-A da Lei 6.766/1979, incluído pela Lei 13.786/2018, https://www.planalto.gov.br/ccivil_03/leis/l6766compilado.htm . A minuta não impõe foro, renúncia genérica ou prazo de restituição presumido.
