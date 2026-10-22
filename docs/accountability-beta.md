# Prestação de contas BETA

Rota: `/prestacao-contas`. O ADM libera o departamento `prestacao-contas` no cadastro do usuário. As consultas e o endpoint de envio validam a permissão no servidor; as tabelas também aplicam RLS. Somente o servidor altera os registros de envio.

O painel usa o ano vigente em America/Sao_Paulo. Os 15 valores de empreendimento foram conferidos no filtro do Qlik. Janeiro a setembro de 2026 estão fechados e possuem 135 registros históricos, conforme confirmação do solicitante. Os registros históricos não alegam entrega pelo provedor. Um teste BETA conserva `historical_sent` e registra o resultado BETA separadamente no status.

Todos os envios têm destinatário fixo `rosangela@terralotusurbanismo.com.br`; o navegador não recebe opção de destinatário. Nenhuma lista de terceiros foi configurada. O status `sent_beta` significa aceitação pelo provedor, não confirmação de entrega na caixa de entrada. Timeout durante o envio gera `uncertain`, sem reenvio automático.

## Integração ainda necessária

A autenticação interativa no navegador não configura uma execução de exportação no servidor. A exportação nativa automatizada do Qlik ainda precisa ser provisionada e testada. Enquanto isso, o painel mostra a pendência e desabilita os botões de envio. Não há exportador de exemplo ou relatórios simulados em produção.

O adaptador está em `lib/accountability/book.ts`. Variáveis do servidor:

- `QLIK_ACCOUNTABILITY_EXPORT_URL`: endpoint HTTPS de uma automação de exportação em domínio `qlikcloud.com`.
- `QLIK_ACCOUNTABILITY_EXPORT_TOKEN`: autenticação Bearer desse endpoint.
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SUPABASE_SERVICE_ROLE_KEY`: envio e registro, seguindo a infraestrutura existente.

O POST do exportador recebe `appId`, `enterprise`, `year`, `month`, `sheetIds`, `expandConsolidated: "all"`, `detailedRevenue: "complete-table-pdf"`, `receivables: "xlsx"`, `preserveSourceData: true`.

Contrato de retorno JSON:

```json
{
  "enterprise": "valor exato do filtro Empreendimento",
  "year": 2026,
  "month": 9,
  "expandedConsolidated": true,
  "detailedRevenueComplete": true,
  "pdfs": [{ "sheetId": "cada uma das treze pastas solicitadas", "base64": "PDF original" }],
  "receivablesXlsx": "Excel original em base64"
}
```

Os filtros, a lista exata das treze pastas, o formato Excel e os PDFs são verificados antes do envio. O servidor adiciona capa e contracapa e copia todas as páginas dos PDFs na ordem solicitada, sem reescrever valores, tabelas ou gráficos. O exportador deve garantir a seleção isolada do empreendimento e período, todas as linhas da receita detalhada, todos os níveis da DRE consolidada e o Excel completo. As declarações booleanas do contrato não substituem a validação visual de uma exportação real.

## Validação

Testes cobrem destinatário fixo, setembro fechado, meses futuros, virada de mês em São Paulo e a lista de telas. A geração real e o envio ponta a ponta permanecem pendentes da integração de exportação. Nenhum e-mail foi enviado durante o desenvolvimento.
