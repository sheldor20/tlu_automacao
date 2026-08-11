-- Terra Lótus Urbanismo - schema inicial
-- Execute no Supabase SQL Editor ou através do Supabase CLI.

begin;

create extension if not exists pgcrypto with schema extensions;

create type public.business_stage as enum (
  'prospeccao',
  'viabilidade',
  'contrato',
  'viabilidade_mercadologica',
  'masterplan',
  'aprovacao',
  'obra'
);

create type public.construction_type as enum ('loteamento', 'construcao');
create type public.construction_status as enum ('planejamento', 'em_andamento', 'pausada', 'concluida');
create type public.project_status as enum ('planejamento', 'ativo', 'pausado', 'concluido');
create type public.task_status as enum ('a_fazer', 'em_andamento', 'concluida');

-- Estrutura organizacional preparada para permissões futuras. Nesta versão, as
-- políticas liberam todos os dados operacionais para qualquer usuário autenticado.
create table public.departments (
  slug text primary key,
  name text not null unique,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

insert into public.departments (slug, name, position) values
  ('novos-negocios', 'Novos negócios', 1),
  ('obras', 'Obras', 2),
  ('projetos', 'Projetos', 3);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profile_departments (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  department_slug text not null references public.departments(slug) on delete cascade,
  access_level text not null default 'member' check (access_level in ('viewer', 'member', 'manager', 'admin')),
  created_at timestamptz not null default now(),
  primary key (user_id, department_slug)
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 140),
  start_date date not null,
  stage public.business_stage not null default 'prospeccao',
  address text not null check (char_length(btrim(address)) between 2 and 220),
  city text not null check (char_length(btrim(city)) between 2 and 100),
  state char(2) not null,
  latitude numeric(9,6) check (latitude between -90 and 90),
  longitude numeric(9,6) check (longitude between -180 and 180),
  potential_vgv numeric(18,2) not null default 0 check (potential_vgv >= 0),
  notes text check (char_length(notes) <= 5000),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_stage_history (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  stage public.business_stage not null,
  entered_at timestamptz not null default now(),
  exited_at timestamptz,
  changed_by uuid not null default auth.uid() references auth.users(id),
  constraint valid_stage_interval check (exited_at is null or exited_at >= entered_at)
);

-- Estrutura para as futuras micro etapas de cada fase do funil.
create table public.business_phase_steps (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  stage public.business_stage not null,
  name text not null check (char_length(btrim(name)) between 2 and 160),
  status public.task_status not null default 'a_fazer',
  due_date date,
  position integer not null default 0,
  completed_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.constructions (
  id uuid primary key default gen_random_uuid(),
  source_business_id uuid unique references public.businesses(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 2 and 140),
  type public.construction_type not null default 'loteamento',
  start_date date not null,
  expected_end_date date,
  planned_budget numeric(18,2) not null default 0 check (planned_budget >= 0),
  address text,
  status public.construction_status not null default 'planejamento',
  notes text check (char_length(notes) <= 5000),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_construction_dates check (expected_end_date is null or expected_end_date >= start_date)
);

create table public.construction_macro_stages (
  id uuid primary key default gen_random_uuid(),
  construction_id uuid not null references public.constructions(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text check (char_length(description) <= 2000),
  weight_percent numeric(5,2) not null default 0 check (weight_percent between 0 and 100),
  position integer not null default 0,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (construction_id, name)
);

create table public.construction_micro_stages (
  id uuid primary key default gen_random_uuid(),
  macro_stage_id uuid not null references public.construction_macro_stages(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 140),
  description text check (char_length(description) <= 2000),
  progress_percent numeric(5,2) not null default 0 check (progress_percent between 0 and 100),
  position integer not null default 0,
  -- Catálogo simples no MVP: [{"name":"Concreto","quantity":10,"unit":"m³"}]
  supplies jsonb not null default '[]'::jsonb check (jsonb_typeof(supplies) = 'array'),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (macro_stage_id, name)
);

create table public.construction_evidence (
  id uuid primary key default gen_random_uuid(),
  construction_id uuid not null references public.constructions(id) on delete cascade,
  micro_stage_id uuid not null references public.construction_micro_stages(id) on delete cascade,
  file_path text not null unique,
  file_name text not null,
  note text check (char_length(note) <= 1500),
  captured_at timestamptz not null default now(),
  used_at timestamptz,
  uploaded_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.construction_micro_stages
  add column last_evidence_id uuid references public.construction_evidence(id) on delete set null;

create table public.construction_budgets (
  id uuid primary key default gen_random_uuid(),
  construction_id uuid not null references public.constructions(id) on delete cascade,
  reference_month date not null check (reference_month = date_trunc('month', reference_month)::date),
  planned_amount numeric(18,2) not null default 0 check (planned_amount >= 0),
  realized_amount numeric(18,2) not null default 0 check (realized_amount >= 0),
  notes text check (char_length(notes) <= 2000),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (construction_id, reference_month)
);

create table public.construction_updates (
  id uuid primary key default gen_random_uuid(),
  construction_id uuid not null references public.constructions(id) on delete cascade,
  macro_stage_id uuid not null references public.construction_macro_stages(id) on delete cascade,
  micro_stage_id uuid not null references public.construction_micro_stages(id) on delete cascade,
  evidence_id uuid not null references public.construction_evidence(id) on delete restrict,
  progress_percent numeric(5,2) not null check (progress_percent between 0 and 100),
  note text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 140),
  start_date date not null,
  end_date date,
  owner_name text not null check (char_length(btrim(owner_name)) between 2 and 140),
  owner_email text not null check (owner_email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'),
  objective text not null check (char_length(btrim(objective)) between 3 and 5000),
  status public.project_status not null default 'ativo',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_project_dates check (end_date is null or end_date >= start_date)
);

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 140),
  email text not null check (email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'),
  role text check (char_length(role) <= 100),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (project_id, email)
);

create table public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 220),
  description text check (char_length(description) <= 4000),
  assignee_name text not null check (char_length(btrim(assignee_name)) between 2 and 140),
  assignee_email text not null check (assignee_email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'),
  due_date date not null,
  status public.task_status not null default 'a_fazer',
  position integer not null default 0,
  completed_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2500),
  author_name text not null check (char_length(btrim(author_name)) between 1 and 140),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  file_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes between 0 and 20971520),
  uploaded_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.email_dispatches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scope text not null check (scope in ('owner', 'all')),
  recipients text[] not null,
  provider_id text,
  sent_by uuid not null default auth.uid() references auth.users(id),
  sent_at timestamptz not null default now()
);

