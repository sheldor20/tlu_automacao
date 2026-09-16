# Performance de empreendimentos

Tela: `/novos-negocios/performance-de-empreendimentos`, dentro de Novos negócios.

O catálogo vem do campo `Nome Empresa`, exibido como Empresa no Qlik. A leitura retorna uma empresa ou a soma de todas por data, sempre a partir de uma única carga completa. TIR, VPL, payback e déficit máximo são recalculados sobre o fluxo consolidado. Nenhum dado demonstrativo é inserido no banco.

## Situação da primeira carga

A conexão `qlik-enterprise-performance` começa pausada e com `mapping_verified: false`. Em 16/09/2026, o acesso autenticado permitiu conferir as três planilhas, os objetos e os campos abaixo. Após essa conferência, a conexão foi ativada e a primeira carga completa terminou às 11h10 de São Paulo, conciliando as quatro medidas e publicando o catálogo de 32 empresas. Novas instalações devem preservar a mesma etapa de validação antes da ativação.

Aplicativo: `e3d13862-ec1f-4332-8a5b-df4c7b93fa7c`.

| Medida | Planilha | Conteúdo obrigatório | Data |
| --- | --- | --- | --- |
| received | bd84bea2-0f3c-4dc6-9081-0eab08502ba3 | Recebimentos efetivamente baixados | Baixa do recebimento |
| paid | 96551230-06b0-4e0f-9881-890030e2992a | Pagamentos efetivamente baixados | Baixa do pagamento |
| payable | 96551230-06b0-4e0f-9881-890030e2992a | Saldo residual em aberto, excluindo baixas | Data esperada de pagamento |
| receivable | 32a488c2-14d8-4bde-ba4f-35211d75376b | Saldo residual em aberto, excluindo baixas | Data esperada de recebimento |

Mapeamento conferido na interface e nas propriedades oficiais do Qlik (medida de índice zero em todos os objetos):

| Medida | Objeto | Campo de data |
| --- | --- | --- |
| received | b92ac856-4098-44d8-bc83-a21a48e68db5 | Período (Data Recebimento na tabela de origem) |
| paid | ZJWVapq | Data Baixa (Data Pagamento na tabela de origem) |
| payable | cJmDgZJ | Data Vencimento |
| receivable | f8bff9fa-91db-4f60-8c0b-2e91cfdc1134 | Data Prorrogação Vencimento |

Cada leitura fixa `vQtdDias = 99999999` (Tudo) e `vDesembolsoFinanceiro = Normal` (Com Desembolso), dentro de uma sessão isolada. O coletor confirma os valores das variáveis antes de ler as medidas. A expressão original da medida mestre e os parâmetros usados ficam no metadado de auditoria, sem reescrever fórmulas.

O endpoint protegido de cron aceita `?inspect=1` para reconciliar uma configuração candidata e retornar totais por empresa, datas e expressões, sem ativar a conexão nem gravar snapshots. Continua exigindo `CRON_SECRET`; a atualização manual exige sessão e acesso ao departamento.

Após liberar o acesso autorizado, conferir os identificadores das visualizações, índices das medidas e nomes exatos dos campos de data. Registrar em `data_connections.settings.sources`, nas quatro chaves acima, os campos `object_id`, `date_field` e `measure_index` (índice a partir de zero). Manter `company_field` com o nome exato do campo de empresa. Só marcar `mapping_verified: true` e ativar a conexão depois dessa conferência.

Validar que as medidas contemplam o período completo, sem filtros de ano/data embutidos nem variáveis limitando o período. Validar abrangência de terreno, obras, impostos, comissões, distratos e financiamento; não substituir saldo residual por valor original das parcelas. As medidas são reutilizadas sem reescrever suas expressões; medidas não aditivas ou que ignoram Empresa/Data devem ser corrigidas na configuração/origem antes da ativação.

Conferir Vale das Águas, outra empresa, uma empresa sem movimento e Geral contra o Qlik. A primeira carga só fica disponível após a leitura de todas as empresas e reconciliação de cada uma das quatro medidas com o respectivo total, tolerância de R$ 0,02.

## Atualização e proteção dos dados

- Botão Atualizar Qlik: `POST /api/enterprise-performance/refresh`, exige sessão e acesso a Novos negócios.
- Atualização semanal: segunda-feira às 10h de São Paulo, protegida por `CRON_SECRET`; enquanto pausada, retorna sem acessar o Qlik.
- Usa credenciais Qlik e chave de serviço Supabase já configuradas exclusivamente no servidor.
- O coletor usa sessão isolada e lê agregados por empresa/data; não persiste clientes nem títulos individuais.
- Snapshot, catálogo e movimentos são gravados atomicamente. Falhas preservam a última carga válida. Auditoria nas tabelas de conexões existentes.
- Leitura por RPC com RLS e permissão do departamento. Escrita somente pelo serviço. Snapshots anteriores permanecem disponíveis para auditoria, sem serem somados na tela.

## Cálculos e datas

Recebido/pago usam datas de baixa. A receber/a pagar usam datas da origem. Sem data, os valores continuam nos totais e em uma linha separada; os indicadores datados ficam indisponíveis. A data-base da análise é sempre o dia atual em São Paulo, atualizada também com a tela aberta e ao voltar à aba; a data da última sincronização permanece separada. Por premissa definida pelo usuário, saldos abertos vencidos são projetados para hoje automaticamente, preservando totais, baixas e datas futuras, sem alterar o Qlik. A tela identifica essa premissa e o montante afetado.

Retorno sobre custo: `(recebido + a receber - pago - a pagar) / (pago + a pagar)`. Margem usa recebimentos no denominador. TIR anual e VPL usam datas efetivas e base de 365 dias, seguindo a equação da [XTIR](https://learn.microsoft.com/en-us/office/vba/api/excel.worksheetfunction.xirr). TMA inicial de 15% é uma premissa editável, não benchmark. A XTIR agrega fluxos na mesma data, busca uma raiz em log(1 + taxa), entre -14 e 14, e valida o resíduo do VPL. Alternâncias de sinal não bloqueiam o cálculo por si só: para esses fluxos, saldos descontados intermediários com o mesmo sinal do fluxo inicial são uma condição suficiente de unicidade, por soma por partes. Casos inconclusivos continuam sem uma taxa única; não se escolhe arbitrariamente uma das raízes. Payback identifica recuperação definitiva dentro do horizonte, e déficit considera caixa inicial zero. Não são automaticamente indicadores do capital dos sócios.

## Verificação

Testes de XTIR contra o exemplo da Microsoft, VPL na raiz, consolidação ponderada por fluxos, horizontes até 2200, vencidos, datas ausentes, payback definitivo, paginação do coletor, reconciliação, autorização/RLS e rollback de cargas inválidas. Os testes usam fixtures locais; a validação de produção também comparou Vale das Águas e Jardim Araguaia com o Qlik, além de verificar o filtro de empresas, o estado sem movimentos e as visões anual, realizada, prevista e total no Space.
