-- Governança, múltiplos responsáveis e subtarefas de projetos.

begin;

insert into public.departments (slug, name, position)
values ('governanca', 'Governança', 4)
on conflict (slug) do update set name = excluded.name, position = excluded.position;

alter table public.profiles
  add column if not exists deleted_at timestamptz;

alter table public.projects
  add column if not exists category text not null default 'operational';

alter table public.projects
  drop constraint if exists projects_category_valid;
alter table public.projects
  add constraint projects_category_valid
  check (category in ('operational', 'governance'));

alter table public.project_tasks
  add column if not exists category text not null default 'operational';

alter table public.project_tasks
  drop constraint if exists project_tasks_category_valid;
alter table public.project_tasks
  add constraint project_tasks_category_valid
  check (category in ('operational', 'governance'));

update public.project_tasks task
set category = project.category
from public.projects project
where project.id = task.project_id
  and task.category is distinct from project.category;

create index if not exists projects_category_updated_idx
  on public.projects(category, archived_at, updated_at desc);
create index if not exists project_tasks_category_board_idx
  on public.project_tasks(category, status, position, due_date);

create table if not exists public.project_task_assignees (
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  assignee_name text not null check (char_length(btrim(assignee_name)) between 2 and 140),
  assignee_email text not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index if not exists project_task_assignees_user_idx
  on public.project_task_assignees(user_id, task_id);

create table if not exists public.project_subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 220),
  position integer not null default 0,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_subtasks_task_position_idx
  on public.project_subtasks(task_id, position);

