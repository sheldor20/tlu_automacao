-- Melhorias operacionais: permissões finas de Projetos, edição do histórico de
-- Obras e links públicos revogáveis para atualização de avanço.

begin;

create table if not exists public.profile_project_permissions (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  access_scope text not null default 'full' check (access_scope in ('full', 'assigned_tasks')),
  allow_files boolean not null default true,
  allow_updates boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.profile_project_permissions (user_id, access_scope, allow_files, allow_updates)
select access.user_id, 'full', true, true
from public.profile_departments access
where access.department_slug = 'projetos'
on conflict (user_id) do nothing;

create trigger set_profile_project_permissions_updated_at
before update on public.profile_project_permissions
for each row execute function public.set_updated_at();

alter table public.profile_project_permissions enable row level security;

create policy profile_project_permissions_read
on public.profile_project_permissions for select to authenticated
using (user_id = auth.uid() or public.is_system_admin());

create policy profile_project_permissions_admin_write
on public.profile_project_permissions for all to authenticated
using (public.is_system_admin())
with check (public.is_system_admin());

grant select, insert, update, delete on public.profile_project_permissions to authenticated;

create or replace function public.project_permission_scope()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.is_system_admin() then 'full'
    else coalesce((
      select permission.access_scope
      from public.profile_project_permissions permission
      where permission.user_id = auth.uid()
    ), 'full')
  end;
$$;

create or replace function public.has_project_full_access(p_project_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_department_access('projetos')
    and public.project_permission_scope() = 'full';
$$;

create or replace function public.has_project_access(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_department_access('projetos') and (
    public.project_permission_scope() = 'full'
    or exists (
      select 1 from public.projects project
      where project.id = p_project_id and project.owner_user_id = auth.uid()
    )
    or exists (
      select 1 from public.project_members member
      where member.project_id = p_project_id and member.user_id = auth.uid()
    )
    or exists (
      select 1 from public.project_tasks task
      where task.project_id = p_project_id and task.assignee_user_id = auth.uid()
    )
  );
$$;

create or replace function public.has_project_files_access(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_project_access(p_project_id) and (
    public.has_project_full_access(p_project_id)
    or coalesce((
      select permission.allow_files
      from public.profile_project_permissions permission
      where permission.user_id = auth.uid()
    ), true)
  );
$$;

create or replace function public.has_project_updates_access(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_project_access(p_project_id) and (
    public.has_project_full_access(p_project_id)
    or coalesce((
      select permission.allow_updates
      from public.profile_project_permissions permission
      where permission.user_id = auth.uid()
    ), true)
  );
$$;

revoke all on function public.project_permission_scope() from public;
revoke all on function public.has_project_full_access(uuid) from public;
revoke all on function public.has_project_access(uuid) from public;
revoke all on function public.has_project_files_access(uuid) from public;
revoke all on function public.has_project_updates_access(uuid) from public;
grant execute on function public.project_permission_scope(), public.has_project_full_access(uuid),
  public.has_project_access(uuid), public.has_project_files_access(uuid),
  public.has_project_updates_access(uuid) to authenticated;

drop policy if exists projects_department_access on public.projects;
create policy projects_read on public.projects for select to authenticated
using (public.has_project_access(id));
create policy projects_insert on public.projects for insert to authenticated
with check (public.has_project_full_access(id));
create policy projects_update on public.projects for update to authenticated
using (public.has_project_full_access(id)) with check (public.has_project_full_access(id));
create policy projects_delete on public.projects for delete to authenticated
using (public.has_project_full_access(id));

drop policy if exists project_members_department_access on public.project_members;
create policy project_members_read on public.project_members for select to authenticated
using (public.has_project_access(project_id));
create policy project_members_write on public.project_members for all to authenticated
using (public.has_project_full_access(project_id)) with check (public.has_project_full_access(project_id));

drop policy if exists project_tasks_department_access on public.project_tasks;
create policy project_tasks_read on public.project_tasks for select to authenticated
using (public.has_project_full_access(project_id) or (
  public.has_project_access(project_id) and assignee_user_id = auth.uid()
));
create policy project_tasks_insert on public.project_tasks for insert to authenticated
with check (public.has_project_full_access(project_id));
create policy project_tasks_update on public.project_tasks for update to authenticated
using (public.has_project_full_access(project_id) or (
  public.has_project_access(project_id) and assignee_user_id = auth.uid()
)) with check (public.has_project_full_access(project_id) or assignee_user_id = auth.uid());
create policy project_tasks_delete on public.project_tasks for delete to authenticated
using (public.has_project_full_access(project_id));

drop policy if exists project_comments_department_access on public.project_comments;
create policy project_comments_access on public.project_comments for all to authenticated
using (public.has_project_updates_access(project_id))
with check (public.has_project_updates_access(project_id));

drop policy if exists project_files_department_access on public.project_files;
create policy project_files_access on public.project_files for all to authenticated
using (public.has_project_files_access(project_id))
with check (public.has_project_files_access(project_id));

drop policy if exists email_dispatches_department_access on public.email_dispatches;
create policy email_dispatches_access on public.email_dispatches for all to authenticated
using (public.has_project_full_access(project_id))
with check (public.has_project_full_access(project_id));

drop policy if exists project_files_storage_read on storage.objects;
drop policy if exists project_files_storage_insert on storage.objects;
drop policy if exists project_files_storage_delete on storage.objects;
create policy project_files_storage_read on storage.objects for select to authenticated
using (
  bucket_id = 'project-files'
  and public.has_project_files_access((storage.foldername(name))[1]::uuid)
);
create policy project_files_storage_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'project-files'
  and public.has_project_files_access((storage.foldername(name))[1]::uuid)
  and owner = auth.uid()
);
create policy project_files_storage_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'project-files'
  and public.has_project_files_access((storage.foldername(name))[1]::uuid)
  and owner = auth.uid()
);

create table if not exists public.construction_public_links (
  construction_id uuid primary key references public.constructions(id) on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_construction_public_links_updated_at
before update on public.construction_public_links
for each row execute function public.set_updated_at();

alter table public.construction_public_links enable row level security;
create policy construction_public_links_department_access
on public.construction_public_links for all to authenticated
using (public.has_department_access('obras'))
with check (public.has_department_access('obras'));
grant select, insert, update, delete on public.construction_public_links to authenticated;

-- Envios públicos não têm auth.uid(). O token continua sendo validado apenas no
-- servidor com service role; estas colunas identificam corretamente a origem.
alter table public.construction_evidence
  alter column uploaded_by drop not null,
  add column if not exists submission_source text not null default 'authenticated'
    check (submission_source in ('authenticated', 'public_link'));
alter table public.construction_updates
  alter column created_by drop not null,
  add column if not exists edited_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.validate_evidence_before_progress()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  valid_evidence boolean;
begin
  if current_setting('app.editing_construction_update', true) = 'true' then
    return new;
  end if;
  if new.progress_percent is distinct from old.progress_percent then
    select exists (
      select 1 from public.construction_evidence e
      where e.id = new.last_evidence_id
        and e.micro_stage_id = old.id
        and e.used_at is null
    ) into valid_evidence;
    if not coalesce(valid_evidence, false) then
      raise exception using message = 'evidence_required';
    end if;
    update public.construction_evidence set used_at = now() where id = new.last_evidence_id;
  end if;
  return new;
end;
$$;

create or replace function public.log_construction_progress()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  evidence_note text;
begin
  if current_setting('app.editing_construction_update', true) = 'true' then
    return new;
  end if;
  if new.progress_percent is distinct from old.progress_percent then
    select note into evidence_note from public.construction_evidence where id = new.last_evidence_id;
    insert into public.construction_updates (
      construction_id, macro_stage_id, micro_stage_id, evidence_id,
      progress_percent, note, created_by
    )
    select m.construction_id, new.macro_stage_id, new.id, new.last_evidence_id,
      new.progress_percent, evidence_note, auth.uid()
    from public.construction_macro_stages m where m.id = new.macro_stage_id;
  end if;
  return new;
end;
$$;

create or replace function public.edit_construction_progress_update(
  p_update_id uuid,
  p_progress_percent numeric,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_update public.construction_updates%rowtype;
  is_latest boolean;
begin
  if not public.has_department_access('obras') then raise exception 'forbidden'; end if;
  if p_progress_percent < 0 or p_progress_percent > 100 then raise exception 'invalid_progress'; end if;
  if char_length(coalesce(p_note, '')) > 1500 then raise exception 'note_too_long'; end if;

  select * into selected_update from public.construction_updates where id = p_update_id;
  if selected_update.id is null then raise exception 'update_not_found'; end if;

  select not exists (
    select 1 from public.construction_updates newer
    where newer.micro_stage_id = selected_update.micro_stage_id
      and (newer.created_at, newer.id) > (selected_update.created_at, selected_update.id)
  ) into is_latest;

  update public.construction_updates
  set progress_percent = p_progress_percent,
      note = nullif(btrim(p_note), ''),
      edited_by = auth.uid(),
      updated_at = now()
  where id = p_update_id;
  update public.construction_evidence
  set note = nullif(btrim(p_note), '')
  where id = selected_update.evidence_id;

  if is_latest then
    perform set_config('app.editing_construction_update', 'true', true);
    update public.construction_micro_stages
    set progress_percent = p_progress_percent
    where id = selected_update.micro_stage_id;
  end if;
end;
$$;

revoke all on function public.edit_construction_progress_update(uuid, numeric, text) from public;
grant execute on function public.edit_construction_progress_update(uuid, numeric, text) to authenticated;

create or replace function public.delete_construction_micro_stage(p_micro_stage_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  paths text[];
begin
  if not public.has_department_access('obras') then raise exception 'forbidden'; end if;
  select coalesce(array_agg(evidence.file_path), array[]::text[]) into paths
  from public.construction_evidence evidence where evidence.micro_stage_id = p_micro_stage_id;
  delete from public.construction_updates where micro_stage_id = p_micro_stage_id;
  delete from public.construction_evidence where micro_stage_id = p_micro_stage_id;
  delete from public.construction_micro_stages where id = p_micro_stage_id;
  if not found then raise exception 'micro_stage_not_found'; end if;
  return paths;
end;
$$;

create or replace function public.delete_construction_macro_stage(p_macro_stage_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  paths text[];
begin
  if not public.has_department_access('obras') then raise exception 'forbidden'; end if;
  select coalesce(array_agg(evidence.file_path), array[]::text[]) into paths
  from public.construction_evidence evidence
  join public.construction_micro_stages micro on micro.id = evidence.micro_stage_id
  where micro.macro_stage_id = p_macro_stage_id;
  delete from public.construction_updates where macro_stage_id = p_macro_stage_id;
  delete from public.construction_evidence evidence using public.construction_micro_stages micro
  where evidence.micro_stage_id = micro.id and micro.macro_stage_id = p_macro_stage_id;
  delete from public.construction_macro_stages where id = p_macro_stage_id;
  if not found then raise exception 'macro_stage_not_found'; end if;
  return paths;
end;
$$;

revoke all on function public.delete_construction_micro_stage(uuid) from public;
revoke all on function public.delete_construction_macro_stage(uuid) from public;
grant execute on function public.delete_construction_micro_stage(uuid), public.delete_construction_macro_stage(uuid) to authenticated;

commit;
