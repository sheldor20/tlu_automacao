-- Versão inicial de Processos gerada a partir de documento PDF.

begin;

alter table public.business_processes
  add column if not exists version integer not null default 1 check (version > 0),
  add column if not exists source_file_path text,
  add column if not exists source_file_name text check (source_file_name is null or char_length(btrim(source_file_name)) between 1 and 240);

create unique index if not exists business_processes_source_file_path_idx
  on public.business_processes(source_file_path)
  where source_file_path is not null;

create or replace function public.can_access_process_document_storage_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  process_text text := split_part(p_name, '/', 1);
begin
  if process_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  return exists (
    select 1
    from public.business_processes process
    where process.id = process_text::uuid
      and public.has_department_access('processos')
      and (process.status = 'publicado' or public.can_manage_processes())
  );
end;
$$;

revoke all on function public.can_access_process_document_storage_object(text) from public;
grant execute on function public.can_access_process_document_storage_object(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('process-documents', 'process-documents', false, 4194304, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists process_documents_storage_read on storage.objects;
drop policy if exists process_documents_storage_insert on storage.objects;
drop policy if exists process_documents_storage_update on storage.objects;
drop policy if exists process_documents_storage_delete on storage.objects;

create policy process_documents_storage_read
on storage.objects for select to authenticated
using (
  bucket_id = 'process-documents'
  and public.can_access_process_document_storage_object(name)
);

create policy process_documents_storage_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'process-documents'
  and public.can_manage_processes()
  and public.can_access_process_document_storage_object(name)
  and owner = auth.uid()
);

create policy process_documents_storage_update
on storage.objects for update to authenticated
using (
  bucket_id = 'process-documents'
  and public.can_manage_processes()
  and public.can_access_process_document_storage_object(name)
  and owner = auth.uid()
)
with check (
  bucket_id = 'process-documents'
  and public.can_manage_processes()
  and public.can_access_process_document_storage_object(name)
  and owner = auth.uid()
);

create policy process_documents_storage_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'process-documents'
  and public.can_manage_processes()
  and public.can_access_process_document_storage_object(name)
);

commit;
