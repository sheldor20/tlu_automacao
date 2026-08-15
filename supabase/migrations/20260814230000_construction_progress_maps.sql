begin;

create table public.construction_plan_documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete set null,
  construction_id uuid references public.constructions(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 160),
  category text not null check (category in (
    'urbanistico', 'pavimentacao', 'eletrica_iluminacao',
    'drenagem_pluvial', 'agua_esgoto', 'parques_paisagismo'
  )),
  file_path text not null unique,
  file_name text not null check (char_length(btrim(file_name)) between 1 and 240),
  mime_type text not null default 'application/pdf' check (mime_type = 'application/pdf'),
  page_number integer not null default 1 check (page_number > 0),
  page_aspect_ratio numeric(12,8) check (page_aspect_ratio > 0 and page_aspect_ratio <= 2),
  calibration_points jsonb not null default '[]'::jsonb check (jsonb_typeof(calibration_points) = 'array'),
  calibration_distance_m numeric(14,3) check (calibration_distance_m > 0),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approved_plan_requires_calibration check (
    status = 'draft' or (
      page_aspect_ratio is not null
      and calibration_distance_m is not null
      and jsonb_array_length(calibration_points) = 2
    )
  )
);

create index construction_plan_documents_business_idx
  on public.construction_plan_documents(business_id, created_at desc);
create index construction_plan_documents_construction_idx
  on public.construction_plan_documents(construction_id, created_at desc);

create table public.construction_plan_layers (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.construction_plan_documents(id) on delete cascade,
  construction_id uuid not null references public.constructions(id) on delete cascade,
  micro_stage_id uuid not null references public.construction_micro_stages(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 2 and 140),
  discipline text not null check (discipline in (
    'vias_asfalto', 'eletrica_iluminacao', 'drenagem_pluvial',
    'agua_esgoto', 'parques_paisagismo'
  )),
  measurement_type text not null check (measurement_type in ('linear', 'area')),
  unit text not null check (unit in ('m', 'm2')),
  color text not null default '#31523f' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  planned_paths jsonb not null default '[]'::jsonb check (jsonb_typeof(planned_paths) = 'array'),
  executed_paths jsonb not null default '[]'::jsonb check (jsonb_typeof(executed_paths) = 'array'),
  planned_measure numeric(16,3) not null default 0 check (planned_measure >= 0),
  executed_measure numeric(16,3) not null default 0 check (executed_measure >= 0),
  progress_percent numeric(5,2) not null default 0 check (progress_percent between 0 and 100),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, name),
  unique (micro_stage_id),
  constraint plan_layer_measurement_unit check (
    (measurement_type = 'linear' and unit = 'm')
    or (measurement_type = 'area' and unit = 'm2')
  ),
  constraint plan_layer_executed_not_above_planned check (
    planned_measure = 0 or executed_measure <= planned_measure + 0.01
  )
);

create index construction_plan_layers_document_idx
  on public.construction_plan_layers(document_id, created_at);
create index construction_plan_layers_construction_idx
  on public.construction_plan_layers(construction_id, updated_at desc);

