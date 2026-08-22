-- Departamentos Processos e Pauta e RA.

begin;

insert into public.departments (slug, name, position) values
  ('processos', 'Processos', 5),
  ('pauta-ra', 'Pauta e RA', 6)
on conflict (slug) do update set name = excluded.name, position = excluded.position;

update public.departments set position = 7 where slug = 'indicadores';

create type public.business_process_status as enum ('rascunho', 'publicado', 'arquivado');
create type public.ra_meeting_status as enum ('rascunho', 'em_andamento', 'encerrada');
create type public.ra_item_kind as enum ('topico', 'acao', 'definicao');

create table public.profile_process_permissions (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  can_manage boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.business_processes (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 2 and 160),
  area text not null check (char_length(btrim(area)) between 2 and 100),
  objective text not null check (char_length(btrim(objective)) between 2 and 3000),
  rules text[] not null default '{}',
  policies text[] not null default '{}',
  status public.business_process_status not null default 'rascunho',
  created_by uuid not null default auth.uid() references public.profiles(user_id),
  updated_by uuid not null default auth.uid() references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_process_steps (
  id uuid primary key default gen_random_uuid(),
  process_id uuid not null references public.business_processes(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 180),
  description text not null check (char_length(btrim(description)) between 2 and 4000),
  responsible_role text check (char_length(responsible_role) <= 140),
  business_rule text check (char_length(business_rule) <= 3000),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ra_meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 2 and 180),
  scheduled_at timestamptz not null,
  leader_user_id uuid not null references public.profiles(user_id),
  status public.ra_meeting_status not null default 'rascunho',
  minutes_text text,
  closed_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ra_participants (
  meeting_id uuid not null references public.ra_meetings(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  attended boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);

create table public.ra_meeting_projects (
  meeting_id uuid not null references public.ra_meetings(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (meeting_id, project_id)
);

create table public.ra_agenda_sections (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.ra_meetings(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 220),
  project_id uuid references public.projects(id) on delete set null,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ra_agenda_items (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.ra_agenda_sections(id) on delete cascade,
  content text not null check (char_length(btrim(content)) between 2 and 2000),
  kind public.ra_item_kind not null default 'topico',
  owner_user_id uuid references public.profiles(user_id) on delete set null,
  due_date date,
  project_id uuid references public.projects(id) on delete set null,
  decision_text text check (char_length(decision_text) <= 4000),
  task_id uuid references public.project_tasks(id) on delete set null,
  resolved_at timestamptz,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ra_decisions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.ra_meetings(id) on delete cascade,
  item_id uuid not null unique references public.ra_agenda_items(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 220),
  decision_text text not null check (char_length(btrim(decision_text)) between 2 and 4000),
  decided_by uuid not null default auth.uid() references public.profiles(user_id),
  decided_at timestamptz not null default now()
);

create table public.ra_email_dispatches (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.ra_meetings(id) on delete cascade,
  recipients text[] not null,
  provider_id text,
  sent_by uuid not null references public.profiles(user_id),
  sent_at timestamptz not null default now()
);

create index business_processes_status_idx on public.business_processes(status, updated_at desc);
create index business_process_steps_process_idx on public.business_process_steps(process_id, position);
create index ra_meetings_leader_date_idx on public.ra_meetings(leader_user_id, scheduled_at desc);
create index ra_participants_user_idx on public.ra_participants(user_id, meeting_id);
create index ra_sections_meeting_idx on public.ra_agenda_sections(meeting_id, position);
create index ra_items_section_idx on public.ra_agenda_items(section_id, position);
create index ra_decisions_meeting_idx on public.ra_decisions(meeting_id, decided_at);

create trigger set_business_processes_updated_at before update on public.business_processes
for each row execute function public.set_updated_at();
create trigger set_business_process_steps_updated_at before update on public.business_process_steps
for each row execute function public.set_updated_at();
create trigger set_ra_meetings_updated_at before update on public.ra_meetings
for each row execute function public.set_updated_at();
create trigger set_ra_agenda_sections_updated_at before update on public.ra_agenda_sections
for each row execute function public.set_updated_at();
create trigger set_ra_agenda_items_updated_at before update on public.ra_agenda_items
for each row execute function public.set_updated_at();

create or replace function public.can_manage_processes()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_system_admin() or exists (
    select 1 from public.profile_process_permissions permission
    join public.profiles profile on profile.user_id = permission.user_id
    where permission.user_id = auth.uid() and permission.can_manage and profile.active
  );
$$;

create or replace function public.can_manage_ra()
returns boolean
language sql stable security definer set search_path = ''
as $$ select public.is_system_admin() or public.is_team_leader(); $$;

create or replace function public.can_manage_ra_meeting(p_meeting_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_system_admin() or exists (
    select 1 from public.ra_meetings meeting
    where meeting.id = p_meeting_id and meeting.leader_user_id = auth.uid()
  );
$$;

create or replace function public.can_access_ra_meeting(p_meeting_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_department_access('pauta-ra') and (
    public.is_system_admin()
    or exists (select 1 from public.ra_meetings meeting where meeting.id = p_meeting_id and meeting.leader_user_id = auth.uid())
    or exists (select 1 from public.ra_participants participant where participant.meeting_id = p_meeting_id and participant.user_id = auth.uid())
  );
$$;

revoke all on function public.can_manage_processes(), public.can_manage_ra(), public.can_manage_ra_meeting(uuid), public.can_access_ra_meeting(uuid) from public;
grant execute on function public.can_manage_processes(), public.can_manage_ra(), public.can_manage_ra_meeting(uuid), public.can_access_ra_meeting(uuid) to authenticated;

alter table public.profile_process_permissions enable row level security;
alter table public.business_processes enable row level security;
alter table public.business_process_steps enable row level security;
alter table public.ra_meetings enable row level security;
alter table public.ra_participants enable row level security;
alter table public.ra_meeting_projects enable row level security;
alter table public.ra_agenda_sections enable row level security;
alter table public.ra_agenda_items enable row level security;
alter table public.ra_decisions enable row level security;
alter table public.ra_email_dispatches enable row level security;

create policy process_permissions_read on public.profile_process_permissions for select to authenticated
using (user_id = auth.uid() or public.is_system_admin());
create policy process_permissions_admin_write on public.profile_process_permissions for all to authenticated
using (public.is_system_admin()) with check (public.is_system_admin());

create policy business_processes_read on public.business_processes for select to authenticated
using (public.has_department_access('processos') and (status = 'publicado' or public.can_manage_processes()));
create policy business_processes_manage on public.business_processes for all to authenticated
using (public.has_department_access('processos') and public.can_manage_processes())
with check (public.has_department_access('processos') and public.can_manage_processes());

create policy business_process_steps_read on public.business_process_steps for select to authenticated
using (exists (select 1 from public.business_processes process where process.id = process_id));
create policy business_process_steps_manage on public.business_process_steps for all to authenticated
using (public.has_department_access('processos') and public.can_manage_processes())
with check (public.has_department_access('processos') and public.can_manage_processes());

create policy ra_meetings_read on public.ra_meetings for select to authenticated
using (public.can_access_ra_meeting(id));
create policy ra_meetings_insert on public.ra_meetings for insert to authenticated
with check (public.has_department_access('pauta-ra') and public.can_manage_ra() and (public.is_system_admin() or leader_user_id = auth.uid()));
create policy ra_meetings_update on public.ra_meetings for update to authenticated
using (public.can_manage_ra_meeting(id)) with check (public.can_manage_ra_meeting(id));
create policy ra_meetings_delete on public.ra_meetings for delete to authenticated
using (public.can_manage_ra_meeting(id));

create policy ra_participants_read on public.ra_participants for select to authenticated
using (public.can_access_ra_meeting(meeting_id));
create policy ra_participants_manage on public.ra_participants for all to authenticated
using (public.can_manage_ra_meeting(meeting_id)) with check (public.can_manage_ra_meeting(meeting_id));
create policy ra_projects_read on public.ra_meeting_projects for select to authenticated
using (public.can_access_ra_meeting(meeting_id));
create policy ra_projects_manage on public.ra_meeting_projects for all to authenticated
using (public.can_manage_ra_meeting(meeting_id)) with check (public.can_manage_ra_meeting(meeting_id));
create policy ra_sections_read on public.ra_agenda_sections for select to authenticated
using (public.can_access_ra_meeting(meeting_id));
create policy ra_sections_manage on public.ra_agenda_sections for all to authenticated
using (public.can_manage_ra_meeting(meeting_id)) with check (public.can_manage_ra_meeting(meeting_id));
create policy ra_items_read on public.ra_agenda_items for select to authenticated
using (exists (select 1 from public.ra_agenda_sections section where section.id = section_id and public.can_access_ra_meeting(section.meeting_id)));
create policy ra_items_manage on public.ra_agenda_items for all to authenticated
using (exists (select 1 from public.ra_agenda_sections section where section.id = section_id and public.can_manage_ra_meeting(section.meeting_id)))
with check (exists (select 1 from public.ra_agenda_sections section where section.id = section_id and public.can_manage_ra_meeting(section.meeting_id)));
create policy ra_decisions_read on public.ra_decisions for select to authenticated
using (public.can_access_ra_meeting(meeting_id));
create policy ra_decisions_manage on public.ra_decisions for all to authenticated
using (public.can_manage_ra_meeting(meeting_id)) with check (public.can_manage_ra_meeting(meeting_id));
create policy ra_email_dispatches_read on public.ra_email_dispatches for select to authenticated
using (public.can_manage_ra_meeting(meeting_id));
create policy ra_email_dispatches_insert on public.ra_email_dispatches for insert to authenticated
with check (public.can_manage_ra_meeting(meeting_id) and sent_by = auth.uid());

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
  where item.id = p_item_id;
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

create or replace function public.record_ra_decision(p_item_id uuid, p_decision_text text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  item_row record;
  decision_id uuid;
begin
  select item.id, item.content, section.meeting_id, meeting.status
  into item_row
  from public.ra_agenda_items item
  join public.ra_agenda_sections section on section.id = item.section_id
  join public.ra_meetings meeting on meeting.id = section.meeting_id
  where item.id = p_item_id;
  if item_row.id is null or not public.can_manage_ra_meeting(item_row.meeting_id) then raise exception using message = 'ra_manage_required'; end if;
  if item_row.status = 'encerrada' then raise exception using message = 'ra_already_closed'; end if;
  if char_length(btrim(coalesce(p_decision_text, ''))) < 2 then raise exception using message = 'ra_decision_required'; end if;
  insert into public.ra_decisions (meeting_id, item_id, title, decision_text, decided_by)
  values (item_row.meeting_id, p_item_id, left(item_row.content, 220), btrim(p_decision_text), auth.uid())
  on conflict (item_id) do update set decision_text = excluded.decision_text, decided_by = auth.uid(), decided_at = now()
  returning id into decision_id;
  update public.ra_agenda_items set kind = 'definicao', decision_text = btrim(p_decision_text), resolved_at = now() where id = p_item_id;
  return decision_id;
end;
$$;

revoke all on function public.convert_ra_item_to_task(uuid, uuid, date, uuid), public.record_ra_decision(uuid, text) from public;
grant execute on function public.convert_ra_item_to_task(uuid, uuid, date, uuid), public.record_ra_decision(uuid, text) to authenticated;

grant select, insert, update, delete on public.profile_process_permissions, public.business_processes, public.business_process_steps,
  public.ra_meetings, public.ra_participants, public.ra_meeting_projects, public.ra_agenda_sections, public.ra_agenda_items, public.ra_decisions to authenticated;
grant select, insert on public.ra_email_dispatches to authenticated;

commit;
