# Performance de empreendimentos

Tela: `/novos-negocios/performance-de-empreendimentos`, dentro de Novos negócios.

O catálogo vem do campo Empresa no Qlik. A leitura retorna uma empresa ou a soma de todas por data, sempre a partir de uma única carga completa. TIR, VPL, payback e déficit máximo são recalculados sobre o fluxo consolidado. Nenhum dado demonstrativo é inserido no banco.

## Situação da primeira carga

A conexão `qlik-enterprise-performance` começa pausada e com `mapping_verified: false`. O acesso ao Qlik foi bloqueado pela verificação de segurança do navegador durante a implementação; os objetos e campos das três planilhas ainda precisam ser conferidos por acesso autorizado. Não ativar a conexão apenas para remover o aviso da tela.

Aplicativo: `e3d13862-ec1f-4332-8a5b-df4c7b93fa7c`.

| Medida | Planilha | Conteúdo obrigatório | Data |
| --- | --- | --- | --- |
| received | bd84bea2-0f3c-4dc6-9081-0eab08502ba3 | Recebimentos efetivamente baixados | Baixa do recebimento |
| paid | 96551230-06b0-4e0f-9881-890030e2992a | Pagamentos efetivamente baixados | Baixa do pagamento |
| payable | 96551230-06b0-4e0f-9881-890030e2992a | Saldo residual em aberto, excluindo baixas | Data esperada de pagamento |
| receivable | 32a488c2-14d8-4bde-ba4f-35211d75376b | Saldo residual em aberto, excluindo baixas | Data esperada de recebimento |

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

Recebido/pago usam datas de baixa. A receber/a pagar usam datas da origem. Sem data, os valores continuam nos totais e em uma linha separada; os indicadores datados ficam indisponíveis. Para vencidos, a interface exige uma data futura explícita como premissa local, preservando os totais sem alterar o Qlik.

Retorno sobre custo: `(recebido + a receber - pago - a pagar) / (pago + a pagar)`. Margem usa recebimentos no denominador. TIR anual e VPL usam datas efetivas e base de 365 dias. TMA inicial de 15% é uma premissa editável, não benchmark. Fluxos com múltiplas mudanças de sinal não exibem uma TIR única. Payback identifica recuperação definitiva dentro do horizonte, e déficit considera caixa inicial zero. Não são automaticamente indicadores do capital dos sócios.

## Verificação

Testes de XTIR contra o exemplo da Microsoft, VPL na raiz, consolidação ponderada por fluxos, horizontes até 2200, vencidos, datas ausentes, payback definitivo, paginação do coletor, reconciliação, autorização/RLS e rollback de cargas inválidas. Os testes usam fixtures locais; não substituem a conferência das fontes reais pendente acima.
