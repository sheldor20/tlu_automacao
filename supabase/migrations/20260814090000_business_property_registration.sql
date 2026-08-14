-- Matrícula opcional do imóvel em Novos Negócios.

begin;

alter table public.businesses
  add column if not exists property_registration text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'businesses_property_registration_length'
      and conrelid = 'public.businesses'::regclass
  ) then
    alter table public.businesses
      add constraint businesses_property_registration_length
      check (
        property_registration is null
        or char_length(btrim(property_registration)) between 1 and 120
      );
  end if;
end;
$$;

comment on column public.businesses.property_registration is
  'Número da matrícula do imóvel no Cartório de Registro de Imóveis.';

-- Mantém a ordem das colunas já publicadas e acrescenta a matrícula ao final da
-- visão usada pela tela de Novos Negócios.
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
  business.property_registration
from public.businesses business
left join public.business_stage_history history
  on history.business_id = business.id and history.exited_at is null;

grant select on public.business_operational_summary to authenticated;

commit;