-- Índices para os filtros e painéis mais usados.
create index businesses_stage_idx on public.businesses(stage);
create index businesses_updated_idx on public.businesses(updated_at desc);
create index business_history_business_idx on public.business_stage_history(business_id, entered_at desc);
create unique index business_history_open_stage_idx on public.business_stage_history(business_id) where exited_at is null;
create index constructions_status_idx on public.constructions(status);
create index macro_construction_position_idx on public.construction_macro_stages(construction_id, position);
create index micro_macro_position_idx on public.construction_micro_stages(macro_stage_id, position);
create index evidence_construction_date_idx on public.construction_evidence(construction_id, captured_at desc);
create index budgets_construction_month_idx on public.construction_budgets(construction_id, reference_month desc);
create index project_tasks_project_status_idx on public.project_tasks(project_id, status);
create index project_tasks_due_idx on public.project_tasks(due_date) where status <> 'concluida';
create index project_comments_project_date_idx on public.project_comments(project_id, created_at desc);
create index project_files_project_date_idx on public.project_files(project_id, created_at desc);

-- Funções utilitárias.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)), new.email)
  on conflict (user_id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created
after insert or update of email on auth.users
for each row execute function public.handle_new_user();

-- Inclui usuários que já existiam antes da aplicação desta migration.
insert into public.profiles (user_id, full_name, email)
select
  id,
  coalesce(raw_user_meta_data ->> 'full_name', split_part(email, '@', 1)),
  email
from auth.users
on conflict (user_id) do update set
  email = excluded.email,
  updated_at = now();

create or replace function public.protect_business_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.name is distinct from old.name then
    raise exception using message = 'business_name_immutable';
  end if;
  return new;
end;
$$;

create trigger protect_business_name_before_update
before update on public.businesses
for each row execute function public.protect_business_name();

create or replace function public.track_business_stage()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.business_stage_history (business_id, stage, entered_at, changed_by)
    values (new.id, new.stage, new.created_at, new.created_by);
  elsif new.stage is distinct from old.stage then
    update public.business_stage_history
      set exited_at = now()
      where business_id = new.id and exited_at is null;
    insert into public.business_stage_history (business_id, stage, changed_by)
    values (new.id, new.stage, auth.uid());

    if new.stage = 'obra' then
      insert into public.constructions (
        source_business_id, name, type, start_date, address, planned_budget, status,
        notes, created_by
      ) values (
        new.id, new.name, 'loteamento', current_date,
        concat_ws(', ', new.address, new.city, new.state), 0, 'planejamento',
        'Obra criada automaticamente a partir do funil de Novos Negócios.', auth.uid()
      ) on conflict (source_business_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

create trigger track_business_stage_after_write
after insert or update of stage on public.businesses
for each row execute function public.track_business_stage();

create or replace function public.validate_evidence_before_progress()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  valid_evidence boolean;
begin
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

    update public.construction_evidence
      set used_at = now()
      where id = new.last_evidence_id;
  end if;
  return new;
end;
$$;

create trigger require_evidence_before_micro_progress
before update of progress_percent on public.construction_micro_stages
for each row execute function public.validate_evidence_before_progress();

create or replace function public.log_construction_progress()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  evidence_note text;
begin
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

create trigger log_micro_progress_after_update
after update of progress_percent on public.construction_micro_stages
for each row execute function public.log_construction_progress();

create or replace function public.set_task_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'concluida' and old.status <> 'concluida' then
    new.completed_at = now();
  elsif new.status <> 'concluida' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

create trigger set_task_completion_before_update
before update of status on public.project_tasks
for each row execute function public.set_task_completion();

create or replace function public.add_project_owner_as_member()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, name, email, role, created_by)
  values (new.id, new.owner_name, lower(new.owner_email), 'Responsável pelo projeto', new.created_by)
  on conflict (project_id, email) do nothing;
  return new;
end;
$$;

create trigger add_owner_member_after_project_insert
after insert on public.projects
for each row execute function public.add_project_owner_as_member();

create or replace function public.add_task_assignee_as_member()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, name, email, role, created_by)
  values (new.project_id, new.assignee_name, lower(new.assignee_email), 'Responsável por tarefa', new.created_by)
  on conflict (project_id, email) do update set name = excluded.name;
  return new;
