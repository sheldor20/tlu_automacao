# TLU Automação

Sistema de gestão integrada da Terra Lótus Urbanismo para Novos Negócios, Obras
e Projetos.

## Módulos

- **Novos Negócios:** funil, VGV potencial, conversão, tempo por fase, mapa,
  arquivamento e transferência automática para Obras.
- **Obras:** portfólio, orçamento mensal, macro e micro etapas, pesos, insumos
  estruturados, evidências obrigatórias, arquivamento e relatório PDF.
- **Projetos:** quadro de tarefas, diretório de usuários do Supabase, prazos,
  alertas, comentários, arquivos, envolvidos e e-mail de status.
- **Aluguéis:** imóveis, contratos, atualização direta de status e resultado
  mensal líquido de comissão, com reajuste anual.
- **Administração:** criação de usuários e acesso a um ou mais departamentos,
  aplicado ao menu e às políticas RLS do Supabase.

## Desenvolvimento

```bash
npm install
cp .env.example .env.local
npm run dev
```

O banco e o passo a passo de configuração estão em [supabase/README.md](supabase/README.md).

## Segurança

- sem cadastro público no front-end;
- autenticação pelo Supabase;
- RLS em todas as tabelas operacionais;
- storage privado e URLs temporárias;
- validação do token no endpoint de e-mail;
- variáveis sensíveis apenas no servidor;
- estrutura de departamentos preparada para níveis de acesso futuros.
