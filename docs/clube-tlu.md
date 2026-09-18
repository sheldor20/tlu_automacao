# Clube TLU

## Acessos e navegação

Clientes → Carteira de clientes mantém o módulo atual em `/clientes`. Clientes → Clube TLU abre `/clientes/clube-tlu` com Descontos, Parceiros, Retiradas e uso, Validar cupom e Acessos. Usuários com acesso de visualização ao departamento Clientes não recebem ações de escrita.

O portal externo fica em `/clube-tlu`. A identificação vem do usuário verificado pelo Supabase Auth, nunca de um papel, cliente ou parceiro enviado pelo navegador. Parceiros veem apenas seu estabelecimento. Clientes veem descontos publicados vigentes e seus próprios cupons. Não há cadastro público no portal.

## Primeiro uso

1. Em Parceiros, cadastre o estabelecimento, categoria, cidade e contato.
2. Em Acessos, cadastre o e-mail do parceiro e vincule ao estabelecimento. Para clientes, busque um registro real da carteira e vincule o e-mail autorizado.
3. Clique em Enviar acesso e confirme o destinatário. O envio não acontece ao salvar nem em lote.
4. O convidado entra pelo link recebido e pode definir uma senha. Também pode entrar por link de e-mail em acessos futuros.
5. O parceiro cadastra o benefício, descrição, regras, validade, limite total, limite por cliente e prazo de utilização. Salva como rascunho, publica ou pausa.

## Retirada e utilização

O cliente abre as regras e clica em Aceitar regras e retirar cupom. O banco gera um token `TLU` + 20 dígitos hexadecimais aleatórios (80 bits criptográficos), com unicidade garantida por constraint e repetição limitada em eventual colisão. A apresentação visual usa blocos separados por hífen. Não são utilizados CPF, sequência ou horário na geração.

Cada retirada preserva uma cópia das regras, benefício e validade aceitos. Edições posteriores não alteram cupons existentes. O identificador idempotente é mantido no cliente durante uma tentativa: uma repetição de rede retorna o mesmo cupom, sem consumir novo estoque.

No atendimento, o cliente apresenta o código. O parceiro consulta, confere as regras e confirma a utilização. O banco bloqueia o registro durante a confirmação e rejeita uso duplicado ou fora da validade. Consultar não marca como utilizado. Parceiros não recebem códigos de terceiros ou códigos ainda não apresentados no histórico; não há busca por prefixo do código.

A retirada bloqueia a oferta para verificar estoque e quota por cliente de forma transacional. Diferentes e-mails vinculados ao mesmo cliente compartilham o limite. Pausar uma oferta impede novas retiradas sem cancelar as existentes. Inativar o parceiro suspende seu acesso, novas retiradas e validações; preserva o histórico.

Indicadores acumulados: retirados, utilizados, disponíveis e expirados sem uso. Retirados = utilizados + disponíveis + expirados. A taxa de uso é utilizados / retirados. Os totais não dependem da paginação de 25 registros. Há atualização manual, ao voltar à janela e a cada minuto em tela ativa.

## Banco e segurança

As migrations `20260918001913_club_tlu_partners_coupons` e `20260918002510_club_tlu_external_profile_visibility` foram aplicadas ao projeto Supabase de TLU. Não reaplique o SQL diretamente em ambiente onde já estão registradas.

Seis tabelas `club_*` usam RLS e negam acesso direto a anon/authenticated. RPCs públicas usam SECURITY INVOKER com EXECUTE apenas para service_role. Helpers privilegiados ficam em `club_private` com search_path vazio e grants restritos. O endpoint usa Bearer verificado com auth.getUser; não aceita identidade no payload nem autenticação por cookie para escrita. Rate limit por conta e ação é persistido em transação separada antes do comando. Códigos, tokens e payloads não são registrados nos logs.

Novos perfis externos são criados inativos para o sistema interno, sem perfil administrador. A aprovação do clube é independente. A política restritiva de leitura de profiles impede que acessos externos enumerem os funcionários. Permissões de funcionários existentes são preservadas. Não conceder departamentos ou ativar o perfil interno apenas para habilitar um parceiro: utilize Acessos do Clube TLU.

O Security Advisor não apontou função nova do clube executável por anon/authenticated. Os seis avisos informativos RLS enabled/no policy são intencionais: acesso direto negado, serviço autorizado via API. O projeto também possui alertas preexistentes de funções SECURITY DEFINER e proteção de senhas vazadas; não foram alterados globalmente por esta funcionalidade. Referências: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy e https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.

## Configuração operacional

Reutiliza NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY. Nenhuma dependência nova. Antes de convidar usuários reais, verificar entrega de e-mail/SMTP do Supabase Auth e adicionar a URL `/clube-tlu` do domínio utilizado à lista de redirecionamentos permitidos. O AppShell encaminha acessos externos aprovados ao clube quando um link cai na rota interna padrão. Não foram disparados convites reais durante a implementação.

## Validação

- `node --experimental-strip-types --test tests/club.test.ts`: nove testes de token, formatação, validade e indicadores passaram.
- `supabase/tests/club_tlu.sql`: suíte de integração transacional com 48 verificações. Executar como postgres; cria apenas fixtures sintéticas, não envia mensagens e encerra com ROLLBACK. Inclui execução service_role e políticas reais do papel authenticated.
- A suíte do banco cobre papéis, isolamento, quota compartilhada, capacidade, idempotência, edição concorrente por versão, snapshot de regras, pausa, validade, resgate único, auditoria, rate limit e desativação. Teste de carga com sessões paralelas e entrega real dos e-mails são verificações separadas, não simuladas como aprovadas.
- Para homologação de interface: gestor cadastra parceiro e acessos; parceiro publica; cliente retira; parceiro consulta e confirma; nova tentativa é bloqueada; cliente vê utilizado. Conferir também larguras 390/768/1440 px e navegação por teclado.

## Reversão da interface

Reverter a PR de interface/API não exige apagar as tabelas. Preservar o histórico do clube. Não excluir vouchers usados nem relaxar a proteção das contas externas para reverter um deploy.
