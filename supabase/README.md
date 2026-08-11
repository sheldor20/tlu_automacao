# Configuração do Supabase

## 1. Criar o banco

No painel do Supabase, abra **SQL Editor > New query** e execute as migrations
abaixo, uma por vez e nesta ordem:

1. `migrations/20260811120000_initial_schema.sql`
2. `migrations/20260811190000_business_project_link_and_project_archiving.sql`
3. `migrations/20260811203000_operational_archiving_supplies_and_user_directory.sql`

Em instalações que já executaram as migrations anteriores, rode apenas a nova.

Esse SQL cria:

- tabelas, enums, índices e views dos três departamentos;
- histórico automático de fases de Novos Negócios;
- criação automática de uma obra ao mover um negócio para `Obra`;
- cálculo ponderado do avanço das obras;
- regra que exige uma nova evidência antes de alterar o avanço de uma micro etapa;
- cálculo de progresso e alertas de projetos;
- arquivamento e exclusão de negócios, obras e projetos;
- insumos opcionais com valor e quantidades total e utilizada;
- diretório de responsáveis sincronizado com os usuários do Supabase;
- RLS para restringir o sistema a usuários autenticados;
- buckets privados de evidências e arquivos.

## 2. Criar usuários

Em **Authentication > Users**, use **Add user > Create new user**. Não habilite
cadastro público no aplicativo. Os usuários criados diretamente pelo Supabase
conseguirão entrar na tela de login.

## 3. Configurar o Vercel

Em **Settings > Environment Variables** do projeto Vercel, adicione:

```env
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=SUA-CHAVE-PUBLICA
```

Use somente a chave pública (`anon`/publishable) no `NEXT_PUBLIC_*`. A chave
`service_role` nunca deve ser colocada no navegador.

## 4. Habilitar os e-mails de status

Crie uma chave no Resend e adicione no Vercel:

```env
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=Terra Lotus <projetos@seudominio.com.br>
```

O endpoint valida o token do Supabase antes do envio e registra cada disparo em
`email_dispatches`.
