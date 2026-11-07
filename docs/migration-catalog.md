# Catálogo de migrações

Os arquivos históricos mantêm os identificadores de versão usados na execução.
As referências nos testes e documentos acompanham esses identificadores.
SQL histórico recuperado não representa uma nova migração a ser reaplicada em
ambientes que já o registram.

Antes de publicar alterações, conferir o catálogo com o histórico do ambiente de
destino por consulta somente de leitura. Uma divergência exige um plano próprio
e autorização. Não reaplicar importações ou preencher o histórico automaticamente.
Relatórios de operação, snapshots de produção e planos específicos de reparo não
fazem parte deste repositório.

## Testes locais

```bash
node --experimental-strip-types --test --test-concurrency=2 tests/*.test.ts
npm run typecheck
npx next build --webpack
```

`tests/migration-history.test.ts` verifica versões duplicadas, presença dos SQL
históricos necessários, replay em PostgreSQL/PGlite isolado e restrições de acesso.
Auth e Storage usam fixtures. O pg_cron usa um registro simulado: o teste confere
horário e comando, mas não executa um agendamento real.

O helper existente não executa a importação específica de projetos que depende
de uma conta real. O teste não conecta a produção nem certifica efeitos históricos
em dados reais. A suíte completa inclui os testes dos módulos afetados.
