# TLU Automação

Sistema de gestão integrada da Terra Lótus Urbanismo para Novos Negócios, Obras
e Projetos.

## Módulos

- **Novos Negócios:** funil, VGV potencial, conversão, tempo por fase, mapa e
  transferência automática para Obras.
- **Obras:** portfólio, orçamento mensal, macro e micro etapas, pesos, insumos,
  evidências obrigatórias e relatório PDF.
- **Projetos:** quadro de tarefas, responsáveis, prazos, alertas, comentários,
  arquivos, envolvidos e e-mail de status.

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
