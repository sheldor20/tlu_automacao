# Revisão local — vários contratos em Distratos

Escopo autorizado em 04/11/2026: implementação e testes isolados. Não publicar, abrir PR, mesclar, fazer deploy, migrar banco ou emitir lançamentos reais.

Base: `3df08b63d7f42953d2e06976624927c2a2a2a89e`. Na retomada após desconexão, `git fetch origin main` confirmou a mesma base, sem commits novos nem conflitos a incorporar. Branch: `codex/distratos-multi-local-20261104`.

## Comportamento preparado

- Selecionar um ou mais contratos da mesma obra/quadra/lote por ID exato, mantendo zeros à esquerda. Mesmo nome com IDs distintos continua separado. Registro repetido do mesmo contrato não duplica seleção/documento. Não há rateio por titular.
- Cada contrato tem suas fontes, formulário, regra, meses de fruição, correção, cálculo, histórico e PDF. Os percentuais, regras, consultas e permissões existentes permanecem no servidor.
- O resumo mostra venda e pagamentos nominais consultados na origem, separados da base de venda usada no cálculo e dos resultados calculados. Ausências ficam identificadas. Edição manual da base não muda a coluna da origem. Remover contrato ou trocar lote elimina seus valores da seleção atual.
- Somar restituições individuais, sem compensar saldo negativo de outro contrato. Resumo parcial explícito; CSV habilitado somente com todos os documentos atuais. Não somar valores de imóveis nem meses de fruição. Recebimentos repetidos bloqueiam consolidação.
- Geração sequencial com falhas individuais. Cancelar significa parar após concluir a operação corrente, preservando seus resultados. Repetição, resposta perdida e recarga na mesma aba preservam o UUID da operação para recuperação pelo endpoint existente. Nenhum retry automático de gravação incerta.
- Kim esclareceu que “faturamento” significa **mostrar o valor no resumo**. Não criar Solicitação de Pagamento, nota, cobrança ou lançamento. Não resta ambiguidade de faturamento neste escopo.

## Arquivos

`app/(app)/distratos/page.tsx`: seleção, coordenação e resumo. `contract-panel.tsx`: formulário/documento individual extraído do fluxo anterior. `distratos.css`: seleção acessível e grupos de contratos. `lib/distratos-batch.ts`: idempotência do cliente, cancelamento, consolidação/CSV. Testes em `tests/distratos-batch.test.ts` e `tests/browser/`. Documentação em `docs/distratos.md`.

Não há alterações de API, Qlik, banco, autenticação, permissões, percentuais, cálculo jurídico ou dados de negócio.

## Validações

- `npm test`: 565 testes aprovados, incluindo 15 novos casos de seleção, bases individuais, totais, duplicatas, falhas parciais, cancelamento, retomada e distinção entre origem/base calculada.
- `npm run build`: aprovado.
- `npm run typecheck`: aprovado após a última alteração de resumo.
- ESLint dos arquivos alterados e dos scripts de interface: aprovado.
- Interface desktop/mobile: **115 verificações aprovadas** em 1440×1000 e 390×844, com dados fictícios. Inclui teclado, IDs/zeros exatos, nomes iguais, contrato compartilhado/repetido, seleção/remoção/troca de lote, origem versus base manual, valores ausentes, falha parcial/resposta perdida, cancelamento/retomada e acesso somente leitura.
- CSV: conteúdo baixado pelo navegador corresponde aos bytes verificados, contém somente a seleção atual e preserva a separação origem/cálculo. Remover um contrato também o remove do CSV.
- PDFs: quatro downloads (dois contratos em cada viewport), usando o renderizador real com documentos fictícios. Cada PDF foi aberto pelo parser, tem memória/pagamentos/termo e contém somente o identificador de documento/contrato esperado. Downloads nativos conferidos byte a byte. Capturas desktop/mobile inspecionadas, incluindo rolagem horizontal da tabela no celular.
- Rede: zero chamadas externas; requisições de negócio interceptadas. O teste não atesta integração com dados/autenticação reais.
- Limpeza: Chrome encerrado, somente os PIDs verificados do harness receberam SIGTERM, porta 3137 confirmada livre e GUI devolvida. Nenhuma ação na prévia CSC 64861. Downloads fictícios da rodada inicial foram identificados por conteúdo/hash e movidos para as evidências; o roteiro final direciona os downloads para uma pasta temporária dentro do checkout.

Para reproduzir a interface, reservar a GUI com a coordenação e executar:

```sh
node tests/browser/prepare-distratos-harness.mjs
cd .local/distratos-multi-harness
NEXT_PUBLIC_SUPABASE_URL=https://navigation-test.invalid NEXT_PUBLIC_SUPABASE_ANON_KEY=local-fixture npm run dev
```

Em outro terminal, na raiz do checkout:

```sh
node --experimental-strip-types tests/browser/distratos-multi.mjs
```

O harness renderiza o componente real em `127.0.0.1:3137`, sem AppShell/autenticação real e sem instalação/daemon. O processo temporário escuta somente no loopback e deve ser encerrado após o teste. Não modificar nem parar a prévia CSC em `127.0.0.1:64861`. O teste inicia Chrome headless com perfil próprio, intercepta todos os endpoints de Distratos, usa uma sessão fictícia e bloqueia rede externa. As gravações simuladas ficam apenas em `Map` na memória do teste. Não usa banco, TJDFT ou Qlik. Não atesta integração autenticada em produção. `CHROME_PATH` e `DISTRATOS_TEST_URL` podem apontar a outro Chrome/localport; URLs não locais são rejeitadas. Evidências ficam em `.local/distratos-multi-evidence` (ou `DISTRATOS_EVIDENCE_DIR`): resultado JSON, capturas, CSVs, PDFs e downloads nativos.

## Limites e proposta para produção

O diário de idempotência dura a sessão da mesma aba. Fechar a sessão/usar nova aba não recupera esse diário: conferir o histórico existente antes de iniciar outra geração. Falha de armazenamento impede iniciar uma geração. A API mantém suas validações de acesso, revisão da base e limite de 30 gerações por hora por usuário.

Proposta exata após autorização futura: publicar somente esta seleção múltipla, documentos individuais e resumo/CSV, sem integração com Solicitações de Pagamento e sem migração. O QA local está concluído. Antes de publicar: revisar diff, conferir novamente main e repetir os checks afetados se houver atualização de base. Depois da aprovação específica: push/PR/checks/merge e acompanhar o deploy, preservando regras e permissões. Não executar geração real como teste de produção sem autorização específica para essa gravação.