create table if not exists public.project_subtask_assignees (
  subtask_id uuid not null references public.project_subtasks(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  assignee_name text not null check (char_length(btrim(assignee_name)) between 2 and 140),
  assignee_email text not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (subtask_id, user_id)
);

create index if not exists project_subtask_assignees_user_idx
  on public.project_subtask_assignees(user_id, subtask_id);

create trigger set_project_subtasks_updated_at
before update on public.project_subtasks
for each row execute function public.set_updated_at();

create or replace function public.sync_task_category_from_project()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.project_id is not null then
    select project.category into new.category
    from public.projects project
    where project.id = new.project_id;
    if not found then
      raise exception using message = 'project_not_available';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_task_category_before_write on public.project_tasks;
create trigger sync_task_category_before_write
before insert or update of project_id, category on public.project_tasks
for each row execute function public.sync_task_category_from_project();

create or replace function public.sync_project_assignee_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select
    coalesce(nullif(btrim(profile.full_name), ''), split_part(profile.email, '@', 1)),
    lower(profile.email)
  into new.assignee_name, new.assignee_email
  from public.profiles profile
  where profile.user_id = new.user_id
    and profile.active
    and profile.email is not null;

  if not found then
    raise exception using message = 'profile_not_available';
  end if;
  return new;
end;
$$;

drop trigger if exists sync_project_task_assignee_before_write on public.project_task_assignees;
create trigger sync_project_task_assignee_before_write
before insert or update of user_id, assignee_name, assignee_email on public.project_task_assignees
for each row execute function public.sync_project_assignee_profile();

drop trigger if exists sync_project_subtask_assignee_before_write on public.project_subtask_assignees;
create trigger sync_project_subtask_assignee_before_write
before insert or update of user_id, assignee_name, assignee_email on public.project_subtask_assignees
for each row execute function public.sync_project_assignee_profile();

insert into public.project_task_assignees (
  task_id, user_id, assignee_name, assignee_email, created_by, created_at
)
select
  task.id, task.assignee_user_id, task.assignee_name, task.assignee_email,
  task.created_by, task.created_at
from public.project_tasks task
where task.assignee_user_id is not null
on conflict (task_id, user_id) do nothing;

create or replace function public.sync_inserted_task_assignee_relation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee_user_id is not null then
    insert into public.project_task_assignees (
      task_id, user_id, assignee_name, assignee_email, created_by, created_at
    ) values (
      new.id, new.assignee_user_id, new.assignee_name, new.assignee_email,
      new.created_by, new.created_at
    ) on conflict (task_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_inserted_task_assignee_relation_after_insert on public.project_tasks;
create trigger sync_inserted_task_assignee_relation_after_insert
after insert on public.project_tasks
for each row execute function public.sync_inserted_task_assignee_relation();

create or replace function public.has_project_category_access(p_category text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_category
    when 'governance' then public.has_department_access('governanca')
    else public.has_department_access('projetos')
  end;
$$;

create or replace function public.project_category(p_project_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select project.category from public.projects project where project.id = p_project_id;
$$;

create or replace function public.user_is_involved_in_project(p_project_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects project
    where project.id = p_project_id and project.owner_user_id = p_user_id
  ) or exists (
    select 1 from public.project_members member
    where member.project_id = p_project_id and member.user_id = p_user_id
  ) or exists (
    select 1
    from public.project_tasks task
    join public.project_task_assignees assignee on assignee.task_id = task.id
    where task.project_id = p_project_id and assignee.user_id = p_user_id
  ) or exists (
    select 1
    from public.project_tasks task
    join public.project_subtasks subtask on subtask.task_id = task.id
    join public.project_subtask_assignees assignee on assignee.subtask_id = subtask.id
    where task.project_id = p_project_id and assignee.user_id = p_user_id
  );
$$;

create or replace function public.has_project_access(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_project_category_access(public.project_category(p_project_id)) and (
    public.is_system_admin()
    or public.user_is_involved_in_project(p_project_id, auth.uid())
    or exists (
      select 1
      from public.profile_reporting_lines line
      where line.leader_user_id = auth.uid()
        and public.user_is_involved_in_project(p_project_id, line.report_user_id)
    )
  );
$$;

create or replace function public.has_project_full_access(p_project_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_project_id is not null
    and public.has_project_category_access(public.project_category(p_project_id))
    and (
      public.is_system_admin()
      or (
        public.project_permission_scope() = 'full'
        and public.user_is_involved_in_project(p_project_id, auth.uid())
      )
    );
$$;

create or replace function public.can_create_project(p_category text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_category in ('operational', 'governance')
    and public.has_project_category_access(p_category)
    and (public.is_system_admin() or public.project_permission_scope() = 'full');
$$;

create or replace function public.move_project_to_category(
  p_project_id uuid,
  p_category text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_category text;
begin
  if p_category not in ('operational', 'governance') then
    raise exception using message = 'invalid_project_category';
  end if;

  select project.category into current_category
  from public.projects project
  where project.id = p_project_id;

  if current_category is null then
    raise exception using message = 'project_not_available';
  end if;
  if current_category = p_category then
    return current_category;
  end if;
  if not public.has_project_full_access(p_project_id) then
    raise exception using message = 'project_move_access_required';
  end if;
  if not public.can_create_project(p_category) then
    raise exception using message = 'project_target_access_required';
  end if;

  update public.projects
  set category = p_category
  where id = p_project_id;

  update public.project_tasks
  set category = p_category
  where project_id = p_project_id;

  return p_category;
end;
$$;

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
      and public.has_project_category_access(task.category)
      and (
        public.is_system_admin()
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
      and public.has_project_category_access(task.category)
      and (
        public.is_system_admin()
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

revoke all on function public.has_project_category_access(text) from public;
revoke all on function public.project_category(uuid) from public;
revoke all on function public.can_create_project(text) from public;
revoke all on function public.move_project_to_category(uuid, text) from public;
revoke all on function public.can_read_project_task(uuid) from public;
revoke all on function public.can_manage_project_task(uuid) from public;
grant execute on function public.has_project_category_access(text), public.project_category(uuid),
  public.can_create_project(text), public.move_project_to_category(uuid, text),
  public.can_read_project_task(uuid),
  public.can_manage_project_task(uuid) to authenticated;

drop policy if exists project_templates_department_access on public.project_templates;
create policy project_templates_department_access on public.project_templates
for select to authenticated using (
  public.has_department_access('projetos') or public.has_department_access('governanca')
);

drop policy if exists project_template_tasks_department_access on public.project_template_tasks;
create policy project_template_tasks_department_access on public.project_template_tasks
for select to authenticated using (
  public.has_department_access('projetos') or public.has_department_access('governanca')
);

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects for insert to authenticated
with check (public.can_create_project(category));

drop policy if exists project_tasks_read on public.project_tasks;
drop policy if exists project_tasks_insert on public.project_tasks;
drop policy if exists project_tasks_update on public.project_tasks;
drop policy if exists project_tasks_delete on public.project_tasks;

create policy project_tasks_read on public.project_tasks for select to authenticated
using (public.can_read_project_task(id));

create policy project_tasks_insert on public.project_tasks for insert to authenticated
with check (
  public.has_project_category_access(category)
  and (
    public.is_system_admin()
    or (project_id is not null and public.has_project_full_access(project_id))
    or (project_id is null and (
      assignee_user_id = auth.uid()
      or public.is_direct_leader_of(assignee_user_id)
      or public.project_permission_scope() = 'full'
    ))
  )
);

create policy project_tasks_update on public.project_tasks for update to authenticated
using (public.can_manage_project_task(id))
with check (public.can_manage_project_task(id));

create policy project_tasks_delete on public.project_tasks for delete to authenticated
using (public.can_manage_project_task(id));

alter table public.project_task_assignees enable row level security;
alter table public.project_subtasks enable row level security;
alter table public.project_subtask_assignees enable row level security;

create policy project_task_assignees_read on public.project_task_assignees
for select to authenticated using (public.can_read_project_task(task_id));

create policy project_subtasks_read on public.project_subtasks
for select to authenticated using (public.can_read_project_task(task_id));

create policy project_subtask_assignees_read on public.project_subtask_assignees
for select to authenticated using (
  public.can_read_project_task((
    select subtask.task_id from public.project_subtasks subtask
    where subtask.id = subtask_id
  ))
);

grant select on public.project_task_assignees, public.project_subtasks,
  public.project_subtask_assignees to authenticated;

drop policy if exists project_files_storage_delete on storage.objects;
create policy project_files_storage_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'project-files'
  and public.has_project_files_access((storage.foldername(name))[1]::uuid)
  and (
    owner = auth.uid()
    or public.has_project_full_access((storage.foldername(name))[1]::uuid)
  )
);

create or replace function public.notify_project_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_row record;
  project_name text;
begin
  select task.id, task.title, task.project_id, task.created_by
  into task_row
  from public.project_tasks task
  where task.id = new.task_id;

  if new.user_id = auth.uid() then return new; end if;

  select project.name into project_name
  from public.projects project
  where project.id = task_row.project_id;

  insert into public.user_notifications (
    recipient_user_id, notification_type, entity_id, title, message, actor_user_id, read_at, created_at
  ) values (
    new.user_id, 'task_assigned', task_row.id, 'Nova tarefa atribuída',
    case when task_row.project_id is null then task_row.title
      else task_row.title || ' · ' || coalesce(project_name, 'Projeto') end,
    coalesce(auth.uid(), task_row.created_by), null, now()
  )
  on conflict (recipient_user_id, notification_type, entity_id) do update
    set title = excluded.title, message = excluded.message,
        actor_user_id = excluded.actor_user_id, read_at = null, created_at = now();
  return new;
end;
$$;

drop trigger if exists notify_project_task_assignee_after_insert on public.project_task_assignees;
create trigger notify_project_task_assignee_after_insert
after insert on public.project_task_assignees
for each row execute function public.notify_project_task_assignee();

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
  if p_category not in ('operational', 'governance') then
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

  if p_task_id is null and p_project_id is null
    and not public.is_system_admin()
    and public.project_permission_scope() <> 'full'
    and not (auth.uid() = any(p_assignee_ids))
  then
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

create or replace function public.set_project_subtask_completed(p_subtask_id uuid, p_completed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_task_id uuid;
begin
  select subtask.task_id into parent_task_id
  from public.project_subtasks subtask
  where subtask.id = p_subtask_id;
  if parent_task_id is null or not public.can_manage_project_task(parent_task_id) then
    raise exception using message = 'subtask_access_required';
  end if;
  update public.project_subtasks
  set completed_at = case when p_completed then coalesce(completed_at, now()) else null end
  where id = p_subtask_id;
end;
$$;

revoke all on function public.set_project_subtask_completed(uuid, boolean) from public;
grant execute on function public.set_project_subtask_completed(uuid, boolean) to authenticated;

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
  created_id uuid;
begin
  if not public.can_create_project(p_category) then
    raise exception using message = 'department_access_required';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 140 then
    raise exception using message = 'invalid_project_name';
  end if;
  if p_template_id is not null and not exists (
    select 1 from public.project_templates template
    where template.id = p_template_id and template.is_active
  ) then
    raise exception using message = 'project_template_not_available';
  end if;

  insert into public.projects (
    name, category, start_date, owner_user_id, owner_name, owner_email,
    objective, status, created_by
  ) values (
    btrim(p_name), p_category, coalesce(p_start_date, current_date), p_owner_user_id,
    'Responsável', 'responsavel@temp.invalid', 'A definir', 'ativo', auth.uid()
  ) returning id into created_id;

  if p_template_id is not null then
    insert into public.project_tasks (
      project_id, category, title, description, assignee_user_id, assignee_name,
      assignee_email, due_date, status, position, created_by
    )
    select
      created_id, p_category, task.title, task.description,
      coalesce(task.assignee_user_id, p_owner_user_id), 'Responsável', 'responsavel@temp.invalid',
      coalesce(p_start_date, current_date) + task.due_offset_days,
      task.status, task.position, auth.uid()
    from public.project_template_tasks task
    where task.template_id = p_template_id
    order by task.position;
  end if;
  return created_id;
end;
$$;

revoke all on function public.create_project_from_template(text, uuid, date, uuid, text) from public;
grant execute on function public.create_project_from_template(text, uuid, date, uuid, text) to authenticated;

-- A versão anterior expõe owner_name. Como PostgreSQL não permite alterar os
-- parâmetros OUT com CREATE OR REPLACE, remova a assinatura antes de recriá-la.
drop function if exists public.business_project_options();
create function public.business_project_options()
returns table (
  id uuid,
  name text,
  status public.project_status,
  archived_at timestamptz,
  owner_name text,
  category text
)
language sql
stable
security definer
set search_path = ''
as $$
  select project.id, project.name, project.status, project.archived_at,
    project.owner_name, project.category
  from public.projects project
  where public.has_department_access('novos-negocios')
    and (
      (
        project.category = 'operational'
        and project.archived_at is null
        and project.status in ('ativo', 'concluido')
      )
      or exists (
        select 1 from public.businesses business
        where business.project_id = project.id
      )
    )
  order by project.name;
$$;

revoke all on function public.business_project_options() from public;
grant execute on function public.business_project_options() to authenticated;

create or replace function public.current_user_today_alert_count()
returns integer
language sql
stable
set search_path = ''
as $$
  with calendar as (
    select (timezone('America/Sao_Paulo', now()))::date as today
  ), assigned_tasks as (
    select distinct task.id, task.due_date, task.status
    from public.project_tasks task
    left join public.project_task_assignees task_assignee on task_assignee.task_id = task.id
    left join public.project_subtasks subtask on subtask.task_id = task.id
    left join public.project_subtask_assignees subtask_assignee on subtask_assignee.subtask_id = subtask.id
    where public.has_project_category_access(task.category)
      and (task_assignee.user_id = auth.uid() or subtask_assignee.user_id = auth.uid())
  ), rental_dates as (
    select rental.*,
      case when rental.status = 'alugado' and rental.lease_start_date is not null then
        make_date(extract(year from calendar.today)::integer,
          extract(month from rental.lease_start_date)::integer,
          least(extract(day from rental.lease_start_date)::integer,
            extract(day from (date_trunc('month', make_date(extract(year from calendar.today)::integer,
              extract(month from rental.lease_start_date)::integer, 1) + interval '1 month') - interval '1 day'))::integer))
        else null end as adjustment_this_year,
      calendar.today
    from public.rentals rental cross join calendar
    where public.has_department_access('alugueis')
  ), normalized_rentals as (
    select rental.*,
      case when rental.adjustment_this_year < rental.today
        then (rental.adjustment_this_year + interval '1 year')::date
        else rental.adjustment_this_year end as next_adjustment
    from rental_dates rental
  )
  select (
    case when public.has_department_access('projetos') or public.has_department_access('governanca') then
      (select count(*) from public.user_notifications notification
        where notification.recipient_user_id = auth.uid() and notification.read_at is null)
      + (select count(*) from assigned_tasks task, calendar
        where task.status <> 'concluida' and task.due_date < calendar.today)
      else 0 end
    + case when public.has_department_access('obras') then
      (select count(*) from public.construction_progress_summary work, calendar
       where work.responsible_user_id = auth.uid() and work.archived_at is null
         and work.status = 'em_andamento' and work.next_inspection_at <= calendar.today + 3)
      else 0 end
    + (select coalesce(sum(
        case when rental.status = 'aguardando_reforma' then 1 else 0 end
        + case when rental.status = 'alugado' and rental.lease_end_date < rental.today then 1
          when rental.status = 'alugado' and rental.lease_end_date <= rental.today + 60 then 1 else 0 end
        + case when rental.status = 'alugado' and rental.next_adjustment <= rental.today + 45 then 1 else 0 end
      ), 0) from normalized_rentals rental)
  )::integer;
$$;

commit;