create table public.construction_plan_updates (
  id uuid primary key default gen_random_uuid(),
  layer_id uuid not null references public.construction_plan_layers(id) on delete cascade,
  evidence_id uuid not null unique references public.construction_evidence(id) on delete restrict,
  added_paths jsonb not null default '[]'::jsonb check (jsonb_typeof(added_paths) = 'array'),
  executed_measure numeric(16,3) not null check (executed_measure >= 0),
  progress_percent numeric(5,2) not null check (progress_percent between 0 and 100),
  note text check (char_length(note) <= 1500),
  source text not null default 'authenticated' check (source in ('authenticated', 'public_link')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index construction_plan_updates_layer_idx
  on public.construction_plan_updates(layer_id, created_at desc);

create trigger set_construction_plan_documents_updated_at
before update on public.construction_plan_documents
for each row execute function public.set_updated_at();

create trigger set_construction_plan_layers_updated_at
before update on public.construction_plan_layers
for each row execute function public.set_updated_at();

create or replace function public.validate_construction_plan_layer_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  document_construction_id uuid;
  micro_construction_id uuid;
begin
  select document.construction_id into document_construction_id
  from public.construction_plan_documents document
  where document.id = new.document_id;

  select macro.construction_id into micro_construction_id
  from public.construction_micro_stages micro
  join public.construction_macro_stages macro on macro.id = micro.macro_stage_id
  where micro.id = new.micro_stage_id;

  if document_construction_id is null then raise exception 'plan_document_not_linked_to_construction'; end if;
  if micro_construction_id is null or micro_construction_id is distinct from document_construction_id then
    raise exception 'plan_layer_micro_stage_mismatch';
  end if;
  new.construction_id := document_construction_id;
  return new;
end;
$$;

create trigger validate_construction_plan_layer_before_write
before insert or update of document_id, micro_stage_id, construction_id
on public.construction_plan_layers
for each row execute function public.validate_construction_plan_layer_links();

create or replace function public.link_plan_document_to_construction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.business_id is not null and new.construction_id is null then
    select construction.id into new.construction_id
    from public.constructions construction
    where construction.source_business_id = new.business_id;
  end if;
  return new;
end;
$$;

create trigger link_plan_document_before_write
before insert or update of business_id on public.construction_plan_documents
for each row execute function public.link_plan_document_to_construction();

create or replace function public.attach_business_plans_to_construction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_business_id is not null then
    update public.construction_plan_documents
    set construction_id = new.id
    where business_id = new.source_business_id and construction_id is null;
  end if;
  return new;
end;
$$;

create trigger attach_business_plans_after_construction
after insert on public.constructions
for each row execute function public.attach_business_plans_to_construction();

update public.construction_plan_documents document
set construction_id = construction.id
from public.constructions construction
where document.business_id = construction.source_business_id
  and document.construction_id is null;

create or replace function public.can_access_construction_plan_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.construction_plan_documents document
    where document.id = p_document_id
      and (
        (document.business_id is not null and public.has_department_access('novos-negocios'))
        or (document.construction_id is not null and public.has_department_access('obras'))
      )
  );
$$;

create or replace function public.can_access_construction_plan_storage_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  document_text text := split_part(p_name, '/', 1);
begin
  if document_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  return public.can_access_construction_plan_document(document_text::uuid);
end;
$$;

alter table public.construction_plan_documents enable row level security;
alter table public.construction_plan_layers enable row level security;
alter table public.construction_plan_updates enable row level security;

create policy construction_plan_documents_access
on public.construction_plan_documents for all to authenticated
using (
  (business_id is not null and public.has_department_access('novos-negocios'))
  or (construction_id is not null and public.has_department_access('obras'))
)
with check (
  (business_id is not null and public.has_department_access('novos-negocios'))
  or (construction_id is not null and public.has_department_access('obras'))
);

create policy construction_plan_layers_access
on public.construction_plan_layers for all to authenticated
using (public.has_department_access('obras'))
with check (public.has_department_access('obras'));

create policy construction_plan_updates_access
on public.construction_plan_updates for select to authenticated
using (public.has_department_access('obras'));

grant select, insert, update, delete on public.construction_plan_documents to authenticated;
grant select, insert, update, delete on public.construction_plan_layers to authenticated;
grant select on public.construction_plan_updates to authenticated;
revoke all on function public.can_access_construction_plan_document(uuid) from public;
revoke all on function public.can_access_construction_plan_storage_object(text) from public;
grant execute on function public.can_access_construction_plan_document(uuid) to authenticated;
grant execute on function public.can_access_construction_plan_storage_object(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('construction-plans', 'construction-plans', false, 52428800, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists construction_plans_storage_read on storage.objects;
drop policy if exists construction_plans_storage_insert on storage.objects;
drop policy if exists construction_plans_storage_update on storage.objects;
drop policy if exists construction_plans_storage_delete on storage.objects;

create policy construction_plans_storage_read
on storage.objects for select to authenticated
using (
  bucket_id = 'construction-plans'
  and public.can_access_construction_plan_storage_object(name)
);

create policy construction_plans_storage_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'construction-plans'
  and public.can_access_construction_plan_storage_object(name)
  and owner = auth.uid()
);

create policy construction_plans_storage_update
on storage.objects for update to authenticated
using (
  bucket_id = 'construction-plans'
  and public.can_access_construction_plan_storage_object(name)
  and owner = auth.uid()
)
with check (
  bucket_id = 'construction-plans'
  and public.can_access_construction_plan_storage_object(name)
  and owner = auth.uid()
);

create policy construction_plans_storage_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'construction-plans'
  and (owner = auth.uid() or public.can_access_construction_plan_storage_object(name))
);

create or replace function public.apply_construction_plan_progress(
  p_layer_id uuid,
  p_evidence_id uuid,
  p_base_layer_updated_at timestamptz,
  p_base_micro_updated_at timestamptz,
  p_executed_paths jsonb,
  p_added_paths jsonb,
  p_executed_measure numeric,
  p_progress_percent numeric,
  p_note text,
  p_submission_source text default 'authenticated'
)
returns table (
  layer_updated_at timestamptz,
  micro_stage_updated_at timestamptz,
  progress_percent numeric,
  executed_measure numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_layer public.construction_plan_layers%rowtype;
  evidence_construction_id uuid;
  evidence_micro_stage_id uuid;
  selected_document_status text;
  updated_layer_at timestamptz;
  updated_micro_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.has_department_access('obras') then
    raise exception 'forbidden';
  end if;
  if p_submission_source not in ('authenticated', 'public_link') then raise exception 'invalid_source'; end if;
  if jsonb_typeof(p_executed_paths) <> 'array' or jsonb_typeof(p_added_paths) <> 'array' then
    raise exception 'invalid_paths';
  end if;
  if p_progress_percent < 0 or p_progress_percent > 100 or p_executed_measure < 0 then
    raise exception 'invalid_measurement';
  end if;
  if char_length(coalesce(p_note, '')) > 1500 then raise exception 'note_too_long'; end if;

  select layer.*
  into selected_layer
  from public.construction_plan_layers layer
  join public.construction_plan_documents document on document.id = layer.document_id
  where layer.id = p_layer_id
  for update of layer;

  if selected_layer.id is null then raise exception 'plan_layer_not_found'; end if;
  select document.status into selected_document_status
  from public.construction_plan_documents document
  where document.id = selected_layer.document_id;
  if selected_document_status <> 'approved' then raise exception 'plan_not_approved'; end if;
  if selected_layer.updated_at is distinct from p_base_layer_updated_at then raise exception 'stale_map_layer'; end if;
  if selected_layer.planned_measure <= 0 or p_executed_measure > selected_layer.planned_measure + 0.01 then
    raise exception 'invalid_executed_measure';
  end if;
  if abs(p_progress_percent - least(100, p_executed_measure / selected_layer.planned_measure * 100)) > 0.15 then
    raise exception 'invalid_progress_calculation';
  end if;

  select evidence.construction_id, evidence.micro_stage_id
  into evidence_construction_id, evidence_micro_stage_id
  from public.construction_evidence evidence
  where evidence.id = p_evidence_id;
  if evidence_construction_id is distinct from selected_layer.construction_id
     or evidence_micro_stage_id is distinct from selected_layer.micro_stage_id then
    raise exception 'invalid_plan_evidence';
  end if;
  if not exists (
    select 1 from public.construction_micro_stages micro
    where micro.id = selected_layer.micro_stage_id
      and micro.updated_at = p_base_micro_updated_at
  ) then
    raise exception 'stale_micro_stage';
  end if;

  update public.construction_plan_layers
  set executed_paths = p_executed_paths,
      executed_measure = p_executed_measure,
      progress_percent = p_progress_percent
  where id = selected_layer.id
  returning updated_at into updated_layer_at;

  update public.construction_micro_stages
  set progress_percent = p_progress_percent,
      last_evidence_id = p_evidence_id
  where id = selected_layer.micro_stage_id
  returning updated_at into updated_micro_at;

  update public.construction_evidence
  set used_at = coalesce(used_at, now()),
      submission_completed_at = case when p_submission_source = 'public_link' then now() else submission_completed_at end
  where id = p_evidence_id;

  insert into public.construction_plan_updates (
    layer_id, evidence_id, added_paths, executed_measure,
    progress_percent, note, source, created_by
  ) values (
    selected_layer.id, p_evidence_id, p_added_paths, p_executed_measure,
    p_progress_percent, nullif(btrim(p_note), ''), p_submission_source, auth.uid()
  );

  return query select updated_layer_at, updated_micro_at, p_progress_percent, p_executed_measure;
end;
$$;

revoke all on function public.apply_construction_plan_progress(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, numeric, numeric, text, text
) from public;
grant execute on function public.apply_construction_plan_progress(
  uuid, uuid, timestamptz, timestamptz, jsonb, jsonb, numeric, numeric, text, text
) to authenticated, service_role;

comment on table public.construction_plan_documents is
  'Pranchas PDF versionadas desde Novos Negócios e reaproveitadas na execução da obra.';
comment on table public.construction_plan_layers is
  'Camadas calibradas com geometria planejada e executada para medição física.';
comment on table public.construction_plan_updates is
  'Histórico auditável de cada traçado executado com sua evidência de campo.';

commit;
