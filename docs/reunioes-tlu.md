# Reuniões TLU

O menu “Pauta e RA” passa a se chamar “Reuniões TLU”. A URL `/pauta-ra`, as tabelas RA e os registros existentes são preservados. Reuniões antigas recebem o tipo RA, sem alteração da pauta ou do texto da ata.

## Ritos e modelos

RAE (mensal, dia 15), RASP (quinzenal), RA e RAO (semanais) e 1:1 (mensal, 30–45 minutos) usam o mesmo fluxo: preparação, blocos e assuntos, múltiplas definições, responsáveis, prazos, conversão em tarefa, finalização, ata, reenvio, arquivamento/restauração e exclusão. O documento de ritos determina a pauta sugerida e os campos de registro. A periodicidade orienta o agendamento; não são geradas reuniões futuras automaticamente.

O registro estruturado integra a ata no encerramento. O formulário de criação usa uma operação atômica para impedir pautas parcialmente criadas. As datas da RAE sugerem o próximo dia 15.

## Participantes e privacidade

Em Administração → Reuniões TLU, cada lista define o acesso ao tipo e os participantes sugeridos. O acesso é verificado no banco; remover uma pessoa da lista revoga sua leitura inclusive dos encontros anteriores desse tipo. O histórico de presenças não é reescrito. Administradores têm acesso às reuniões coletivas; em 1:1 não há exceção administrativa para quem não pertence à dupla.

As listas iniciais correspondem aos nomes informados pelo solicitante. O preenchimento usa correspondências únicas no diretório ativo, sem criar contas nem atribuir identidades ambíguas. Gabriela Reis corresponde a Gabriela Alves dos Reis; Rafaela a Rafaella de Oliveira Silva. Aylton não foi localizado: a tela administrativa exibe a pendência para inclusão posterior em RAE e RA.

O 1:1 é agendado pelo líder para um colaborador da sua relação de liderança direta, configurada em Editar usuário → Líder direto. Somente a dupla original vê a pauta, os registros, as decisões, a ata e suas revisões. Uma mudança posterior de liderança não transfere o histórico ao novo líder. Todas as pessoas ativas recebem inicialmente acesso ao módulo; o administrador pode revogar o departamento.

Projetos podem ser consultados na pauta. As tarefas originadas de 1:1 são avulsas e mantêm acesso exclusivo à dupla, inclusive em tarefas, comentários, arquivos, subtarefas e notificações. Seus responsáveis não podem ser ampliados para terceiros, e a exclusão da reunião preserva a privacidade das tarefas restantes.

## Correção de atas

Após o encerramento, um administrador com acesso ao encontro pode usar “Editar ata”. A reunião continua encerrada e a data de encerramento não muda. A versão anterior, a nova versão, o autor e a data são preservados em histórico somente para leitura. A gravação verifica a revisão esperada e rejeita sobrescrita concorrente. Reuniões arquivadas precisam ser restauradas antes da edição.

Salvar a correção não envia e-mail automaticamente. “Reenviar ATA” usa a última versão salva e somente destinatários ativos e autorizados. O endpoint consulta a reunião com as permissões da sessão, inclusive para impedir que um administrador externo leia/envie atas de 1:1.

## Publicação e validação

Aplicar `20260928212742_tlu_meeting_rites.sql` antes de liberar a interface. A migração é transacional e adiciona tabelas/colunas sem remover registros existentes. Manter as variáveis de e-mail e Supabase já utilizadas pelo sistema.

Os testes `tlu-meetings-database.test.ts` executam as migrações reais no PostgreSQL embarcado e verificam permissões, revogação, atomicidade, privacidade de tarefas e revisão de atas. `meeting-rites.test.ts` cobre datas e conteúdo do registro. A verificação de interface utiliza uma base isolada, sem e-mails reais.
