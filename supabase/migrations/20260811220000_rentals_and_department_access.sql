-- Departamento de Aluguéis e controle de acesso por usuário.
-- Execute depois de 20260811203000_operational_archiving_supplies_and_user_directory.sql.
-- IMPORTANTE: no SQL Editor do Supabase, selecione a role `postgres`.

begin;

do $$
begin
  if current_user <> 'postgres' and not pg_has_role(current_user, 'postgres', 'member') then
    raise exception using
      errcode = '42501',
      message = 'migration_requires_postgres_role',
      hint = 'No SQL Editor do Supabase, altere Role de authenticated para postgres e execute novamente.';
  end if;
end;
$$;

insert into public.departments (slug, name, position)
values ('alugueis', 'Aluguéis', 4)
on conflict (slug) do update set name = excluded.name, position = excluded.position;

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- Mantém o primeiro usuário da organização como administrador inicial. Depois
-- disso, os administradores podem promover outros usuários pela interface.
update public.profiles profile
set is_admin = true
where profile.user_id = (
  select users.id
  from auth.users users
  order by users.created_at, users.id
  limit 1
)
and not exists (select 1 from public.profiles where is_admin);

-- Preserva o comportamento atual na ativação da migration: usuários existentes
-- começam com os quatro departamentos e podem ser restringidos pelo administrador.
insert into public.profile_departments (user_id, department_slug, access_level)
select profile.user_id, department.slug, 'member'
from public.profiles profile
cross join public.departments department
where profile.active
on conflict (user_id, department_slug) do nothing;

create type public.rental_status as enum ('alugado', 'desocupado', 'aguardando_reforma');
create type public.lessor_type as enum ('pf', 'pj');

create table public.rentals (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 140),
  property_address text not null check (char_length(btrim(property_address)) between 5 and 260),
  status public.rental_status not null default 'desocupado',
  monthly_rent numeric(18,2) not null default 0 check (monthly_rent >= 0),
  lessor_type public.lessor_type not null,
  lessor_name text not null check (char_length(btrim(lessor_name)) between 2 and 160),
  lease_start_date date,
  lease_end_date date,
  annual_adjustment_percent numeric(7,4) not null default 0 check (annual_adjustment_percent between 0 and 100),
  broker_name text check (broker_name is null or char_length(btrim(broker_name)) between 2 and 160),
  broker_commission numeric(18,2) not null default 0 check (broker_commission >= 0),
  notes text check (notes is null or char_length(notes) <= 3000),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_rental_dates check (lease_end_date is null or lease_start_date is not null),
  constraint valid_rental_date_order check (lease_end_date is null or lease_end_date >= lease_start_date),
  constraint rented_requires_start_date check (status <> 'alugado' or lease_start_date is not null),
  constraint commission_not_above_rent check (broker_commission <= monthly_rent)
);

create index rentals_status_idx on public.rentals(status, updated_at desc);
create index rentals_lease_dates_idx on public.rentals(lease_start_date, lease_end_date);

create trigger set_rentals_updated_at
before update on public.rentals
for each row execute function public.set_updated_at();