end;
$$;

create trigger add_task_assignee_member_after_write
after insert or update of assignee_email, assignee_name on public.project_tasks
for each row execute function public.add_task_assignee_as_member();

create or replace function public.touch_parent_project()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_id uuid;
begin
  parent_id := coalesce(new.project_id, old.project_id);
  update public.projects set updated_at = now() where id = parent_id;
  return coalesce(new, old);
end;
$$;

create trigger touch_project_from_tasks after insert or update or delete on public.project_tasks for each row execute function public.touch_parent_project();
create trigger touch_project_from_comments after insert or update or delete on public.project_comments for each row execute function public.touch_parent_project();
create trigger touch_project_from_files after insert or delete on public.project_files for each row execute function public.touch_parent_project();

-- Atualização automática de updated_at.
create trigger set_profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger set_businesses_updated_at before update on public.businesses for each row execute function public.set_updated_at();
create trigger set_business_steps_updated_at before update on public.business_phase_steps for each row execute function public.set_updated_at();
create trigger set_constructions_updated_at before update on public.constructions for each row execute function public.set_updated_at();
create trigger set_macro_stages_updated_at before update on public.construction_macro_stages for each row execute function public.set_updated_at();
create trigger set_micro_stages_updated_at before update on public.construction_micro_stages for each row execute function public.set_updated_at();
create trigger set_budgets_updated_at before update on public.construction_budgets for each row execute function public.set_updated_at();
create trigger set_projects_updated_at before update on public.projects for each row execute function public.set_updated_at();
create trigger set_tasks_updated_at before update on public.project_tasks for each row execute function public.set_updated_at();
create trigger set_comments_updated_at before update on public.project_comments for each row execute function public.set_updated_at();

