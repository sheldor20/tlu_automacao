# Configuração do Supabase

## 1. Criar o banco

No painel do Supabase, abra **SQL Editor > New query** e execute as migrations
abaixo, uma por vez e nesta ordem:

Antes de executar, confirme no seletor **Role** do SQL Editor que está marcado
`postgres`. Não use `authenticated`: essa função representa os usuários do app e
não é proprietária das tabelas, portanto recebe o erro `must be owner of table`.

1. `migrations/20260811120000_initial_schema.sql`
2. `migrations/20260811190000_business_project_link_and_project_archiving.sql`
3. `migrations/20260811203000_operational_archiving_supplies_and_user_directory.sql`
4. `migrations/20260811220000_rentals_and_department_access.sql`
5. `migrations/20260812100000_operational_simplicity.sql`
6. `migrations/20260812170000_management_indicators.sql`

Em instalações que já executaram as migrations anteriores, rode apenas a nova.

Esse SQL cria:

- tabelas, enums, índices e views dos quatro departamentos;
- histórico automático de fases de Novos Negócios;
- criação automática de uma obra ao mover um negócio para `Obra`;
- cálculo ponderado do avanço das obras;
- regra que exige uma nova evidência antes de alterar o avanço de uma micro etapa;
- cálculo de progresso e alertas de projetos;
- arquivamento e exclusão de negócios, obras e projetos;
- insumos opcionais com valor e quantidades total e utilizada;
- diretório de responsáveis sincronizado com os usuários do Supabase;
- departamento de Aluguéis com dados contratuais, locação, comissão e reajuste;
- modelos persistidos de loteamento, construção e projeto;
- criação transacional de obras e projetos a partir de modelos;
- resumos operacionais para a página Hoje e filtros por exceção;
- reaproveitamento de responsável, datas e documentos quando um negócio gera uma obra;
- RLS por departamento, com menu e dados limitados às permissões de cada usuário;
- buckets privados de evidências e arquivos.
- painel gerencial com cinco visões, catálogo de indicadores e valores mensais;
- resumos seguros de Novos Negócios, Obras e Aluguéis para a gestão;
- atualização automática do painel por Supabase Realtime.

## 2. Alimentar os indicadores gerenciais

As integrações e cargas futuras devem gravar em `management_indicator_values`.
Cada competência usa sempre o primeiro dia do mês e o par
`area + metric_key` deve existir em `management_metric_catalog`.

Exemplo de atualização idempotente:

```sql
insert into public.management_indicator_values (
  area, metric_key, reference_month, dimension_key, value, source
) values (
  'empresa', 'receita_consolidada', '2026-08-01', 'total', 1250000, 'ERP'
)
on conflict (area, metric_key, reference_month, dimension_key)
do update set
  value = excluded.value,
  source = excluded.source,
  updated_at = now();
```

Para abrir receitas ou despesas por plano de contas, use uma linha por conta,
preenchendo `dimension_key` e `dimension_label`. O dashboard identifica a
competência mais recente e monta a composição automaticamente.

## 3. Administrar usuários

Depois da migration, o usuário mais antigo do Supabase vira o administrador
inicial. Entre no sistema e abra **Administração** para criar novos usuários e
liberar um ou mais departamentos. Não habilite cadastro público no aplicativo.

## 4. Configurar o Vercel

Em **Settings > Environment Variables** do projeto Vercel, adicione:

```env
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=SUA-CHAVE-PUBLICA
SUPABASE_SERVICE_ROLE_KEY=SUA-CHAVE-SERVICE-ROLE
```

Use somente a chave pública (`anon`/publishable) no `NEXT_PUBLIC_*`. A chave
`service_role` é usada somente pelo endpoint protegido do servidor para criar
usuários. Nunca use o prefixo `NEXT_PUBLIC_` nessa variável.

## 5. Habilitar os e-mails de status

Crie uma chave no Resend e adicione no Vercel:

```env
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=Terra Lotus <projetos@seudominio.com.br>
```

O endpoint valida o token do Supabase antes do envio e registra cada disparo em
`email_dispatches`.
