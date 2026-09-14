-- Cada vistoria mantém seu registro para histórico e sincronização, com foto opcional.
-- Os anexos existentes e a validação de vínculo entre obra e microetapa são preservados.
alter table public.construction_evidence
  alter column file_path drop not null,
  alter column file_name drop not null;

alter table public.construction_evidence
  add constraint construction_evidence_optional_photo_pair
  check ((file_path is null) = (file_name is null));

comment on column public.construction_evidence.file_path is
  'Foto opcional da vistoria; nulo quando o registro foi enviado sem imagem.';

-- Registrar também vistorias sem alteração de percentual, preservando comentários.
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
  if new.progress_percent is distinct from old.progress_percent
     or (new.last_evidence_id is not null and new.last_evidence_id is distinct from old.last_evidence_id) then
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
  if new.progress_percent is distinct from old.progress_percent
     or (new.last_evidence_id is not null and new.last_evidence_id is distinct from old.last_evidence_id) then
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

