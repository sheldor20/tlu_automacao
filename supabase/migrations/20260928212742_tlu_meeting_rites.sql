begin;

-- The stable department slug and RA tables preserve existing links and history.
update public.departments set name = 'Reuniões TLU' where slug = 'pauta-ra';
alter table public.ra_meetings
  add column meeting_type text not null default 'RA' check (meeting_type in ('RAE','RASP','RA','RAO','1:1')),
  add column report_user_id uuid references public.profiles(user_id),
  add column record_data jsonb not null default '{}' check (jsonb_typeof(record_data) = 'object' and octet_length(record_data::text) <= 100000),
  add column minutes_revision integer not null default 0,
  add column minutes_edited_at timestamptz,
  add column minutes_edited_by uuid references public.profiles(user_id),
  add constraint ra_individual_pair check (
    (meeting_type = '1:1' and report_user_id is not null and report_user_id <> leader_user_id)
    or (meeting_type <> '1:1' and report_user_id is null)
  );
create index ra_meetings_type_date_idx on public.ra_meetings(meeting_type, scheduled_at desc);
create index ra_meetings_report_idx on public.ra_meetings(report_user_id) where report_user_id is not null;

create table public.ra_meeting_type_members (
  meeting_type text not null check (meeting_type in ('RAE','RASP','RA','RAO')),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  primary key (meeting_type, user_id)
);
create index ra_type_members_user_idx on public.ra_meeting_type_members(user_id, meeting_type);
alter table public.ra_meeting_type_members enable row level security;
revoke all on public.ra_meeting_type_members from anon, authenticated;
grant select, insert, delete on public.ra_meeting_type_members to authenticated;
grant all on public.ra_meeting_type_members to service_role;
create policy ra_type_members_read on public.ra_meeting_type_members for select to authenticated
using (public.has_department_access('pauta-ra'));
create policy ra_type_members_insert on public.ra_meeting_type_members for insert to authenticated
with check (public.is_system_admin());
create policy ra_type_members_delete on public.ra_meeting_type_members for delete to authenticated
using (public.is_system_admin());

