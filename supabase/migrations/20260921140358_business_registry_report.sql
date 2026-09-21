begin;

alter table public.businesses
  add column registration_file_path text,
  add column registration_file_name text,
  add column area_image_path text,
  add column area_image_name text,
  add constraint businesses_registration_document check (
    (registration_file_path is null and registration_file_name is null) or
    (registration_file_path is not null and registration_file_name is not null
     and property_registration is not null
     and registration_file_path like id::text || '/matricula/%.pdf'
     and char_length(registration_file_name) between 1 and 240)
  ),
  add constraint businesses_area_image check (
    (area_image_path is null and area_image_name is null) or
    (area_image_path is not null and area_image_name is not null
     and area_image_path like id::text || '/area/%'
     and char_length(area_image_name) between 1 and 240)
  );

-- Preserve the current view columns, including fields added by other modules.
do $$
declare definition text;
begin
  definition := regexp_replace(pg_get_viewdef('public.business_operational_summary'::regclass, true), ';\s*$', '');
  execute 'create or replace view public.business_operational_summary with (security_invoker=true) as '
    || 'select previous.*, b.registration_file_path, b.registration_file_name, b.area_image_path, b.area_image_name '
    || 'from (' || definition || ') previous join public.businesses b on b.id=previous.id';
end $$;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('business-documents','business-documents',false,20971520,array['application/pdf','image/jpeg','image/png','image/webp']);

create policy business_documents_read on storage.objects for select to authenticated
using (bucket_id='business-documents' and public.has_department_access('novos-negocios')
  and (owner=(select auth.uid()) or public.can_access_business_storage_object(name)));

-- A new business uploads first; its row and document references are then saved together.
create policy business_documents_insert on storage.objects for insert to authenticated
with check (bucket_id='business-documents'
  and public.has_department_access('novos-negocios') and owner=(select auth.uid())
  and name ~ '^[0-9a-fA-F-]{36}/(matricula|area)/[0-9a-fA-F-]{36}\.(pdf|png|jpg|jpeg|webp)$');

create policy business_documents_delete on storage.objects for delete to authenticated
using (bucket_id='business-documents' and public.has_department_access('novos-negocios')
  and (owner=(select auth.uid()) or public.can_access_business_storage_object(name)));

comment on column public.businesses.registration_file_path is 'PDF privado da matrícula; número confirmado em property_registration.';
comment on column public.businesses.area_image_path is 'Imagem da área fornecida pelo usuário para o relatório, com atribuição preservada.';

commit;
