# Carteira de imóveis e recebimentos do Qlik

## Estado da integração

Acesso ao Qlik restabelecido em 16/09/2026. A tabela de imóveis foi conferida
sem seleções e exportada pela interface: 114 códigos distintos. O objeto é
`73b90703-d778-45d0-bce2-a877f4a4c7a1`, com colunas `Cód Imóvel`, `Imóvel`,
`Tipo Imóvel` e `É p/ Locação?` (`Sim`/`Não`). O campo financeiro
`Cód Unidade Negócio` usa o mesmo formato textual, por exemplo `1|006`.
O estado operacional e o resultado de cada carga ficam em `data_connections`
e `data_connection_runs`; o agendamento só opera com a conexão ativa.

O cadastro manual foi removido e o nome só pode ser alterado pelo servidor.
Contratos e lançamentos existentes são preservados. Nome, tipo e permissão para
locação são mantidos pelo Qlik e protegidos contra alterações pelo cliente.
A ocupação e os dados do contrato continuam editáveis. O IR é opcional por mês
e descontado do líquido manual.

## Origens e horários

| Origem | Aplicativo | Folha | Horário em Brasília |
| --- | --- | --- | --- |
| Carteira | `5073ca65-2740-43d7-9688-70b76e124382` | `14e708cf-cef9-49a2-8e26-71fe61bed660` | 06:00 |
| Recebimentos | `e3d13862-ec1f-4332-8a5b-df4c7b93fa7c` | `bd84bea2-0f3c-4dc6-9081-0eab08502ba3` | 06:30 |

Os endpoints `/api/cron/qlik/rental-inventory` e
`/api/cron/qlik/rental-receipts` exigem `CRON_SECRET`. A Vercel agenda em UTC
(`0 9 * * *` e `30 9 * * *`). As credenciais `QLIK_USERNAME`, `QLIK_PASSWORD`
e `SUPABASE_SERVICE_ROLE_KEY` ficam exclusivamente no servidor.

O vínculo confirmado pelo usuário é **Cód. Imóvel = Cód Unidade Negócio**.
O código é texto: `001` não é convertido em `1`. Só espaços nas extremidades
são removidos. O nome não é chave dos recebimentos.

## Validação necessária para ativar

1. Inspecionar a tabela da carteira para confirmar seu `object_id`, a coluna
   `Cód Imóvel` e a coluna de nome.
   Registrar `object_id`, `id_column` e `name_column` em `data_connections.settings`
   da conexão `qlik-rental-inventory`.
2. Conciliar todos os imóveis locais com os códigos da origem. A primeira carga
   admite nome exato sem ambiguidade; nomes diferentes exigem `legacy_matches`,
   um objeto que associa o código Qlik ao UUID local. Contratos antigos revisados
   cujo código exige confirmação podem ser preservados em `pending_legacy_ids`.
   Eles ficam sinalizados na interface, sem atribuição de recebimentos por aproximação.
   Qualquer contrato sem vínculo fora dessa lista interrompe e desfaz a carga.
   Na revisão inicial, 24 dos 31 contratos tiveram correspondência; sete dependem
   de confirmação por subdivisões e agrupamentos com descrições diferentes.
3. Confirmar os recebimentos da folha financeira, agrupados por
   `Cód Unidade Negócio` e `Período`, usando a medida nativa do objeto
   `b92ac856-4098-44d8-bc83-a21a48e68db5`, índice zero. Esse objeto e essas
   variáveis vêm da integração financeira já existente. O código `1|006` foi
   verificado no painel: 35 parcelas e total exibido de 56,43 mil.
   São usados `vQtdDias=99999999` (“Tudo”) e `vDesembolsoFinanceiro=Normal`.
   Conferir alguns imóveis e competências contra os valores visíveis no Qlik.
4. Após validar o mapeamento da carteira, definir `mapping_verified=true` e
   `active=true` nessa conexão e executar uma primeira carga autorizada.
   Conferir os vínculos e contratos preservados. Só depois validar/ativar
   a conexão `qlik-rental-receipts` e conferir sua primeira carga.

Tipo e permissão usam `type_column`, `rentable_column` e `rentable_values` com
listas `yes`/`no` explícitas. A interface e as permissões do banco impedem edição
manual desses campos. Para disparar uma rotina já configurada na produção,
usar `vercel crons run /api/cron/qlik/rental-inventory` ou `rental-receipts`.

## Comportamento e conferência

- Atualização atômica: leitura incompleta, total divergente, código duplicado,
  data inválida ou vínculo ambíguo preserva a carga anterior.
- Carteira e recebimentos usam o mesmo bloqueio transacional. Uma carga antiga
  não sobrescreve uma mais recente.
- Imóveis ausentes na próxima carga recebem um aviso; não são excluídos.
- Recebimentos são consolidados por código e mês, incluindo estornos assinados,
  e vinculados ao UUID estável do imóvel. Repetir uma carga não duplica valores.
- Unidades financeiras sem imóvel correspondente não são importadas. O histórico
  registra a quantidade de linhas mensais sem correspondência.
- O total importado aparece no gráfico e histórico “Recebimentos do Qlik”.
  Não é somado aos lançamentos manuais nem tratado como aluguel bruto, pois
  não foi validada a composição de taxas, impostos e outros ajustes da origem.
- As tabelas de importação são somente leitura para usuários com acesso ao
  departamento. Contratos e lançamentos manuais continuam editáveis.

Conferir execuções em `data_connection_runs` e a última carga confirmada em
`data_connections.last_success_at`. Testes de parser, persistência, permissões,
vínculo, repetição e preservação estão em `tests/qlik-rentals*.test.ts`.