-- Salva todos os pesos de uma obra em uma operação atômica e só aceita total 100%.
create or replace function public.set_construction_stage_weights(
  p_construction_id uuid,
  p_weights jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected_count integer;
  supplied_count integer;
  total numeric;
begin
  if jsonb_typeof(p_weights) <> 'array' then
    raise exception 'weights_must_be_array';
  end if;

  select count(*) into expected_count
  from public.construction_macro_stages
  where construction_id = p_construction_id;

  select count(*), coalesce(sum(weight), 0)
    into supplied_count, total
  from jsonb_to_recordset(p_weights) as x(id uuid, weight numeric);

  if expected_count = 0 or supplied_count <> expected_count then
    raise exception 'all_stages_required';
  end if;
  if abs(total - 100) > 0.001 then
    raise exception 'weights_must_total_100';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_weights) as x(id uuid, weight numeric)
    left join public.construction_macro_stages m
      on m.id = x.id and m.construction_id = p_construction_id
    where m.id is null or x.weight < 0 or x.weight > 100
  ) then
    raise exception 'invalid_stage_weight';
  end if;

  update public.construction_macro_stages m
    set weight_percent = x.weight, updated_at = now()
  from jsonb_to_recordset(p_weights) as x(id uuid, weight numeric)
  where m.id = x.id and m.construction_id = p_construction_id;
end;
$$;

grant execute on function public.set_construction_stage_weights(uuid, jsonb) to authenticated;

-- Views seguras: respeitam o RLS das tabelas de origem.
create view public.construction_macro_stage_progress
with (security_invoker = true)
as
select
  m.*,
  coalesce(round(avg(s.progress_percent), 2), 0) as progress_percent
from public.construction_macro_stages m
left join public.construction_micro_stages s on s.macro_stage_id = m.id
group by m.id;

create view public.construction_progress_summary
with (security_invoker = true)
as
with stage_data as (
  select
    m.construction_id,
    sum(m.weight_percent) as stage_weight_total,
    sum((m.weight_percent / 100.0) * m.progress_percent) as progress_percent
  from public.construction_macro_stage_progress m
  group by m.construction_id
), budget_data as (
  select
    b.construction_id,
    sum(b.realized_amount) as realized_total,
    sum(b.realized_amount) filter (
      where b.reference_month = date_trunc('month', current_date)::date
    ) as realized_current_month
  from public.construction_budgets b
  group by b.construction_id
)
select
  c.*,
  coalesce(s.progress_percent, 0) as progress_percent,
  coalesce(s.stage_weight_total, 0) as stage_weight_total,
  coalesce(b.realized_total, 0) as realized_total,
  coalesce(b.realized_current_month, 0) as realized_current_month
from public.constructions c
left join stage_data s on s.construction_id = c.id
left join budget_data b on b.construction_id = c.id;

create view public.construction_update_feed
with (security_invoker = true)
as
select
  u.*,
  m.name as macro_stage_name,
  s.name as micro_stage_name,
  e.file_path,
  e.file_name
from public.construction_updates u
join public.construction_macro_stages m on m.id = u.macro_stage_id
join public.construction_micro_stages s on s.id = u.micro_stage_id
join public.construction_evidence e on e.id = u.evidence_id;

create view public.project_progress_summary
with (security_invoker = true)
as
select
  p.*,
  count(t.id)::integer as total_tasks,
  count(t.id) filter (where t.status = 'concluida')::integer as completed_tasks,
  count(t.id) filter (where t.status <> 'concluida' and t.due_date < current_date)::integer as overdue_tasks,
  case
    when count(t.id) = 0 then 0
    else round(100.0 * count(t.id) filter (where t.status = 'concluida') / count(t.id), 2)
  end as progress_percent
from public.projects p
left join public.project_tasks t on t.project_id = p.id
group by p.id;

