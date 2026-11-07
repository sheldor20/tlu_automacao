-- Criação atômica sob RLS, inclusive quando o responsável é outro usuário.
begin;

create or replace function public.create_project_from_template(
  p_name text,
  p_owner_user_id uuid,
  p_start_date date,
  p_template_id uuid,
  p_category text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_id uuid := gen_random_uuid();
  creator_id uuid := auth.uid();
begin
  if public.can_create_project(p_category) is not true then
    raise exception using message = 'department_access_required';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 140 then
    raise exception using message = 'invalid_project_name';
  end if;
  if not exists (
    select 1 from public.profiles profile
    where profile.user_id = p_owner_user_id and profile.active and profile.email is not null
  ) then
    raise exception using message = 'profile_not_available';
  end if;
  if p_template_id is not null and not exists (
    select 1 from public.project_templates template
    where template.id = p_template_id and template.is_active
  ) then
    raise exception using message = 'project_template_not_available';
  end if;

  -- INSERT ... RETURNING exige a política SELECT antes do AFTER INSERT.
  -- Os helpers STABLE dessa política ainda não enxergam o novo projeto.
  -- Gere o id antes e deixe o trigger registrar o criador como envolvido.
  insert into public.projects (
    id, name, category, start_date, owner_user_id, owner_name, owner_email,
    objective, status, created_by
  ) values (
    created_id, btrim(p_name), p_category, coalesce(p_start_date, current_date), creator_id,
    'Responsável', 'responsavel@temp.invalid', 'A definir', 'ativo', creator_id
  );

  if p_owner_user_id <> creator_id then
    -- A próxima instrução já enxerga o projeto e o vínculo do criador.
    -- O mesmo trigger adiciona o responsável escolhido sem remover o criador.
    update public.projects set owner_user_id = p_owner_user_id where id = created_id;
    update public.project_members set role = 'Criador do projeto'
    where project_id = created_id and user_id = creator_id;
  end if;

  if p_template_id is not null then
    insert into public.project_tasks (
      project_id, category, title, description, assignee_user_id, assignee_name,
      assignee_email, due_date, status, position, created_by
    )
    select
      created_id, p_category, task.title, task.description,
      coalesce(task.assignee_user_id, p_owner_user_id), 'Responsável', 'responsavel@temp.invalid',
      coalesce(p_start_date, current_date) + task.due_offset_days,
      task.status, task.position, creator_id
    from public.project_template_tasks task
    where task.template_id = p_template_id
    order by task.position;
  end if;
  return created_id;
end;
$$;

-- Clientes antigos continuam usando o mesmo fluxo corrigido em Projetos.
create or replace function public.create_project_from_template(
  p_name text,
  p_owner_user_id uuid,
  p_start_date date,
  p_template_id uuid default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select public.create_project_from_template(p_name, p_owner_user_id, p_start_date, p_template_id, 'operational');
$$;

revoke all on function public.create_project_from_template(text, uuid, date, uuid, text) from public, anon;
revoke all on function public.create_project_from_template(text, uuid, date, uuid) from public, anon;
grant execute on function public.create_project_from_template(text, uuid, date, uuid, text) to authenticated;
grant execute on function public.create_project_from_template(text, uuid, date, uuid) to authenticated;

commit;