-- Retorna o resultado do ano, mês a mês. O valor do aluguel é reajustado a cada
-- aniversário anual do contrato e a comissão mensal é deduzida do valor bruto.
create or replace function public.rental_monthly_summary(p_year integer)
returns table (
  reference_month date,
  rented_properties integer,
  gross_rent numeric,
  broker_commission numeric,
  net_rent numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with months as (
    select generate_series(
      make_date(p_year, 1, 1),
      make_date(p_year, 12, 1),
      interval '1 month'
    )::date as reference_month
  ), calculated as (
    select
      month.reference_month,
      rental.id,
      case
        when rental.id is null then 0::numeric
        else round(
          rental.monthly_rent * power(
            1 + rental.annual_adjustment_percent / 100,
            greatest(
              0,
              floor(
                (
                  (extract(year from month.reference_month) - extract(year from rental.lease_start_date)) * 12
                  + extract(month from month.reference_month) - extract(month from rental.lease_start_date)
                ) / 12
              )
            )
          ),
          2
        )
      end as adjusted_rent,
      coalesce(rental.broker_commission, 0) as commission
    from months month
    left join public.rentals rental
      on rental.status = 'alugado'
      and rental.lease_start_date <= (month.reference_month + interval '1 month - 1 day')::date
      and (rental.lease_end_date is null or rental.lease_end_date >= month.reference_month)
  )
  select
    calculated.reference_month,
    count(calculated.id)::integer as rented_properties,
    coalesce(sum(calculated.adjusted_rent), 0)::numeric(18,2) as gross_rent,
    coalesce(sum(calculated.commission), 0)::numeric(18,2) as broker_commission,
    coalesce(sum(greatest(calculated.adjusted_rent - calculated.commission, 0)), 0)::numeric(18,2) as net_rent
  from calculated
  group by calculated.reference_month
  order by calculated.reference_month;
$$;

-- Funções centrais de autorização. SECURITY DEFINER evita recursão das próprias
-- políticas de profiles/profile_departments e nunca expõe auth.users.
create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.user_id = auth.uid()
      and profile.active
      and profile.is_admin
  );
$$;

create or replace function public.has_department_access(p_department_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.user_id = auth.uid()
      and profile.active
      and (
        profile.is_admin
        or exists (
          select 1
          from public.profile_departments access
          where access.user_id = profile.user_id
            and access.department_slug = p_department_slug
        )
      )
  );
$$;

