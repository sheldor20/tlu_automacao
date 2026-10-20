# Solicitações e gestão de contratos

O menu **Solicitações** mantém os pagamentos e inclui **Contratos** em **O que você precisa solicitar?**. As rotas de pagamentos e seus links existentes continuam funcionando. Na aba **Minhas solicitações**, pagamentos e contratos aparecem em seções separadas. **Gestão de contratos** aparece ao lado de **Gestão de pagamentos** para quem tem o respectivo acesso.

Em **Administração → editar usuário → Gestão de contratos**, o ADM pode conceder ou revogar a gestão. Administradores possuem acesso completo. A permissão de pagamentos não concede gestão de contratos, nem o inverso. Todos os usuários ativos podem solicitar e consultar seus próprios contratos. O formulário público também aceita contratos e fornece um link exclusivo de acompanhamento, que deve ser guardado pelo solicitante.

## Solicitação

Tipos: locação comercial, prestação de serviços, compra e venda, aditivo, distrato contratual e outro. São coletados empresa solicitante, identificação e endereço das partes, representantes, contato, objeto, valor, condições, vigência, prazo desejado e observações. Aditivo e distrato exigem identificação do contrato original; outro exige descrição do tipo. Locação exige endereço do imóvel, aluguel, início e término, prazo em meses, data do primeiro aluguel e dia de vencimento. Matrícula, carência, reajuste, renovação, garantia, dados bancários, foro, assinatura e testemunhas podem ser preenchidos para compor a minuta.

Existem apenas três status: **Em andamento**, **Finalizando**, **Falta informações**. O gestor pode editar os dados e mudar o status. Ao pedir informações, uma mensagem explicando a pendência é obrigatória. O solicitante pode responder pelo histórico e complementar os dados quando estiver em **Falta informações**; o envio dos dados retorna o pedido para **Em andamento**. Mensagens e mudanças ficam no histórico. Atualizações usam a versão do registro para impedir sobrescritas simultâneas.

## Minuta

A opção **Baixar minuta .doc** de locação utiliza as 14 cláusulas do PDF fornecido, substituindo as qualificações, imóvel, valores, datas, banco, foro e assinaturas pelos campos informados. Nenhum nome, documento, endereço, data ou conta das partes do exemplo é reutilizado como valor padrão. Campos opcionais ausentes ficam indicados como **[PREENCHER]**. As condições do modelo permanecem editáveis para conferência e finalização. O arquivo é RTF compatível com Word com extensão `.doc`, não o formato binário Word 97. Outros tipos geram uma ficha editável de dados, identificada como material para elaboração; não reutilizam as cláusulas de locação.

## Acesso e dados

Aplicar `supabase/migrations/20261020114323_contract_requests.sql` antes de publicar a aplicação. A migração adiciona tabelas independentes, sem alterar solicitações de pagamento existentes. As tabelas de contratos e eventos têm RLS e acesso reservado ao servidor; o cliente acessa apenas as rotas autenticadas. Permissões são concedidas somente pela API administrativa. Tokens públicos aleatórios de 256 bits são guardados somente como SHA-256; downloads, consultas e atualizações repetem a verificação de acesso. Os links públicos não concedem gestão. Formulários públicos têm limite de envios e chave de idempotência. Contratos não utilizam a fila de e-mails de pagamentos: acompanhamento e comunicação são feitos pelo sistema/link fornecido no envio.

## Verificação

`npm test` valida o projeto, incluindo migração real com PGlite, concessão/revogação de acesso, ADM, solicitante, gestor, terceiro, usuário inativo, acesso público, restrições diretas no banco, concorrência, status e histórico. Os testes de geração verificam as 14 cláusulas, preenchimento, remoção dos dados específicos do exemplo, diferenciação de tipos e escape de conteúdo no Word. `npm run typecheck` e `npm run build` verificam integração e compilação. O documento RTF também foi reaberto com o leitor de documentos do macOS para confirmar a leitura dos caracteres.
