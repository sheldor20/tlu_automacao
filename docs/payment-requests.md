# Solicitações de pagamento

O menu **Pagamentos** está disponível para todo usuário ativo. Em **Administração → editar usuário → Gestão de pagamentos**, o administrador pode habilitar a consulta de todos os pedidos e as ações de gestão. Administradores possuem essa permissão. Usuários sem outros departamentos também podem solicitar pagamentos.

## Entrada e acompanhamento

- `/pagamentos`: solicitações do usuário; gestores também têm a aba Gestão de pagamentos, com busca por protocolo/título e filtros por status, tipo e empresa.
- `/pagamentos/nova`: formulário interno, com identidade e e-mail vinculados ao usuário autenticado.
- `/solicitar-pagamento`: formulário público, sem cadastro. O botão Copiar link público fica na listagem interna.
- `/acompanhar-pagamento#<token>`: acompanhamento individual, histórico, respostas, anexos e comprovantes. O token é uma credencial pessoal aleatória de 256 bits. Não é enviado na URL das requisições ao servidor nem em cabeçalhos de referência.

Os quatro formulários são: serviço (PF/PJ, escopo e data), materiais/insumos (quantidade, unidade, preço e entrega), distrato e boletos/contas. Todos coletam empresa, descrição, valor, prazo, orçamento máximo opcional, beneficiário, pagamento e propostas já recebidas. Em materiais/insumos, preço, beneficiário e forma de pagamento são opcionais. Preços em branco e o total ainda incompleto aparecem como “A definir”, sem serem convertidos em zero. O total só é calculado quando todos os itens têm preço. Os valores de materiais e distratos são conferidos no servidor. Um valor acima do orçamento máximo recebe um aviso para a gestão.

O distrato usa os campos da aba **Solicitafção de Pagamento** da planilha fornecida: cancelamento, atraso de obra, cliente/contrato/lote/quadra/processo, responsabilidade pelo IPTU, restituição, IPTU, honorários, custas e danos morais/materiais. O campo Contrato é opcional no distrato. Textos de instrução, assinaturas e operações históricas de outras abas da planilha não viraram regras ou solicitações reais.

As empresas vêm da última carga válida de `enterprise_performance_companies`, sincronizada com o campo Empresa do Qlik. A API pública expõe somente nomes e chaves de empresas, sem movimentos financeiros. O formulário mostra a data da carga. Não há lista demonstrativa nem cópia fixa das empresas da planilha.

## Gestão e e-mails

Fluxo: recebida → em análise → aprovada → agendada → paga → Finalizado. É possível pagar uma aprovada sem etapa de agendamento. Em etapas abertas, gestores podem pedir informações ou cancelar. Recusa é permitida durante a análise. Somente gestores podem passar de Paga para Finalizado. A finalização registra a data, preserva a data do pagamento e envia o e-mail de atualização ao solicitante. Solicitações pagas permitem apenas essa mudança; solicitações finalizadas ficam preservadas para consulta, sem novas alterações ou anexos. Respostas de solicitantes ao pedido de informações devolvem a solicitação à análise.

Serviço e Distrato exigem um comprovante enviado pela gestão e confirmado no armazenamento privado para marcar como paga ou Finalizado. Materiais/insumos e Boletos/contas dispensam o comprovante nas duas etapas. Documentos aceitos: PDF, JPEG, PNG, WebP, DOCX e XLSX, com até 10 MB por arquivo. O servidor verifica autorização, tamanho, tipo e assinatura inicial do conteúdo. URLs de download expiram em 60 segundos. Tokens de upload não permitem sobrescrever objetos existentes.

Criação, mudanças de status, mensagens e anexos geram histórico e uma entrada de e-mail na mesma transação. O despacho imediato usa `after()`; `/api/cron/payment-emails` tenta novamente a cada cinco minutos. Há bloqueio de concorrência, ordem por solicitação, chave de idempotência no Resend, retentativa progressiva e limite de 12 tentativas. A gestão vê a situação do envio e pode repetir falhas. “Enviado ao provedor” significa que o Resend aceitou o envio; não é confirmação de leitura nem de entrega na caixa postal.

Configuração do servidor:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` já usados pela aplicação.
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` e `CRON_SECRET` já usados pela aplicação.
- `PAYMENT_APP_URL=https://www.terralotus.space` fixa o endereço confiável dos links enviados por e-mail.

O agendamento está em `vercel.json` e roda somente em produção. A aplicação registra e acompanha o pedido; não executa transferências bancárias.

## Permissões e integrações futuras

Leitura autenticada protegida por RLS: solicitante vê os próprios pedidos; gestor ativo vê todos. Mutações, fila, tokens e URLs de arquivos passam pelo servidor e por funções exclusivas de `service_role`. O perfil e a permissão são consultados a cada operação; metadados editáveis do usuário não concedem gestão. E-mails não concedem acesso por correspondência de endereço.

Envios públicos e operações repetidas usam limites persistidos no banco. A origem aceita hoje `public` ou `internal`. Os campos `source` e `source_reference`, os modelos validados e o fluxo transacional deixam espaço para adaptadores autenticados de WhatsApp e e-mail. Esses canais de entrada ainda não estão conectados. Um futuro adaptador deve verificar a assinatura do provedor, preservar sua referência externa para idempotência e reutilizar a validação antes de criar o pedido.

## Verificação

`npm test`, `npm run typecheck`, `npm run lint` e `npm run build` verificam o projeto. `tests/payment-database.sql` testa o ciclo real de status, idempotência, concorrência, comprovantes, RLS, concessão/revogação e fila, sempre em transação com rollback. Requer um administrador e dois membros ativos existentes como contexto de autorização, sem alterar seus dados de forma persistente.

Também foram exercitados formulário público no navegador, desktop/celular e 36 verificações HTTP com contas e solicitações temporárias, incluindo armazenamento real de documentos privados. Os registros e contas de teste são removidos após a conferência.

Referências de implementação: [segurança do Storage](https://supabase.com/docs/guides/storage/security/access-control), [CNPJ numérico e alfanumérico](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj), [endereços de teste do Resend](https://resend.com/docs/dashboard/emails/send-test-emails).
