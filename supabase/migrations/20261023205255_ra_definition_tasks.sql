alter table public.ra_decisions add column task_id uuid references public.project_tasks(id) on delete set null;
create or replace function public.convert_ra_decision_to_task(
  p_decision_id uuid,
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
  select item.id, item.decision_text as content, item.task_id, section.meeting_id, meeting.status, meeting.meeting_type, meeting.leader_user_id, meeting.report_user_id
  into item_row
  from public.ra_decisions item
  join public.ra_agenda_items agenda on agenda.id = item.item_id
  join public.ra_agenda_sections section on section.id = agenda.section_id
  join public.ra_meetings meeting on meeting.id = section.meeting_id
  where item.id = p_decision_id
  for update of item;
  if auth.uid() is null or item_row.id is null or not public.can_manage_ra_meeting(item_row.meeting_id) then raise exception using message = 'ra_manage_required'; end if;
  if p_due_date is null then raise exception 'Prazo obrigatório'; end if;
  if exists (select 1 from public.ra_meetings where id = item_row.meeting_id and archived_at is not null) then raise exception 'Reunião arquivada'; end if;
  if item_row.status = 'encerrada' then raise exception using message = 'ra_already_closed'; end if;
  if item_row.meeting_type = '1:1' and p_project_id is not null then raise exception 'Uma tarefa de 1:1 não pode ser vinculada a projeto compartilhado.'; end if;
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
  insert into public.project_tasks (project_id, title, description, assignee_user_id, assignee_name, assignee_email, due_date, status, position, created_by, private_meeting_leader_id, private_meeting_report_id)
  values (p_project_id, left(item_row.content, 220), 'Tarefa originada em reunião ' || item_row.meeting_type || '.', p_assignee_user_id, coalesce(assignee_row.full_name, assignee_row.email), assignee_row.email, p_due_date, 'a_fazer', 0, auth.uid(), case when item_row.meeting_type = '1:1' then item_row.leader_user_id end, case when item_row.meeting_type = '1:1' then item_row.report_user_id end)
  returning id into created_task_id;
  update public.ra_decisions set task_id = created_task_id where id = p_decision_id;
  return created_task_id;
end;
$$;

revoke all on function public.convert_ra_decision_to_task(uuid,uuid,date,uuid) from public, anon;
grant execute on function public.convert_ra_decision_to_task(uuid,uuid,date,uuid) to authenticated;
