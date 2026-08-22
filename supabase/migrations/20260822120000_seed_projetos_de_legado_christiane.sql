-- Portfólio "Projetos de legado" importado do PDF de 21/08/2026.
-- Execute depois de 20260822020000_archive_delete_processes_ra.sql.
-- No SQL Editor do Supabase, selecione a role `postgres`.
--
-- Mapeamento adotado:
--   - cada página PROJETO 01 a PROJETO 09 vira um projeto;
--   - cada entregável vira uma tarefa do respectivo projeto;
--   - o manifesto da capa fica registrado como comentário do Projeto 01;
--   - como o documento não informa datas, o início é a data da execução e
--     os prazos iniciais são distribuídos em intervalos de 30 dias;
--   - Christiane é owner e responsável inicial por todas as tarefas.
--
-- IDs fixos tornam esta carga idempotente. Uma nova execução atualiza textos,
-- owner e responsáveis, sem apagar o andamento, a conclusão ou prazos que já
-- tenham sido ajustados no sistema.

begin;

do $$
declare
  v_owner_email constant text := 'christiane@terralotusurbanismo.com.br';
  v_owner_user_id uuid;
  v_owner_name text;
  v_owner_count integer;
  v_start_date date := current_date;
  v_project_rows integer;
  v_task_rows integer;