-- Novos Negócios precisa selecionar o projeto relacionado mesmo quando o usuário
-- não possui a visão completa do departamento Projetos. A função expõe somente
-- os quatro campos mínimos e apenas para quem pode acessar Novos Negócios.
create or replace function public.business_project_options()
returns table (
  id uuid,
  name text,
  status public.project_status,
  archived_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select project.id, project.name, project.status, project.archived_at
  from public.projects project
  where public.has_department_access('novos-negocios')
    and project.archived_at is null
    and project.status in ('ativo', 'concluido')
  order by project.name;
$$;

revoke all on function public.is_system_admin() from public;
revoke all on function public.has_department_access(text) from public;
revoke all on function public.business_project_options() from public;
grant execute on function public.is_system_admin(), public.has_department_access(text), public.business_project_options() to authenticated;

-- A passagem de um negócio para Obra cria o registro no outro departamento. O
-- trigger precisa concluir essa automação mesmo quando o usuário não enxerga Obras.
alter function public.track_business_stage() security definer;

alter table public.rentals enable row level security;

-- Diretório de usuários: todos podem selecionar usuários ativos para responsáveis;
-- somente administradores enxergam inativos e administram as permissões.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
for select to authenticated
using (active or user_id = auth.uid() or public.is_system_admin());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists profile_departments_authenticated on public.profile_departments;
create policy profile_departments_read on public.profile_departments
for select to authenticated
using (user_id = auth.uid() or public.is_system_admin());

create policy profile_departments_admin_insert on public.profile_departments
for insert to authenticated
with check (public.is_system_admin());

create policy profile_departments_admin_update on public.profile_departments
for update to authenticated
using (public.is_system_admin())
with check (public.is_system_admin());

create policy profile_departments_admin_delete on public.profile_departments
for delete to authenticated
using (public.is_system_admin());

-- Substitui as permissões amplas do MVP por autorização real por departamento.
drop policy if exists businesses_authenticated on public.businesses;
drop policy if exists business_history_authenticated on public.business_stage_history;
drop policy if exists business_steps_authenticated on public.business_phase_steps;
drop policy if exists constructions_authenticated on public.constructions;
drop policy if exists macro_stages_authenticated on public.construction_macro_stages;
drop policy if exists micro_stages_authenticated on public.construction_micro_stages;
drop policy if exists evidence_authenticated on public.construction_evidence;
drop policy if exists budgets_authenticated on public.construction_budgets;
drop policy if exists construction_updates_authenticated on public.construction_updates;
drop policy if exists projects_authenticated on public.projects;
drop policy if exists project_members_authenticated on public.project_members;
drop policy if exists project_tasks_authenticated on public.project_tasks;
drop policy if exists project_comments_authenticated on public.project_comments;
drop policy if exists project_files_authenticated on public.project_files;
drop policy if exists email_dispatches_authenticated on public.email_dispatches;

create policy businesses_department_access on public.businesses
for all to authenticated
using (public.has_department_access('novos-negocios'))
with check (public.has_department_access('novos-negocios'));
create policy business_history_department_access on public.business_stage_history
for all to authenticated
using (public.has_department_access('novos-negocios'))
with check (public.has_department_access('novos-negocios'));
create policy business_steps_department_access on public.business_phase_steps
for all to authenticated
using (public.has_department_access('novos-negocios'))
with check (public.has_department_access('novos-negocios'));

create policy constructions_department_access on public.constructions
for all to authenticated
using (public.has_department_access('obras'))
with check (public.has_department_access('obras'));
create policy macro_stages_department_access on public.construction_macro_stages
for all to authenticated
using (public.has_department_access('obras'))
with check (public.has_department_access('obras'));
create policy micro_stages_department_access on public.construction_micro_stages
for all to authenticated
using (public.has_department_access('obras'))
with check (public.has_department_access('obras'));
create policy evidence_department_access on public.construction_evidence
for all to authenticated
using (public.has_department_access('obras'))
with check (public.has_department_access('obras'));
create policy budgets_department_access on public.construction_budgets
for all to authenticated
using (public.has_department_access('obras'))
with check (public.has_department_access('obras'));
create policy construction_updates_department_access on public.construction_updates
for all to authenticated
using (public.has_department_access('obras'))
with check (public.has_department_access('obras'));

create policy projects_department_access on public.projects
for all to authenticated
using (public.has_department_access('projetos'))
with check (public.has_department_access('projetos'));
create policy project_members_department_access on public.project_members
for all to authenticated
using (public.has_department_access('projetos'))
with check (public.has_department_access('projetos'));
create policy project_tasks_department_access on public.project_tasks
for all to authenticated
using (public.has_department_access('projetos'))
with check (public.has_department_access('projetos'));
create policy project_comments_department_access on public.project_comments
for all to authenticated
using (public.has_department_access('projetos'))
with check (public.has_department_access('projetos'));
create policy project_files_department_access on public.project_files
for all to authenticated
using (public.has_department_access('projetos'))
with check (public.has_department_access('projetos'));
create policy email_dispatches_department_access on public.email_dispatches
for all to authenticated
using (public.has_department_access('projetos'))
with check (public.has_department_access('projetos'));

create policy rentals_department_access on public.rentals
for all to authenticated
using (public.has_department_access('alugueis'))
with check (public.has_department_access('alugueis'));

-- Os objetos privados de storage seguem as mesmas autorizações de departamento.
drop policy if exists construction_evidence_storage_read on storage.objects;
drop policy if exists construction_evidence_storage_insert on storage.objects;
drop policy if exists construction_evidence_storage_delete on storage.objects;
drop policy if exists project_files_storage_read on storage.objects;
drop policy if exists project_files_storage_insert on storage.objects;
drop policy if exists project_files_storage_delete on storage.objects;

create policy construction_evidence_storage_read on storage.objects
for select to authenticated using (
  bucket_id = 'construction-evidence' and public.has_department_access('obras')
);
create policy construction_evidence_storage_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'construction-evidence'
  and public.has_department_access('obras')
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
);
create policy construction_evidence_storage_delete on storage.objects
for delete to authenticated using (
  bucket_id = 'construction-evidence' and public.has_department_access('obras')
);
create policy project_files_storage_read on storage.objects
for select to authenticated using (
  bucket_id = 'project-files' and public.has_department_access('projetos')
);
create policy project_files_storage_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'project-files'
  and public.has_department_access('projetos')
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx')
);
create policy project_files_storage_delete on storage.objects
for delete to authenticated using (
  bucket_id = 'project-files' and public.has_department_access('projetos')
);

grant select, insert, update, delete on public.rentals to authenticated;
grant execute on function public.rental_monthly_summary(integer) to authenticated;

-- Bloqueia alterações de privilégios no navegador. Nome próprio continua editável;
-- administração de usuários usa exclusivamente o endpoint protegido do servidor.
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

commit;
