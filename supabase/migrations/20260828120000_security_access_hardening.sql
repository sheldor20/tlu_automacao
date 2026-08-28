-- Reforça revogação de acesso e separa leitura de liderança de escrita operacional.

begin;

-- A remoção do departamento deve revogar imediatamente qualquer escrita em RA,
-- inclusive quando o usuário ainda consta como líder da reunião.
create or replace function public.can_manage_ra()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_department_access('pauta-ra')
    and (public.is_system_admin() or public.is_team_leader());
$$;

create or replace function public.can_administer_ra_meeting(p_meeting_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_department_access('pauta-ra') and (
    public.is_system_admin()
    or exists (
      select 1
      from public.ra_meetings meeting
      where meeting.id = p_meeting_id
        and meeting.leader_user_id = auth.uid()
    )
  );
$$;

create or replace function public.can_manage_ra_meeting(p_meeting_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.can_administer_ra_meeting(p_meeting_id) and exists (
    select 1
    from public.ra_meetings meeting
    where meeting.id = p_meeting_id
      and meeting.archived_at is null
  );
$$;

revoke all on function public.can_manage_ra(), public.can_administer_ra_meeting(uuid), public.can_manage_ra_meeting(uuid) from public;
grant execute on function public.can_manage_ra(), public.can_administer_ra_meeting(uuid), public.can_manage_ra_meeting(uuid) to authenticated;

-- A liderança direta continua podendo visualizar tarefas do liderado, mas não
-- pode alterá-las nem excluí-las sem também ter gestão completa do projeto.
drop policy if exists project_tasks_update on public.project_tasks;
drop policy if exists project_tasks_delete on public.project_tasks;

create policy project_tasks_update on public.project_tasks for update to authenticated
using (
  public.has_department_access('projetos') and (
    public.is_system_admin()
    or assignee_user_id = auth.uid()
    or (project_id is not null and public.has_project_full_access(project_id))
  )
)
with check (
  public.has_department_access('projetos') and (
    public.is_system_admin()
    or assignee_user_id = auth.uid()
    or (project_id is not null and public.has_project_full_access(project_id))
  )
);

create policy project_tasks_delete on public.project_tasks for delete to authenticated
using (
  public.has_department_access('projetos') and (
    public.is_system_admin()
    or assignee_user_id = auth.uid()
    or (project_id is not null and public.has_project_full_access(project_id))
  )
);

-- O histórico de envios contém endereços de e-mail e fica restrito aos gestores
-- do projeto. Usuários comuns não podem fabricar, editar ou excluir auditoria.
drop policy if exists email_dispatches_department_access on public.email_dispatches;
drop policy if exists email_dispatches_read on public.email_dispatches;
drop policy if exists email_dispatches_insert on public.email_dispatches;

create policy email_dispatches_read on public.email_dispatches for select to authenticated
using (public.has_project_full_access(project_id));

create policy email_dispatches_insert on public.email_dispatches for insert to authenticated
with check (
  sent_by = auth.uid()
  and public.has_project_full_access(project_id)
);

commit;