-- Resolve only unique names; do not guess identities or create users. The two
-- expanded names below were checked against the existing active directory.
with requested(meeting_type, person) as (
  select 'RAE', unnest(array['ana cristina','aylton','awa','jivago','christiane','rosangela','thiago','kim']) union all
  select 'RASP', unnest(array['awa','jivago','christiane']) union all
  select 'RA', unnest(array['ana cristina','aylton','awa','jivago','christiane','rosangela','thiago']) union all
  select 'RAO', unnest(array['christiane','rosangela','thiago','kamila','cassia','jessica','larissa','malaui','gabriela santiago','gabriela alves dos reis','samara','rayra','rafaella','adriana'])
), normalized as (
  select user_id, translate(lower(btrim(full_name)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') as name
  from public.profiles where active and deleted_at is null
), matches as (
  select r.meeting_type, r.person, p.user_id, count(*) over (partition by r.meeting_type,r.person) as n
  from requested r join normalized p on p.name = r.person or p.name like r.person || ' %'
)
insert into public.ra_meeting_type_members(meeting_type,user_id)
select meeting_type,user_id from matches where n = 1 on conflict do nothing;

-- Everyone in the active internal directory can have an individual meeting.
-- Administrators retain the existing ability to revoke the entire department.
insert into public.profile_departments(user_id,department_slug)
select user_id,'pauta-ra' from public.profiles where active and deleted_at is null
on conflict do nothing;

create schema if not exists private;
grant usage on schema private to authenticated;
create function private.can_access_meeting_type(p_type text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and public.has_department_access('pauta-ra') and (
    p_type = '1:1' or (p_type in ('RAE','RASP','RA','RAO') and (
      public.is_system_admin() or exists (
        select 1 from public.ra_meeting_type_members m where m.meeting_type = p_type and m.user_id = auth.uid()
      )
    ))
  );
$$;
create function private.can_access_tlu_meeting(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.ra_meetings m where m.id = p_id
      and private.can_access_meeting_type(m.meeting_type)
      and (m.meeting_type <> '1:1' or auth.uid() in (m.leader_user_id,m.report_user_id))
  );
$$;
create function private.can_administer_tlu_meeting(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and private.can_access_tlu_meeting(p_id) and exists (
    select 1 from public.ra_meetings m where m.id = p_id
      and (m.leader_user_id = auth.uid() or public.is_system_admin())
  );
$$;
revoke all on function private.can_access_meeting_type(text), private.can_access_tlu_meeting(uuid), private.can_administer_tlu_meeting(uuid) from public, anon;
grant execute on function private.can_access_meeting_type(text), private.can_access_tlu_meeting(uuid), private.can_administer_tlu_meeting(uuid) to authenticated;

create or replace function public.can_access_ra_meeting(p_meeting_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$ select private.can_access_tlu_meeting(p_meeting_id); $$;
create or replace function public.can_administer_ra_meeting(p_meeting_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$ select private.can_administer_tlu_meeting(p_meeting_id); $$;
-- Existing policies/functions use this for mutable children, never for reading.
create or replace function public.can_manage_ra_meeting(p_meeting_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.can_administer_tlu_meeting(p_meeting_id) and exists (
    select 1 from public.ra_meetings m where m.id = p_meeting_id and m.archived_at is null and m.status <> 'encerrada'
  );
$$;

-- SELECT/RETURNING must evaluate the row directly: a STABLE lookup by ID
-- cannot see a just-inserted row in the same command snapshot.
drop policy ra_meetings_read on public.ra_meetings;
create policy ra_meetings_read on public.ra_meetings for select to authenticated
using (private.can_access_meeting_type(meeting_type)
  and (meeting_type <> '1:1' or auth.uid() in (leader_user_id,report_user_id)));

-- Creation is authorized from the proposed values (no lookup of a row not yet inserted).
drop policy ra_meetings_insert on public.ra_meetings;
create policy ra_meetings_insert on public.ra_meetings for insert to authenticated
with check (
  created_by = auth.uid() and private.can_access_meeting_type(meeting_type)
  and case when meeting_type = '1:1' then
    auth.uid() in (leader_user_id,report_user_id) and exists (
      select 1 from public.profile_reporting_lines line
      where line.leader_user_id = ra_meetings.leader_user_id and line.report_user_id = ra_meetings.report_user_id
    )
  else public.can_manage_ra() and (public.is_system_admin() or leader_user_id = auth.uid()) end
);

create function public.set_ra_meeting_type_members(p_type text, p_user_ids uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not public.is_system_admin() then raise exception 'Somente o administrador pode configurar os participantes.'; end if;
  if p_type not in ('RAE','RASP','RA','RAO') or p_type is null then raise exception 'Tipo de reunião inválido.'; end if;
  -- Serialize concurrent replacements of the same roster.
  perform pg_advisory_xact_lock(hashtext('tlu_members_' || p_type));
  if exists (select 1 from unnest(p_user_ids) id where not exists (
    select 1 from public.profiles p where p.user_id = id and p.active and p.deleted_at is null
  )) then raise exception 'Selecione apenas usuários ativos.'; end if;
  delete from public.ra_meeting_type_members where meeting_type = p_type;
  insert into public.ra_meeting_type_members(meeting_type,user_id)
  select p_type,id from (select distinct unnest(p_user_ids) id) ids;
  insert into public.profile_departments(user_id,department_slug)
  select distinct id,'pauta-ra' from unnest(p_user_ids) id on conflict do nothing;
end;
$$;
revoke all on function public.set_ra_meeting_type_members(text,uuid[]) from public, anon;
grant execute on function public.set_ra_meeting_type_members(text,uuid[]) to authenticated;

-- Immutable pair and type: an individual record can never be changed into a
-- public collective meeting, or reassigned to another colleague.
create function private.guard_tlu_meeting()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists(select 1 from jsonb_each(new.record_data) entry where jsonb_typeof(entry.value) <> 'string' or char_length(entry.value #>> '{}') > 8000) then
    raise exception 'Cada campo do registro deve conter texto de até 8.000 caracteres.';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'rascunho' or new.minutes_text is not null or new.closed_at is not null or new.minutes_revision <> 0 or new.minutes_edited_at is not null or new.minutes_edited_by is not null then
      raise exception 'Crie a reunião em preparação antes de registrar a ata.';
    end if;
  else
    if row(new.meeting_type,new.leader_user_id,new.report_user_id,new.created_by) is distinct from
       row(old.meeting_type,old.leader_user_id,old.report_user_id,old.created_by) then
      raise exception 'O tipo e os participantes do vínculo original não podem ser alterados.';
    end if;
    if old.status = 'encerrada' then
      if row(new.status,new.closed_at,new.title,new.scheduled_at,new.record_data) is distinct from
         row(old.status,old.closed_at,old.title,old.scheduled_at,old.record_data) then
        raise exception 'Esta reunião já foi finalizada. Apenas a ata pode ser corrigida pelo administrador.';
      end if;
      if new.minutes_text is distinct from old.minutes_text then
        if not public.is_system_admin() or not public.can_access_ra_meeting(old.id) or old.archived_at is not null then
          raise exception 'Somente um administrador com acesso à reunião pode corrigir a ata finalizada. Restaure reuniões arquivadas antes de editar.';
        end if;
        if char_length(btrim(coalesce(new.minutes_text,''))) < 2 or char_length(new.minutes_text) > 200000 then
          raise exception 'A ata deve conter de 2 a 200.000 caracteres.';
        end if;
        new.minutes_revision := old.minutes_revision + 1;
        new.minutes_edited_by := auth.uid();
        new.minutes_edited_at := clock_timestamp();
      else
        new.minutes_revision := old.minutes_revision;
        new.minutes_edited_by := old.minutes_edited_by;
        new.minutes_edited_at := old.minutes_edited_at;
      end if;
    else
      new.minutes_revision := old.minutes_revision;
      new.minutes_edited_by := old.minutes_edited_by;
      new.minutes_edited_at := old.minutes_edited_at;
      if old.archived_at is not null and row(new.status,new.record_data,new.minutes_text) is distinct from row(old.status,old.record_data,old.minutes_text) then
        raise exception 'Restaure a reunião arquivada antes de editar.';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_tlu_meeting before insert or update on public.ra_meetings
for each row execute function private.guard_tlu_meeting();
revoke all on function private.guard_tlu_meeting() from public, anon, authenticated;

create table public.ra_minutes_revisions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.ra_meetings(id) on delete cascade,
  revision integer not null,
  previous_text text,
  minutes_text text not null,
  edited_by uuid not null references public.profiles(user_id),
  edited_at timestamptz not null default now(),
  unique(meeting_id,revision)
);
alter table public.ra_minutes_revisions enable row level security;
revoke all on public.ra_minutes_revisions from anon, authenticated;
grant select on public.ra_minutes_revisions to authenticated;
grant all on public.ra_minutes_revisions to service_role;
create policy ra_minutes_revisions_read on public.ra_minutes_revisions for select to authenticated
using (public.can_access_ra_meeting(meeting_id));
create function private.audit_tlu_minutes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sessão inválida para corrigir a ata.'; end if;
  insert into public.ra_minutes_revisions(meeting_id,revision,previous_text,minutes_text,edited_by,edited_at)
  values (new.id,new.minutes_revision,old.minutes_text,new.minutes_text,auth.uid(),new.minutes_edited_at);
  return null;
end;
$$;
revoke all on function private.audit_tlu_minutes() from public, anon, authenticated;
create trigger audit_tlu_minutes after update of minutes_text on public.ra_meetings
for each row when (old.status = 'encerrada' and new.minutes_text is distinct from old.minutes_text)
execute function private.audit_tlu_minutes();

create function public.revise_ra_minutes(p_meeting_id uuid,p_minutes text,p_expected_revision integer)
returns integer language plpgsql security invoker set search_path = '' as $$
declare m public.ra_meetings;
begin
  select * into m from public.ra_meetings where id = p_meeting_id for update;
  if m.id is null or not public.is_system_admin() then raise exception 'Você não tem permissão para corrigir esta ata.'; end if;
  if m.status <> 'encerrada' then raise exception 'A reunião ainda não foi finalizada.'; end if;
  if p_expected_revision is distinct from m.minutes_revision then raise exception 'A ata foi alterada por outra pessoa. Reabra a edição para carregar a versão atual.'; end if;
  update public.ra_meetings set minutes_text = btrim(p_minutes) where id = m.id;
  return (select minutes_revision from public.ra_meetings where id = m.id);
end;
$$;
revoke all on function public.revise_ra_minutes(uuid,text,integer) from public, anon;
grant execute on function public.revise_ra_minutes(uuid,text,integer) to authenticated;

-- Participants cannot be used to open a 1:1 to third parties or to evade the roster.
create function private.guard_tlu_participant()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare m public.ra_meetings;
begin
  select * into m from public.ra_meetings where id = new.meeting_id;
  if m.id is null then raise exception 'Reunião indisponível.'; end if;
  if m.meeting_type = '1:1' then
    if new.user_id not in (m.leader_user_id,m.report_user_id) then raise exception 'O 1:1 é restrito ao líder e ao colaborador.'; end if;
  elsif new.user_id <> m.leader_user_id and not exists (
    select 1 from public.ra_meeting_type_members where meeting_type = m.meeting_type and user_id = new.user_id
  ) then raise exception 'Configure o acesso deste participante no administrador.'; end if;
  return new;
end;
$$;
create trigger guard_tlu_participant before insert or update on public.ra_participants
for each row execute function private.guard_tlu_participant();
revoke all on function private.guard_tlu_participant() from public, anon, authenticated;

-- Entire setup is transactional: a failed section/topic never leaves a partial meeting.
create function public.create_tlu_meeting(
  p_type text,p_title text,p_scheduled_at timestamptz,p_leader_id uuid,
  p_report_id uuid default null,p_participant_ids uuid[] default '{}',
  p_project_ids uuid[] default '{}',p_topics text[] default '{}'
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare mid uuid; sid uuid; pid uuid; topic text; pos integer := 0; participants uuid[];
begin
  if coalesce(array_length(p_topics,1),0) > 50 then raise exception 'Informe no máximo 50 tópicos iniciais.'; end if;
  -- Only the leader creates the record; all active users may have their own 1:1.
  if p_type = '1:1' and p_leader_id <> auth.uid() then raise exception 'O líder deve agendar o 1:1 com seu colaborador.'; end if;
  insert into public.ra_meetings(meeting_type,title,scheduled_at,leader_user_id,report_user_id)
  values (p_type,btrim(p_title),p_scheduled_at,p_leader_id,p_report_id) returning id into mid;
  participants := case when p_type = '1:1' then array[p_leader_id,p_report_id] else array_append(p_participant_ids,p_leader_id) end;
  insert into public.ra_participants(meeting_id,user_id) select mid,id from (select distinct unnest(participants) id) ids;
  if coalesce(array_length(p_topics,1),0) > 0 then
    insert into public.ra_agenda_sections(meeting_id,title,position) values(mid,'Pauta e temas do encontro',0) returning id into sid;
    foreach topic in array p_topics loop
      insert into public.ra_agenda_items(section_id,content,position) values(sid,btrim(topic),pos);
      pos := pos + 1;
    end loop;
  end if;
  pos := 1;
  for pid in select distinct unnest(p_project_ids) loop
    if not exists(select 1 from public.projects where id = pid and status = 'ativo' and archived_at is null) then
      raise exception 'Selecione apenas projetos ativos aos quais você tem acesso.';
    end if;
    insert into public.ra_meeting_projects(meeting_id,project_id) values(mid,pid);
    insert into public.ra_agenda_sections(meeting_id,project_id,title,position)
    select mid,pid,name,pos from public.projects where id = pid;
    pos := pos + 1;
  end loop;
  return mid;
end;
$$;
revoke all on function public.create_tlu_meeting(text,text,timestamptz,uuid,uuid,uuid[],uuid[],text[]) from public, anon;
grant execute on function public.create_tlu_meeting(text,text,timestamptz,uuid,uuid,uuid[],uuid[],text[]) to authenticated;

-- Private task context survives deletion of the source meeting, so preserved
-- tasks never become visible to third parties after an agenda is removed.
alter table public.project_tasks
  add column private_meeting_leader_id uuid references public.profiles(user_id),
  add column private_meeting_report_id uuid references public.profiles(user_id),
  add constraint private_meeting_task_pair check (
    (private_meeting_leader_id is null and private_meeting_report_id is null)
    or (private_meeting_leader_id is not null and private_meeting_report_id is not null
      and private_meeting_leader_id <> private_meeting_report_id and project_id is null)
  );
create index private_task_leader_idx on public.project_tasks(private_meeting_leader_id) where private_meeting_leader_id is not null;
create index private_task_report_idx on public.project_tasks(private_meeting_report_id) where private_meeting_report_id is not null;

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

create function private.guard_private_meeting_task()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and row(new.private_meeting_leader_id,new.private_meeting_report_id) is distinct from
    row(old.private_meeting_leader_id,old.private_meeting_report_id) then
    raise exception 'A privacidade de uma tarefa de 1:1 não pode ser alterada.';
  end if;
  if new.private_meeting_leader_id is not null then
    if auth.uid() is null or auth.uid() not in (new.private_meeting_leader_id,new.private_meeting_report_id)
      or new.assignee_user_id is null or new.assignee_user_id not in (new.private_meeting_leader_id,new.private_meeting_report_id)
      or new.project_id is not null then
      raise exception 'A tarefa de 1:1 deve permanecer restrita ao líder e ao colaborador.';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_private_meeting_task before insert or update on public.project_tasks
for each row execute function private.guard_private_meeting_task();
revoke all on function private.guard_private_meeting_task() from public, anon, authenticated;

create function private.guard_private_meeting_assignee()
returns trigger language plpgsql security definer set search_path = '' as $$
declare t public.project_tasks; tid uuid;
begin
  if tg_table_name = 'project_task_assignees' then tid := new.task_id;
  else select task_id into tid from public.project_subtasks where id = new.subtask_id; end if;
  select * into t from public.project_tasks where id = tid;
  if t.private_meeting_leader_id is not null and (
    auth.uid() is null or auth.uid() not in (t.private_meeting_leader_id,t.private_meeting_report_id)
    or new.user_id not in (t.private_meeting_leader_id,t.private_meeting_report_id)
  ) then raise exception 'Responsáveis de uma tarefa de 1:1 devem pertencer ao encontro.'; end if;
  return new;
end;
$$;
revoke all on function private.guard_private_meeting_assignee() from public, anon, authenticated;
create trigger guard_private_task_assignee before insert or update on public.project_task_assignees
for each row execute function private.guard_private_meeting_assignee();
create trigger guard_private_subtask_assignee before insert or update on public.project_subtask_assignees
for each row execute function private.guard_private_meeting_assignee();

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
  select item.id, item.content, item.task_id, section.meeting_id, meeting.status, meeting.meeting_type, meeting.leader_user_id, meeting.report_user_id
  into item_row
  from public.ra_agenda_items item
  join public.ra_agenda_sections section on section.id = item.section_id
  join public.ra_meetings meeting on meeting.id = section.meeting_id
  where item.id = p_item_id
  for update of item;
  if item_row.id is null or not public.can_manage_ra_meeting(item_row.meeting_id) then raise exception using message = 'ra_manage_required'; end if;
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
  update public.ra_agenda_items set kind = 'acao', owner_user_id = p_assignee_user_id, due_date = p_due_date, project_id = p_project_id, task_id = created_task_id where id = p_item_id;
  return created_task_id;
end;
$$;

commit;
