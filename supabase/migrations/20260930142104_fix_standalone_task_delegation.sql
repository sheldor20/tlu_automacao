-- Restricted users can delegate standalone tasks in their allowed departments.
-- The author can follow their own standalone tasks without gaining full scope.
-- Project permissions and private 1:1 restrictions remain in force.

create or replace function public.save_project_task(
  p_task_id uuid,
  p_project_id uuid,
  p_category text,
  p_title text,
  p_description text,
  p_due_date date,
  p_status public.task_status,
  p_assignee_ids uuid[],
  p_subtasks jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_task_id uuid;
  primary_assignee record;
  subtask_item jsonb;
  saved_subtask_id uuid;
  supplied_subtask_id uuid;
  kept_subtask_ids uuid[] := '{}'::uuid[];
  subtask_assignee_ids uuid[];
  task_position integer;
begin
  if auth.uid() is null then
    raise exception using message = 'authentication_required';
  end if;
  if p_category is null or p_category not in ('operational', 'governance') then
    raise exception using message = 'invalid_project_category';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 2 and 220 then
    raise exception using message = 'invalid_task_title';
  end if;
  if p_due_date is null or coalesce(array_length(p_assignee_ids, 1), 0) = 0 then
    raise exception using message = 'task_assignee_required';
  end if;
  if jsonb_typeof(coalesce(p_subtasks, '[]'::jsonb)) <> 'array' then
    raise exception using message = 'invalid_subtasks';
  end if;

  if p_project_id is not null then
    select project.category into p_category
    from public.projects project
    where project.id = p_project_id;
    if not found or not public.has_project_full_access(p_project_id) then
      raise exception using message = 'project_access_required';
    end if;
  elsif not public.has_project_category_access(p_category) then
    raise exception using message = 'department_access_required';
  end if;

  if p_task_id is not null and not public.can_manage_project_task(p_task_id) then
    raise exception using message = 'task_access_required';
  end if;

  if exists (
    select 1 from unnest(p_assignee_ids) selected(user_id)
    left join public.profiles profile on profile.user_id = selected.user_id
    where profile.user_id is null or not profile.active or profile.email is null
  ) then
    raise exception using message = 'profile_not_available';
  end if;

  select profile.user_id,
    coalesce(nullif(btrim(profile.full_name), ''), split_part(profile.email, '@', 1)) as name,
    lower(profile.email) as email
  into primary_assignee
  from public.profiles profile
  where profile.user_id = p_assignee_ids[1];

  if p_task_id is null then
    select count(*)::integer into task_position
    from public.project_tasks task
    where task.category = p_category and task.status = p_status
      and task.project_id is not distinct from p_project_id;

    insert into public.project_tasks (
      project_id, category, title, description, assignee_user_id, assignee_name,
      assignee_email, due_date, status, position, created_by
    ) values (
      p_project_id, p_category, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
      primary_assignee.user_id, primary_assignee.name, primary_assignee.email,
      p_due_date, p_status, task_position, auth.uid()
    ) returning id into saved_task_id;
  else
    update public.project_tasks task
    set project_id = p_project_id,
        category = p_category,
        title = btrim(p_title),
        description = nullif(btrim(coalesce(p_description, '')), ''),
        assignee_user_id = primary_assignee.user_id,
        assignee_name = primary_assignee.name,
        assignee_email = primary_assignee.email,
        due_date = p_due_date,
        status = p_status
    where task.id = p_task_id
    returning task.id into saved_task_id;
    if saved_task_id is null then raise exception using message = 'task_not_available'; end if;
  end if;

  delete from public.user_notifications notification
  where notification.notification_type = 'task_assigned'
    and notification.entity_id = saved_task_id
    and not (notification.recipient_user_id = any(p_assignee_ids));
  delete from public.project_task_assignees assignee where assignee.task_id = saved_task_id;
  insert into public.project_task_assignees (task_id, user_id, assignee_name, assignee_email, created_by)
  select saved_task_id, profile.user_id,
    coalesce(nullif(btrim(profile.full_name), ''), split_part(profile.email, '@', 1)),
    lower(profile.email), auth.uid()
  from public.profiles profile
  where profile.user_id = any(p_assignee_ids);

  for subtask_item in select value from jsonb_array_elements(coalesce(p_subtasks, '[]'::jsonb))
  loop
    if char_length(btrim(coalesce(subtask_item ->> 'title', ''))) not between 1 and 220 then
      raise exception using message = 'invalid_subtask_title';
    end if;
    supplied_subtask_id := nullif(subtask_item ->> 'id', '')::uuid;
    if supplied_subtask_id is not null then
      update public.project_subtasks subtask
      set title = btrim(subtask_item ->> 'title'),
          position = coalesce((subtask_item ->> 'position')::integer, 0),
          completed_at = case when coalesce((subtask_item ->> 'completed')::boolean, false)
            then coalesce(subtask.completed_at, now()) else null end
      where subtask.id = supplied_subtask_id and subtask.task_id = saved_task_id
      returning subtask.id into saved_subtask_id;
      if saved_subtask_id is null then raise exception using message = 'subtask_not_available'; end if;
    else
      insert into public.project_subtasks (task_id, title, position, completed_at, created_by)
      values (
        saved_task_id, btrim(subtask_item ->> 'title'),
        coalesce((subtask_item ->> 'position')::integer, 0),
        case when coalesce((subtask_item ->> 'completed')::boolean, false) then now() else null end,
        auth.uid()
      ) returning id into saved_subtask_id;
    end if;
    kept_subtask_ids := array_append(kept_subtask_ids, saved_subtask_id);

    select coalesce(array_agg(value::uuid), '{}'::uuid[]) into subtask_assignee_ids
    from jsonb_array_elements_text(coalesce(subtask_item -> 'assignee_user_ids', '[]'::jsonb));
    if coalesce(array_length(subtask_assignee_ids, 1), 0) = 0 then
      raise exception using message = 'subtask_assignee_required';
    end if;
    if exists (
      select 1 from unnest(subtask_assignee_ids) selected(user_id)
      left join public.profiles profile on profile.user_id = selected.user_id
      where profile.user_id is null or not profile.active or profile.email is null
    ) then
      raise exception using message = 'profile_not_available';
    end if;
    delete from public.project_subtask_assignees assignee where assignee.subtask_id = saved_subtask_id;
    insert into public.project_subtask_assignees (subtask_id, user_id, assignee_name, assignee_email, created_by)
    select saved_subtask_id, profile.user_id,
      coalesce(nullif(btrim(profile.full_name), ''), split_part(profile.email, '@', 1)),
      lower(profile.email), auth.uid()
    from public.profiles profile
    where profile.active and profile.email is not null
      and profile.user_id = any(subtask_assignee_ids);
  end loop;

  delete from public.project_subtasks subtask
  where subtask.task_id = saved_task_id
    and not (subtask.id = any(kept_subtask_ids));

  return saved_task_id;
end;
$$;

revoke all on function public.save_project_task(uuid, uuid, text, text, text, date, public.task_status, uuid[], jsonb) from public;
grant execute on function public.save_project_task(uuid, uuid, text, text, text, date, public.task_status, uuid[], jsonb) to authenticated;

create or replace function public.can_read_project_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_tasks task
    where task.id = p_task_id
      and auth.uid() is not null
      and (task.private_meeting_leader_id is null or (public.has_department_access('pauta-ra') and auth.uid() in (task.private_meeting_leader_id,task.private_meeting_report_id)))
      and public.has_project_category_access(task.category)
      and (
        public.is_system_admin()
        or (task.project_id is null and task.created_by = auth.uid())
        or exists (
          select 1 from public.project_task_assignees assignee
          where assignee.task_id = task.id
            and (assignee.user_id = auth.uid() or public.is_direct_leader_of(assignee.user_id))
        )
        or exists (
          select 1
          from public.project_subtasks subtask
          join public.project_subtask_assignees assignee on assignee.subtask_id = subtask.id
          where subtask.task_id = task.id
            and (assignee.user_id = auth.uid() or public.is_direct_leader_of(assignee.user_id))
        )
        or (
          task.project_id is not null
          and public.project_permission_scope() = 'full'
          and public.user_is_involved_in_project(task.project_id, auth.uid())
        )
        or (
          task.project_id is null
          and public.project_permission_scope() = 'full'
        )
      )
  );
