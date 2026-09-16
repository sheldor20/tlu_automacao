# Carteira de imóveis e recebimentos do Qlik

## Estado da integração

As duas rotinas estão instaladas com `active=false` e `mapping_verified=false`.
Não houve carga inicial nem validação ao vivo da nova associação: o navegador
bloqueou acesso ao Qlik por não conseguir verificar uma política administrada.
Não ativar apenas para remover o aviso da interface.

O cadastro manual foi removido e o nome só pode ser alterado pelo servidor.
Contratos e lançamentos existentes são preservados. Tipo e permissão para locação
são informados manualmente, independentemente da ocupação. A permissão inicialmente
é “Não informado”. O IR é opcional por mês e descontado do líquido manual.

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

1. Restabelecer o acesso autorizado ao Qlik. Inspecionar a tabela da carteira
   para confirmar seu `object_id`, a coluna `Cód. Imóvel` e a coluna de nome.
   Registrar `object_id`, `id_column` e `name_column` em `data_connections.settings`
   da conexão `qlik-rental-inventory`.
2. Conciliar todos os imóveis locais com os códigos da origem. A primeira carga
   admite nome exato sem ambiguidade; nomes diferentes exigem `legacy_matches`,
   um objeto que associa o código Qlik ao UUID local. Qualquer imóvel local sem
   vínculo interrompe e desfaz toda a carga, para preservar contratos e histórico.
3. Confirmar os recebimentos da folha financeira, agrupados por
   `Cód Unidade Negócio` e `Período`, usando a medida nativa do objeto
   `b92ac856-4098-44d8-bc83-a21a48e68db5`, índice zero. Esse objeto e essas
   variáveis vêm da integração financeira já existente; o novo agrupamento
   por código de imóvel ainda precisa de validação na origem.
   São usados `vQtdDias=99999999` (“Tudo”) e `vDesembolsoFinanceiro=Normal`.
   Conferir alguns imóveis e competências contra os valores visíveis no Qlik.
4. Após validar o mapeamento da carteira, definir `mapping_verified=true` e
   `active=true` nessa conexão e executar uma primeira carga autorizada.
   Conferir os vínculos e contratos preservados. Só depois validar/ativar
   a conexão `qlik-rental-receipts` e conferir sua primeira carga.

Se tipo e permissão passarem a ser fornecidos pelo Qlik, o parser aceita
`type_column`, `rentable_column` e `rentable_values` com listas `yes`/`no`
explícitas. Nesse caso, alinhar também a edição dessas informações na interface
para não sobrescrever alterações locais na próxima sincronização.

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
