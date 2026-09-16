begin;

-- Removing an individual agenda item also removes its generated task.
-- Whole-meeting/section deletion still preserves tasks: its parent section
-- no longer exists when this cascading item trigger runs.
create or replace function public.delete_ra_item_task()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  meeting_status public.ra_meeting_status;
begin
  select meeting.status into meeting_status
  from public.ra_agenda_sections section
  join public.ra_meetings meeting on meeting.id = section.meeting_id
  where section.id = old.section_id
  for share of meeting;

  if not found then
    return null;
  end if;
  if meeting_status = 'encerrada' then
    raise exception 'Não é possível excluir assuntos de uma RA encerrada.';
  end if;

  if old.task_id is not null then
    -- Keep the existing task permissions. A failed or denied deletion rolls
    -- back the item, its decisions and the task together.
    delete from public.project_tasks where id = old.task_id;
    if not found then
      raise exception 'Você não tem permissão para excluir a tarefa vinculada. O assunto foi mantido na RA.';
    end if;
  end if;
  return null;
end;
$$;

revoke all on function public.delete_ra_item_task() from public, anon, authenticated;

create trigger ra_items_delete_task_after_delete
after delete on public.ra_agenda_items
for each row execute function public.delete_ra_item_task();

-- Lock the source row before creating its task so conversion cannot leave an
-- orphan task when the same item is concurrently deleted or converted again.
create or replace function public.convert_ra_item_to_task(
  p_item_id uuid,
  p_assignee_user_id uuid,
  p_due_date date,
  p_project_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  item_row record;
  assignee_row record;
  created_task_id uuid;
begin
  select item.id, item.content, item.task_id, section.meeting_id, meeting.status
  into item_row
  from public.ra_agenda_items item
  join public.ra_agenda_sections section on section.id = item.section_id
  join public.ra_meetings meeting on meeting.id = section.meeting_id
  where item.id = p_item_id
  for update of item;
  if item_row.id is null or not public.can_manage_ra_meeting(item_row.meeting_id) then raise exception using message = 'ra_manage_required'; end if;
  if item_row.status = 'encerrada' then raise exception using message = 'ra_already_closed'; end if;
  if item_row.task_id is not null then return item_row.task_id; end if;
  if not exists (select 1 from public.ra_participants participant where participant.meeting_id = item_row.meeting_id and participant.user_id = p_assignee_user_id) then
    raise exception using message = 'ra_assignee_must_be_participant';
  end if;
  if p_project_id is not null and not exists (
    select 1 from public.ra_meeting_projects selected
    join public.projects project on project.id = selected.project_id
    where selected.meeting_id = item_row.meeting_id and selected.project_id = p_project_id and project.status = 'ativo' and project.archived_at is null
  ) then raise exception using message = 'ra_project_not_selected'; end if;
  select profile.full_name, profile.email into assignee_row from public.profiles profile
  where profile.user_id = p_assignee_user_id and profile.active;
  if assignee_row.email is null then raise exception using message = 'ra_assignee_not_available'; end if;
  insert into public.project_tasks (project_id, title, description, assignee_user_id, assignee_name, assignee_email, due_date, status, position, created_by)
  values (p_project_id, left(item_row.content, 220), 'Tarefa originada em reunião RA.', p_assignee_user_id, coalesce(assignee_row.full_name, assignee_row.email), assignee_row.email, p_due_date, 'a_fazer', 0, auth.uid())
  returning id into created_task_id;
  update public.ra_agenda_items set kind = 'acao', owner_user_id = p_assignee_user_id, due_date = p_due_date, project_id = p_project_id, task_id = created_task_id where id = p_item_id;
  return created_task_id;
end;
$$;

commit;