$$;

create or replace function public.can_manage_project_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_tasks task
    where task.id = p_task_id
      and auth.uid() is not null
      and (task.private_meeting_leader_id is null or (public.has_department_access('pauta-ra') and auth.uid() in (task.private_meeting_leader_id,task.private_meeting_report_id)))
      and public.has_project_category_access(task.category)
      and (
        public.is_system_admin()
        or (task.project_id is null and task.created_by = auth.uid())
        or (task.project_id is not null and public.has_project_full_access(task.project_id))
        or exists (
          select 1 from public.project_task_assignees assignee
          where assignee.task_id = task.id
            and (assignee.user_id = auth.uid() or public.is_direct_leader_of(assignee.user_id))
        )
        or exists (
          select 1
          from public.project_subtasks subtask
          join public.project_subtask_assignees assignee on assignee.subtask_id = subtask.id
          where subtask.task_id = task.id
            and (assignee.user_id = auth.uid() or public.is_direct_leader_of(assignee.user_id))
        )
      )
  );
$$;

-- These helpers and the save endpoint are only used by signed-in users.
revoke all on function public.save_project_task(uuid, uuid, text, text, text, date, public.task_status, uuid[], jsonb) from anon;
revoke all on function public.can_read_project_task(uuid), public.can_manage_project_task(uuid) from public, anon;
grant execute on function public.can_read_project_task(uuid), public.can_manage_project_task(uuid) to authenticated;