create view public.business_funnel_metrics
with (security_invoker = true)
as
select
  s.stage,
  count(distinct b.id)::integer as current_projects,
  coalesce(sum(b.potential_vgv), 0) as current_vgv,
  coalesce(round(avg(extract(epoch from (coalesce(s.exited_at, now()) - s.entered_at)) / 86400.0), 1), 0) as average_days
from public.business_stage_history s
left join public.businesses b on b.id = s.business_id and b.stage = s.stage
group by s.stage;

-- Row Level Security.
alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_departments enable row level security;
alter table public.businesses enable row level security;
alter table public.business_stage_history enable row level security;
alter table public.business_phase_steps enable row level security;
alter table public.constructions enable row level security;
alter table public.construction_macro_stages enable row level security;
alter table public.construction_micro_stages enable row level security;
alter table public.construction_evidence enable row level security;
alter table public.construction_budgets enable row level security;
alter table public.construction_updates enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_tasks enable row level security;
alter table public.project_comments enable row level security;
alter table public.project_files enable row level security;
alter table public.email_dispatches enable row level security;

create policy departments_read on public.departments for select to authenticated using (true);
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_update_own on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy profile_departments_authenticated on public.profile_departments for all to authenticated using (true) with check (true);
create policy businesses_authenticated on public.businesses for all to authenticated using (true) with check (true);
create policy business_history_authenticated on public.business_stage_history for all to authenticated using (true) with check (true);
create policy business_steps_authenticated on public.business_phase_steps for all to authenticated using (true) with check (true);
create policy constructions_authenticated on public.constructions for all to authenticated using (true) with check (true);
create policy macro_stages_authenticated on public.construction_macro_stages for all to authenticated using (true) with check (true);
create policy micro_stages_authenticated on public.construction_micro_stages for all to authenticated using (true) with check (true);
create policy evidence_authenticated on public.construction_evidence for all to authenticated using (true) with check (true);
create policy budgets_authenticated on public.construction_budgets for all to authenticated using (true) with check (true);
create policy construction_updates_authenticated on public.construction_updates for all to authenticated using (true) with check (true);
create policy projects_authenticated on public.projects for all to authenticated using (true) with check (true);
create policy project_members_authenticated on public.project_members for all to authenticated using (true) with check (true);
create policy project_tasks_authenticated on public.project_tasks for all to authenticated using (true) with check (true);
create policy project_comments_authenticated on public.project_comments for all to authenticated using (true) with check (true);
create policy project_files_authenticated on public.project_files for all to authenticated using (true) with check (true);
create policy email_dispatches_authenticated on public.email_dispatches for all to authenticated using (true) with check (true);

grant select on public.departments, public.profiles, public.profile_departments to authenticated;
grant select, insert, update, delete on
  public.businesses, public.business_stage_history, public.business_phase_steps,
  public.constructions, public.construction_macro_stages, public.construction_micro_stages,
  public.construction_evidence, public.construction_budgets, public.construction_updates,
  public.projects, public.project_members, public.project_tasks, public.project_comments,
  public.project_files, public.email_dispatches
to authenticated;
grant update on public.profiles to authenticated;
grant select on
  public.construction_macro_stage_progress, public.construction_progress_summary,
  public.construction_update_feed, public.project_progress_summary,
  public.business_funnel_metrics
to authenticated;

-- Storage privado. Os arquivos são acessados apenas por URLs assinadas e usuários logados.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('construction-evidence', 'construction-evidence', false, 20971520, array['image/jpeg', 'image/png', 'image/webp']),
  ('project-files', 'project-files', false, 20971520, array[
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy construction_evidence_storage_read on storage.objects
for select to authenticated using (bucket_id = 'construction-evidence');
create policy construction_evidence_storage_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'construction-evidence'
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
);
create policy construction_evidence_storage_delete on storage.objects
for delete to authenticated using (bucket_id = 'construction-evidence');

create policy project_files_storage_read on storage.objects
for select to authenticated using (bucket_id = 'project-files');
create policy project_files_storage_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'project-files'
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx')
);
create policy project_files_storage_delete on storage.objects
for delete to authenticated using (bucket_id = 'project-files');

commit;
