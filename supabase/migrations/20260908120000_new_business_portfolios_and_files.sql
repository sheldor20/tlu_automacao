-- Carteiras de Novos Negócios, anexos multimídia e localização por KMZ.

begin;

alter table public.businesses
  add column if not exists portfolio_section text not null default 'esteira_negocios',
  add column if not exists location_file_path text,
  add column if not exists location_file_name text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'businesses_portfolio_section_check'
      and conrelid = 'public.businesses'::regclass
  ) then
    alter table public.businesses
      add constraint businesses_portfolio_section_check
      check (portfolio_section in ('prospeccao', 'esteira_negocios', 'landing_bank'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'businesses_location_file_check'
      and conrelid = 'public.businesses'::regclass
  ) then
    alter table public.businesses
      add constraint businesses_location_file_check
      check (
        (location_file_path is null and location_file_name is null)
        or (
          location_file_path is not null
          and location_file_name is not null
          and split_part(location_file_path, '/', 1) = id::text
          and lower(location_file_path) like '%.kmz'
          and lower(location_file_name) like '%.kmz'
          and char_length(location_file_name) between 5 and 240
        )
      );
  end if;
end;
$$;

create index if not exists businesses_portfolio_section_idx
  on public.businesses(portfolio_section, archived_at, updated_at desc);

create table if not exists public.business_files (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  file_path text not null unique,
  file_name text not null check (char_length(btrim(file_name)) between 1 and 240),
  mime_type text not null check (
    mime_type = 'application/pdf'
    or mime_type like 'image/%'
    or mime_type like 'video/%'
  ),
  size_bytes bigint not null check (size_bytes between 1 and 104857600),
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint business_files_path_matches_business
    check (split_part(file_path, '/', 1) = business_id::text)
);

create index if not exists business_files_business_date_idx
  on public.business_files(business_id, created_at desc);

create or replace function public.prevent_business_delete_outside_prospecting()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.portfolio_section <> 'prospeccao' then
    raise exception 'business_delete_only_allowed_in_prospeccao';
  end if;
  return old;
end;
$$;

drop trigger if exists restrict_business_delete_to_prospecting on public.businesses;
create trigger restrict_business_delete_to_prospecting
before delete on public.businesses
for each row execute function public.prevent_business_delete_outside_prospecting();

create or replace view public.business_operational_summary
with (security_invoker = true)
as
select
  business.id,
  business.name,
  business.start_date,
  business.stage,
  business.address,
  business.city,
  business.state,
  business.latitude,
  business.longitude,
  business.potential_vgv,
  business.notes,
  business.created_by,
  business.created_at,
  business.updated_at,
  business.project_id,
  business.archived_at,
  business.archived_by,
  history.entered_at as current_stage_entered_at,
  floor(extract(epoch from (now() - history.entered_at)) / 86400)::integer as days_in_stage,
  business.property_registration,
  business.portfolio_section,
  business.location_file_path,
  business.location_file_name
from public.businesses business
left join public.business_stage_history history
  on history.business_id = business.id and history.exited_at is null;

alter table public.business_files enable row level security;

drop policy if exists business_files_department_access on public.business_files;
create policy business_files_department_access
on public.business_files for all to authenticated
using (public.has_department_access('novos-negocios'))
with check (public.has_department_access('novos-negocios'));

grant select on public.business_operational_summary to authenticated;
grant select, insert, update, delete on public.business_files to authenticated;

create or replace function public.can_access_business_storage_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  business_text text := split_part(p_name, '/', 1);
begin
  if business_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  return public.has_department_access('novos-negocios') and exists (
    select 1 from public.businesses business where business.id = business_text::uuid
  );
end;
$$;

revoke all on function public.can_access_business_storage_object(text) from public;
grant execute on function public.can_access_business_storage_object(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'business-files',
  'business-files',
  false,
  104857600,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/mpeg'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'business-locations',
  'business-locations',
  false,
  20971520,
  array['application/vnd.google-earth.kmz']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists business_files_storage_read on storage.objects;
drop policy if exists business_files_storage_insert on storage.objects;
drop policy if exists business_files_storage_update on storage.objects;
drop policy if exists business_files_storage_delete on storage.objects;

create policy business_files_storage_read
on storage.objects for select to authenticated
using (bucket_id = 'business-files' and public.can_access_business_storage_object(name));

create policy business_files_storage_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'business-files'
  and public.can_access_business_storage_object(name)
  and owner = auth.uid()
);

create policy business_files_storage_update
on storage.objects for update to authenticated
using (bucket_id = 'business-files' and public.can_access_business_storage_object(name))
with check (bucket_id = 'business-files' and public.can_access_business_storage_object(name));

create policy business_files_storage_delete
on storage.objects for delete to authenticated
using (bucket_id = 'business-files' and public.can_access_business_storage_object(name));

drop policy if exists business_locations_storage_read on storage.objects;
drop policy if exists business_locations_storage_insert on storage.objects;
drop policy if exists business_locations_storage_update on storage.objects;
drop policy if exists business_locations_storage_delete on storage.objects;

create policy business_locations_storage_read
on storage.objects for select to authenticated
using (bucket_id = 'business-locations' and public.can_access_business_storage_object(name));

create policy business_locations_storage_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'business-locations'
  and public.has_department_access('novos-negocios')
  and split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  and owner = auth.uid()
);

create policy business_locations_storage_update
on storage.objects for update to authenticated
using (bucket_id = 'business-locations' and public.can_access_business_storage_object(name))
with check (bucket_id = 'business-locations' and public.can_access_business_storage_object(name));

create policy business_locations_storage_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'business-locations'
  and public.has_department_access('novos-negocios')
  and split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
);

comment on column public.businesses.portfolio_section is
  'Carteira de Novos Negócios: Prospecção, Esteira de negócios ou Landing Bank.';
comment on column public.businesses.location_file_path is
  'Caminho privado do KMZ usado para localizar a área.';
comment on table public.business_files is
  'Imagens, PDFs e vídeos anexados a um negócio.';

commit;
