-- Immutable task comments and file receipts, with the same task and feature access.
create table public.project_task_activity (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  kind text not null check (kind in ('comment', 'file')),
  body text,
  file_path text unique,
  file_name text,
  file_size bigint,
  content_type text,
  author_id uuid references auth.users(id) on delete set null default auth.uid(),
  author_name text not null default '',
  created_at timestamptz not null default now(),
  constraint task_activity_content_valid check (
    (kind = 'comment' and body is not null and char_length(btrim(body)) between 1 and 4000
      and file_path is null and file_name is null and file_size is null and content_type is null)
    or
    (kind = 'file' and body is null and file_name is not null and char_length(btrim(file_name)) between 1 and 255
      and file_path is not null and file_path like task_id::text || '/files/' || id::text || '.%'
      and file_size is not null and file_size between 1 and 20971520 and content_type is not null)
  )
);
create index project_task_activity_timeline_idx on public.project_task_activity(task_id, created_at desc, id);
alter table public.project_task_activity enable row level security;
revoke all on public.project_task_activity from anon, authenticated;
grant select, insert on public.project_task_activity to authenticated;
grant all on public.project_task_activity to service_role;

create function public.can_access_project_task_activity(p_task_id uuid, p_kind text, p_write boolean default false)
returns boolean language sql stable security invoker set search_path = '' as $$
  select auth.uid() is not null
    and public.can_read_project_task(p_task_id)
    and (not p_write or public.can_manage_project_task(p_task_id))
    and case p_kind
      when 'file' then public.is_system_admin() or coalesce((
        select allow_files from public.profile_project_permissions where user_id = auth.uid()
      ), true)
      when 'comment' then public.is_system_admin() or coalesce((
        select allow_updates from public.profile_project_permissions where user_id = auth.uid()
      ), true)
      else false end;
$$;

create function public.project_task_activity_permissions(p_task_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'files', public.can_access_project_task_activity(p_task_id, 'file', true),
    'comments', public.can_access_project_task_activity(p_task_id, 'comment', true)
  );
$$;

create policy task_activity_read on public.project_task_activity for select to authenticated
using (public.can_access_project_task_activity(task_id, kind));
create policy task_activity_insert on public.project_task_activity for insert to authenticated
with check (author_id = auth.uid() and public.can_access_project_task_activity(task_id, kind, true));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-files', 'task-files', false, 20971520, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'application/zip'
]);

create function public.can_access_task_file(p_name text, p_write boolean default false)
returns boolean language sql stable security invoker set search_path = '' as $$
  select case when p_name ~ '^[0-9a-f-]{36}/files/[0-9a-f-]{36}\.[a-z0-9]+$'
    and split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.can_access_project_task_activity(split_part(p_name, '/', 1)::uuid, 'file', p_write)
    else false end;
$$;

create policy task_files_read on storage.objects for select to authenticated
using (bucket_id = 'task-files' and public.can_access_task_file(name));
create policy task_files_insert on storage.objects for insert to authenticated
with check (bucket_id = 'task-files' and owner_id = auth.uid()::text and public.can_access_task_file(name, true));
-- Only unregistered uploads can be removed. Recorded files remain in the history.
create policy task_files_cleanup on storage.objects for delete to authenticated
using (bucket_id = 'task-files' and owner_id = auth.uid()::text and public.can_access_task_file(name, true)
  and not exists (select 1 from public.project_task_activity activity where activity.file_path = name));

create function public.prepare_project_task_activity()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare object_metadata jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  new.author_id := auth.uid();
  select full_name into new.author_name from public.profiles where user_id = auth.uid();
  new.author_name := coalesce(nullif(btrim(new.author_name), ''), 'Usuário');
  new.created_at := clock_timestamp();
  if new.kind = 'comment' then
    new.body := btrim(new.body);
  elsif new.kind = 'file' then
    select metadata into object_metadata from storage.objects
    where bucket_id = 'task-files' and name = new.file_path and owner_id = auth.uid()::text;
    if object_metadata is null then raise exception 'Envie o arquivo antes de registrar o anexo.'; end if;
    new.file_size := (object_metadata->>'size')::bigint;
    new.content_type := object_metadata->>'mimetype';
    new.file_name := btrim(new.file_name);
  end if;
  return new;
end;
$$;
create trigger prepare_project_task_activity_before_insert before insert on public.project_task_activity
for each row execute function public.prepare_project_task_activity();

revoke all on function public.can_access_project_task_activity(uuid, text, boolean) from public, anon;
revoke all on function public.project_task_activity_permissions(uuid) from public, anon;
revoke all on function public.can_access_task_file(text, boolean) from public, anon;
revoke all on function public.prepare_project_task_activity() from public, anon, authenticated;
grant execute on function public.can_access_project_task_activity(uuid, text, boolean),
  public.project_task_activity_permissions(uuid), public.can_access_task_file(text, boolean) to authenticated;
