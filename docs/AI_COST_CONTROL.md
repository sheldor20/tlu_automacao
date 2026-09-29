# Controle de consumo de IA

Lê PDFs textuais sem enviar imagens quando todas as páginas são confiáveis; mantém leitura visual para imagens/diagramas. Seleciona etapas e vizinhas relevantes em perguntas específicas, preservando políticas e o processo completo em perguntas gerais. Consulta o HTML do Instagram antes da leitura visual com IA. 399 testes e build passam. Lint dos arquivos alterados passa; há uma falha preexistente em components/club-workspace.tsx.

O cache dura 24 horas (passagens vetoriais: 30 dias). As chaves incluem o usuário, o contexto autorizado, a versão da operação, o modelo e a entrada. Falhas e respostas incompletas não são armazenadas. As autorizações de negócio são verificadas antes da consulta ao cache.

Aplicar `20260929150000_ai_efficiency_cache.sql` e configurar a chave `SUPABASE_SERVICE_ROLE_KEY` somente no servidor, junto de `SUPABASE_URL` ou `NEXT_PUBLIC_SUPABASE_URL`. A migração foi aplicada e verificada em 29/09/2026. As tabelas não concedem leitura/escrita a anon/authenticated. Sem a chave ou durante indisponibilidade do cache, a operação continua usando a OpenAI; as métricas continuam nos logs.

`ai_usage_events` registra operação, modelo, identificador de resposta e tokens, sem prompts ou documentos. Respostas reaproveitadas registram zero tokens; a identificação da resposta evita contagem duplicada na consulta de tarefas em segundo plano. Os valores anteriores à implantação não podem ser reconstruídos por rota.

Consulta de acompanhamento:

```sql
select system_name, operation, model, count(*) as requests,
 count(*) filter(where cache_hit) as cache_hits,
 sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens
from public.ai_usage_events
where created_at >= now() - interval '30 days'
group by system_name, operation, model;
```