begin
  if current_user <> 'postgres' and not pg_has_role(current_user, 'postgres', 'member') then
    raise exception using
      errcode = '42501',
      message = 'seed_requires_postgres_role',
      hint = 'No SQL Editor do Supabase, altere Role de authenticated para postgres e execute novamente.';
  end if;

  select count(*)
  into v_owner_count
  from public.profiles profile
  where lower(btrim(profile.email)) = v_owner_email
    and profile.active;

  if v_owner_count = 0 then
    raise exception using
      message = 'owner_profile_not_found',
      detail = format('Nenhum perfil ativo foi encontrado para %s.', v_owner_email),
      hint = 'Crie ou ative a usuária Christiane no Supabase Auth antes de executar esta carga.';
  elsif v_owner_count > 1 then
    raise exception using
      message = 'owner_profile_ambiguous',
      detail = format('Mais de um perfil ativo usa o e-mail %s.', v_owner_email),
      hint = 'Corrija a duplicidade de perfis antes de executar esta carga.';
  end if;

  select
    profile.user_id,
    coalesce(nullif(btrim(profile.full_name), ''), 'Christiane')
  into v_owner_user_id, v_owner_name
  from public.profiles profile
  where lower(btrim(profile.email)) = v_owner_email
    and profile.active;

  -- Garante que a owner consiga abrir os projetos. Permissões existentes mais
  -- restritas são preservadas; somente registros ausentes são criados.
  insert into public.profile_departments (user_id, department_slug, access_level)
  values (v_owner_user_id, 'projetos', 'member')
  on conflict (user_id, department_slug) do nothing;

  insert into public.profile_project_permissions (
    user_id, access_scope, allow_files, allow_updates
  ) values (
    v_owner_user_id, 'full', true, true
  )
  on conflict (user_id) do nothing;

  insert into public.projects (
    id, name, start_date, end_date, owner_user_id, owner_name, owner_email,
    objective, status, created_by
  ) values
    (
      '81000000-0000-4000-8000-000000000001',
      'Sistema Terra Lótus e Governança Corporativa',
      v_start_date, null, v_owner_user_id, v_owner_name, v_owner_email,
      'Desenhar e consolidar o modelo de funcionamento da empresa, estabelecendo uma base única de governança, processos, cultura, liderança e gestão que sustente o crescimento da organização pelos próximos anos. Escopo: modelo de governança com indicadores, rituais e gestão de projetos; papéis e responsabilidades, sistema de atribuições e modelo Spotify de gestão; cultura. Governança corporativa: definir a estrutura decisória da empresa. Referências: Lean Startup e Measure What Matters.',
      'planejamento', v_owner_user_id
    ),
    (
      '81000000-0000-4000-8000-000000000002',
      'Cultura Terra Lótus',
      v_start_date, null, v_owner_user_id, v_owner_name, v_owner_email,
      'Fortalecer uma cultura organizacional clara, consistente e vivida no dia a dia. Os artefatos de cultura previstos no Projeto 01 antecedem e orientam estes entregáveis.',
      'planejamento', v_owner_user_id
    ),
    (
      '81000000-0000-4000-8000-000000000003',
      'Mapeamento e Padronização de Processos',
      v_start_date, null, v_owner_user_id, v_owner_name, v_owner_email,
      'Documentar e melhorar todos os processos críticos via BPMN e VSM.',
      'planejamento', v_owner_user_id
    ),
    (
      '81000000-0000-4000-8000-000000000004',
      'Desenvolvimento de Lideranças e Universidade Terra Lótus',
      v_start_date, null, v_owner_user_id, v_owner_name, v_owner_email,
      'Projeto em andamento com Michelle. Construir líderes preparados para sustentar o crescimento da empresa e criar um sistema permanente de aprendizagem por meio da Universidade Terra Lótus e de um PDI geral.',
      'ativo', v_owner_user_id
    ),
    (
      '81000000-0000-4000-8000-000000000005',
      'PMO - Terra Lótus Space',
      v_start_date, null, v_owner_user_id, v_owner_name, v_owner_email,
      'Organizar a gestão dos projetos estratégicos da empresa. Referência do documento: PMO Terra Lótus Space, Dra. Christiane e Kim.',
      'planejamento', v_owner_user_id
    ),
    (
      '81000000-0000-4000-8000-000000000006',
      'Planejamento Estratégico',
      v_start_date, null, v_owner_user_id, v_owner_name, v_owner_email,
      'Institucionalizar o processo anual de planejamento da empresa.',
      'planejamento', v_owner_user_id
    ),
    (
      '81000000-0000-4000-8000-000000000007',
      'Núcleo de Inovação',
      v_start_date, null, v_owner_user_id, v_owner_name, v_owner_email,
      'Criar uma cultura permanente de melhoria e inovação, fazer gemba e desenvolver novos modelos de negócios e novas fontes de receita, incluindo FRVO e cannabis.',
      'planejamento', v_owner_user_id
    ),
    (
      '81000000-0000-4000-8000-000000000008',
      'Sucessão e Continuidade',
      v_start_date, null, v_owner_user_id, v_owner_name, v_owner_email,
      'Garantir que a empresa esteja preparada para crescer independentemente das pessoas que ocupam as posições atuais.',
      'planejamento', v_owner_user_id
    ),
    (
      '81000000-0000-4000-8000-000000000009',
      'ESG e Sustentabilidade',
      v_start_date, null, v_owner_user_id, v_owner_name, v_owner_email,
      'Integrar responsabilidade ambiental, social e governança ao modelo de gestão.',
      'planejamento', v_owner_user_id
    )
  on conflict (id) do update set
    name = excluded.name,
    owner_user_id = excluded.owner_user_id,
    owner_name = excluded.owner_name,
    owner_email = excluded.owner_email,
    objective = excluded.objective,
    updated_at = now();

  get diagnostics v_project_rows = row_count;
  if v_project_rows <> 9 then
    raise exception 'project_seed_count_mismatch: esperado 9, processado %', v_project_rows;
  end if;

  insert into public.project_tasks (
    id, project_id, title, description, assignee_user_id, assignee_name,
    assignee_email, due_date, status, position, created_by
  ) values
    -- Projeto 01 - Governança corporativa
    ('82000000-0001-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'Organograma', 'Entregável de Governança Corporativa.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 30, 'a_fazer', 0, v_owner_user_id),
    ('82000000-0001-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', 'Papéis executivos', 'Entregável de Governança Corporativa.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 60, 'a_fazer', 1, v_owner_user_id),
    ('82000000-0001-4000-8000-000000000003', '81000000-0000-4000-8000-000000000001', 'Cadeia de decisão', 'Entregável de Governança Corporativa.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 90, 'a_fazer', 2, v_owner_user_id),
    ('82000000-0001-4000-8000-000000000004', '81000000-0000-4000-8000-000000000001', 'Matriz RACI', 'Entregável de Governança Corporativa.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 120, 'a_fazer', 3, v_owner_user_id),
    ('82000000-0001-4000-8000-000000000005', '81000000-0000-4000-8000-000000000001', 'Alçadas', 'Entregável de Governança Corporativa.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 150, 'a_fazer', 4, v_owner_user_id),
    ('82000000-0001-4000-8000-000000000006', '81000000-0000-4000-8000-000000000001', 'Comitês', 'Entregável de Governança Corporativa.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 180, 'a_fazer', 5, v_owner_user_id),
    ('82000000-0001-4000-8000-000000000007', '81000000-0000-4000-8000-000000000001', 'Modelo de governança', 'Consolidar indicadores, rituais, gestão de projetos, papéis e responsabilidades.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 210, 'a_fazer', 6, v_owner_user_id),
    ('82000000-0001-4000-8000-000000000008', '81000000-0000-4000-8000-000000000001', 'Artefatos de cultura TLU, modelo de trabalho e indicadores aplicados', 'Entregável final do Projeto 01.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 240, 'a_fazer', 7, v_owner_user_id),

    -- Projeto 02 - Cultura Terra Lótus
    ('82000000-0002-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', 'Manifesto', 'Entregável de Cultura Terra Lótus.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 30, 'a_fazer', 0, v_owner_user_id),
    ('82000000-0002-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', 'Missão', 'Entregável de Cultura Terra Lótus.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 60, 'a_fazer', 1, v_owner_user_id),
    ('82000000-0002-4000-8000-000000000003', '81000000-0000-4000-8000-000000000002', 'Visão', 'Entregável de Cultura Terra Lótus.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 90, 'a_fazer', 2, v_owner_user_id),
    ('82000000-0002-4000-8000-000000000004', '81000000-0000-4000-8000-000000000002', 'Valores', 'Entregável de Cultura Terra Lótus.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 120, 'a_fazer', 3, v_owner_user_id),
    ('82000000-0002-4000-8000-000000000005', '81000000-0000-4000-8000-000000000002', 'Rituais', 'Entregável de Cultura Terra Lótus.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 150, 'a_fazer', 4, v_owner_user_id),
    ('82000000-0002-4000-8000-000000000006', '81000000-0000-4000-8000-000000000002', 'Comunicação interna', 'Entregável de Cultura Terra Lótus.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 180, 'a_fazer', 5, v_owner_user_id),
    ('82000000-0002-4000-8000-000000000007', '81000000-0000-4000-8000-000000000002', 'Reconhecimento', 'Entregável de Cultura Terra Lótus.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 210, 'a_fazer', 6, v_owner_user_id),

    -- Projeto 03 - Mapeamento e padronização de processos
    ('82000000-0003-4000-8000-000000000001', '81000000-0000-4000-8000-000000000003', 'Aumento mensurável da produtividade do time via VSM', 'Mapear, documentar e melhorar processos críticos com BPMN e VSM.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 30, 'a_fazer', 0, v_owner_user_id),

    -- Projeto 04 - Desenvolvimento de lideranças e Universidade Terra Lótus
    ('82000000-0004-4000-8000-000000000001', '81000000-0000-4000-8000-000000000004', 'PDI das lideranças', 'Frente Desenvolvimento de Lideranças.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 30, 'a_fazer', 0, v_owner_user_id),
    ('82000000-0004-4000-8000-000000000002', '81000000-0000-4000-8000-000000000004', 'Follow-up do programa de mentoria', 'Frente Desenvolvimento de Lideranças.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 60, 'a_fazer', 1, v_owner_user_id),
    ('82000000-0004-4000-8000-000000000003', '81000000-0000-4000-8000-000000000004', 'Avaliações', 'Frente Desenvolvimento de Lideranças.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 90, 'a_fazer', 2, v_owner_user_id),
    ('82000000-0004-4000-8000-000000000004', '81000000-0000-4000-8000-000000000004', 'Feedbacks', 'Frente Desenvolvimento de Lideranças.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 120, 'a_fazer', 3, v_owner_user_id),
    ('82000000-0004-4000-8000-000000000005', '81000000-0000-4000-8000-000000000004', 'Academia de líderes', 'Frente Desenvolvimento de Lideranças.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 150, 'a_fazer', 4, v_owner_user_id),
    ('82000000-0004-4000-8000-000000000006', '81000000-0000-4000-8000-000000000004', 'Onboarding', 'Frente Universidade Terra Lótus.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 180, 'a_fazer', 5, v_owner_user_id),
    ('82000000-0004-4000-8000-000000000007', '81000000-0000-4000-8000-000000000004', 'Biblioteca', 'Frente Universidade Terra Lótus.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 210, 'a_fazer', 6, v_owner_user_id),
    ('82000000-0004-4000-8000-000000000008', '81000000-0000-4000-8000-000000000004', 'Trilhas de desenvolvimento', 'Frente Universidade Terra Lótus.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 240, 'a_fazer', 7, v_owner_user_id),
    ('82000000-0004-4000-8000-000000000009', '81000000-0000-4000-8000-000000000004', 'Formação de gestores', 'Frente Universidade Terra Lótus.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 270, 'a_fazer', 8, v_owner_user_id),
    ('82000000-0004-4000-8000-000000000010', '81000000-0000-4000-8000-000000000004', 'Capacitações internas', 'Frente Universidade Terra Lótus.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 300, 'a_fazer', 9, v_owner_user_id),

    -- Projeto 05 - PMO Terra Lótus Space
    ('82000000-0005-4000-8000-000000000001', '81000000-0000-4000-8000-000000000005', 'Priorização', 'Entregável do PMO.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 30, 'a_fazer', 0, v_owner_user_id),
    ('82000000-0005-4000-8000-000000000002', '81000000-0000-4000-8000-000000000005', 'Cronogramas', 'Entregável do PMO.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 60, 'a_fazer', 1, v_owner_user_id),
    ('82000000-0005-4000-8000-000000000003', '81000000-0000-4000-8000-000000000005', 'Gestão de riscos', 'Entregável do PMO.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 90, 'a_fazer', 2, v_owner_user_id),
    ('82000000-0005-4000-8000-000000000004', '81000000-0000-4000-8000-000000000005', 'Status reports', 'Entregável do PMO.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 120, 'a_fazer', 3, v_owner_user_id),
    ('82000000-0005-4000-8000-000000000005', '81000000-0000-4000-8000-000000000005', 'Governança dos projetos', 'Entregável do PMO.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 150, 'a_fazer', 4, v_owner_user_id),

    -- Projeto 06 - Planejamento estratégico
    ('82000000-0006-4000-8000-000000000001', '81000000-0000-4000-8000-000000000006', 'Objetivos estratégicos', 'Entregável do planejamento estratégico anual.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 30, 'a_fazer', 0, v_owner_user_id),
    ('82000000-0006-4000-8000-000000000002', '81000000-0000-4000-8000-000000000006', 'OKRs', 'Entregável do planejamento estratégico anual.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 60, 'a_fazer', 1, v_owner_user_id),
    ('82000000-0006-4000-8000-000000000003', '81000000-0000-4000-8000-000000000006', 'Plano anual', 'Entregável do planejamento estratégico anual.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 90, 'a_fazer', 2, v_owner_user_id),
    ('82000000-0006-4000-8000-000000000004', '81000000-0000-4000-8000-000000000006', 'Revisões trimestrais', 'Entregável do planejamento estratégico anual.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 120, 'a_fazer', 3, v_owner_user_id),
    ('82000000-0006-4000-8000-000000000005', '81000000-0000-4000-8000-000000000006', 'Priorização de projetos', 'Entregável do planejamento estratégico anual.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 150, 'a_fazer', 4, v_owner_user_id),

    -- Projeto 07 - Núcleo de inovação
    ('82000000-0007-4000-8000-000000000001', '81000000-0000-4000-8000-000000000007', 'IA', 'Entregável do Núcleo de Inovação.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 30, 'a_fazer', 0, v_owner_user_id),
    ('82000000-0007-4000-8000-000000000002', '81000000-0000-4000-8000-000000000007', 'Automações', 'Entregável do Núcleo de Inovação.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 60, 'a_fazer', 1, v_owner_user_id),
    ('82000000-0007-4000-8000-000000000003', '81000000-0000-4000-8000-000000000007', 'Caixinha de ideias no Terra Lótus Space', 'Criar um botão para envio de ideias de melhoria do sistema.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 90, 'a_fazer', 2, v_owner_user_id),
    ('82000000-0007-4000-8000-000000000004', '81000000-0000-4000-8000-000000000007', 'Benchmarking', 'Entregável do Núcleo de Inovação.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 120, 'a_fazer', 3, v_owner_user_id),
    ('82000000-0007-4000-8000-000000000005', '81000000-0000-4000-8000-000000000007', 'Gestão da inovação', 'Entregável do Núcleo de Inovação.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 150, 'a_fazer', 4, v_owner_user_id),
    ('82000000-0007-4000-8000-000000000006', '81000000-0000-4000-8000-000000000007', 'Realizar 3 gembas por ano', 'Institucionalizar três ciclos de gemba por ano.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 180, 'a_fazer', 5, v_owner_user_id),

    -- Projeto 08 - Sucessão e continuidade
    ('82000000-0008-4000-8000-000000000001', '81000000-0000-4000-8000-000000000008', 'Plano de sucessão', 'Entregável de Sucessão e Continuidade.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 30, 'a_fazer', 0, v_owner_user_id),
    ('82000000-0008-4000-8000-000000000002', '81000000-0000-4000-8000-000000000008', 'Mapeamento de talentos', 'Entregável de Sucessão e Continuidade.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 60, 'a_fazer', 1, v_owner_user_id),
    ('82000000-0008-4000-8000-000000000003', '81000000-0000-4000-8000-000000000008', 'Desenvolvimento de novas lideranças', 'Entregável de Sucessão e Continuidade.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 90, 'a_fazer', 2, v_owner_user_id),
    ('82000000-0008-4000-8000-000000000004', '81000000-0000-4000-8000-000000000008', 'Continuidade do negócio', 'Entregável de Sucessão e Continuidade.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 120, 'a_fazer', 3, v_owner_user_id),

    -- Projeto 09 - ESG e sustentabilidade
    ('82000000-0009-4000-8000-000000000001', '81000000-0000-4000-8000-000000000009', 'Política ESG', 'Entregável de ESG e Sustentabilidade.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 30, 'a_fazer', 0, v_owner_user_id),
    ('82000000-0009-4000-8000-000000000002', '81000000-0000-4000-8000-000000000009', 'Indicadores', 'Entregável de ESG e Sustentabilidade.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 60, 'a_fazer', 1, v_owner_user_id),
    ('82000000-0009-4000-8000-000000000003', '81000000-0000-4000-8000-000000000009', 'Projetos sociais', 'Entregável de ESG e Sustentabilidade.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 90, 'a_fazer', 2, v_owner_user_id),
    ('82000000-0009-4000-8000-000000000004', '81000000-0000-4000-8000-000000000009', 'Sustentabilidade', 'Entregável de ESG e Sustentabilidade.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 120, 'a_fazer', 3, v_owner_user_id),
    ('82000000-0009-4000-8000-000000000005', '81000000-0000-4000-8000-000000000009', 'Relatórios', 'Entregável de ESG e Sustentabilidade.', v_owner_user_id, v_owner_name, v_owner_email, v_start_date + 150, 'a_fazer', 4, v_owner_user_id)
  on conflict (id) do update set
    project_id = excluded.project_id,
    title = excluded.title,
    description = excluded.description,
    assignee_user_id = excluded.assignee_user_id,
    assignee_name = excluded.assignee_name,
    assignee_email = excluded.assignee_email,
    position = excluded.position,
    updated_at = now();

  get diagnostics v_task_rows = row_count;
  if v_task_rows <> 51 then
    raise exception 'task_seed_count_mismatch: esperado 51, processado %', v_task_rows;
  end if;

  -- A capa é contexto do portfólio, não um décimo projeto.
  insert into public.project_comments (
    id, project_id, body, author_name, created_by
  ) values (
    '83000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    'Projetos de legado: meu objetivo não é apenas desenvolver competências executivas. É deixar uma empresa melhor do que encontrei. Cada aprendizado adquirido deverá ser convertido em uma melhoria concreta para a Terra Lótus, fortalecendo sua governança, sua cultura, sua eficiência operacional e sua capacidade de crescer de forma sustentável. Meu legado será medido não pelos cursos que concluí, mas pelos sistemas que ajudei a construir, pelas lideranças que desenvolvi e pela organização que deixarei para as próximas gerações.',
    'Documento de origem',
    v_owner_user_id
  )
  on conflict (id) do update set
    project_id = excluded.project_id,
    body = excluded.body,
    author_name = excluded.author_name,
    updated_at = now();

  -- A carga em lote não deve gerar alertas artificiais para a própria
  -- Christiane. Somente notificações ligadas aos IDs desta carga são removidas.
  delete from public.user_notifications notification
  where notification.notification_type = 'task_assigned'
    and notification.recipient_user_id = v_owner_user_id
    and notification.entity_id in (
      select task.id
      from public.project_tasks task
      where task.project_id in (
        '81000000-0000-4000-8000-000000000001',
        '81000000-0000-4000-8000-000000000002',
        '81000000-0000-4000-8000-000000000003',
        '81000000-0000-4000-8000-000000000004',
        '81000000-0000-4000-8000-000000000005',
        '81000000-0000-4000-8000-000000000006',
        '81000000-0000-4000-8000-000000000007',
        '81000000-0000-4000-8000-000000000008',
        '81000000-0000-4000-8000-000000000009'
      )
      and task.id::text like '82000000-%'
    );

  raise notice 'Carga concluída: 9 projetos e 51 tarefas vinculados a % (%).',
    v_owner_name, v_owner_email;
end;
$$;

commit;
