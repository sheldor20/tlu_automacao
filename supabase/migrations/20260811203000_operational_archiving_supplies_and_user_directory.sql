-- Arquivamento operacional, insumos estruturados e diretório de usuários.
-- Execute depois de 20260811190000_business_project_link_and_project_archiving.sql.

begin;

alter table public.businesses
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

alter table public.constructions
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

alter table public.projects
  add column if not exists owner_user_id uuid references public.profiles(user_id) on delete set null;

alter table public.project_tasks
  add column if not exists assignee_user_id uuid references public.profiles(user_id) on delete set null;

alter table public.project_members
  add column if not exists user_id uuid references public.profiles(user_id) on delete set null;

create index if not exists businesses_archived_idx on public.businesses(archived_at, updated_at desc);
create index if not exists constructions_archived_idx on public.constructions(archived_at, updated_at desc);
create index if not exists projects_owner_user_idx on public.projects(owner_user_id);
create index if not exists project_tasks_assignee_user_idx on public.project_tasks(assignee_user_id);
create index if not exists project_members_user_idx on public.project_members(user_id);

-- Mantém a lista de usuários legível no schema público sem expor auth.users ao navegador.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, full_name, email)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(new.email, '@', 1)
    ),
    lower(new.email)
  )
  on conflict (user_id) do update set
    full_name = excluded.full_name,
    email = excluded.email,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (user_id, full_name, email)
select
  id,
  coalesce(
    nullif(btrim(raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(raw_user_meta_data ->> 'name'), ''),
    split_part(email, '@', 1)
  ),
  lower(email)
from auth.users
where email is not null
on conflict (user_id) do update set
  full_name = excluded.full_name,
  email = excluded.email,
  updated_at = now();

-- Conecta registros antigos ao perfil correspondente quando o e-mail coincide.
update public.projects p
set owner_user_id = profile.user_id
from public.profiles profile
where p.owner_user_id is null
  and lower(p.owner_email) = lower(profile.email);

update public.project_tasks task
set assignee_user_id = profile.user_id
from public.profiles profile
where task.assignee_user_id is null
  and lower(task.assignee_email) = lower(profile.email);

update public.project_members member
set user_id = profile.user_id
from public.profiles profile
where member.user_id is null
  and lower(member.email) = lower(profile.email);

create or replace function public.sync_project_owner_from_profile()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.owner_user_id is null then
    if tg_op = 'INSERT' then
      raise exception using message = 'profile_required';
    end if;
    return new;
  end if;

  select
    coalesce(nullif(btrim(profile.full_name), ''), split_part(profile.email, '@', 1)),
    lower(profile.email)
  into new.owner_name, new.owner_email
  from public.profiles profile
  where profile.user_id = new.owner_user_id
    and profile.active
    and profile.email is not null;

  if not found then
    raise exception using message = 'profile_not_available';
  end if;
  return new;
end;
$$;

drop trigger if exists sync_project_owner_before_write on public.projects;
create trigger sync_project_owner_before_write
before insert or update of owner_user_id, owner_name, owner_email on public.projects
for each row execute function public.sync_project_owner_from_profile();

create or replace function public.sync_task_assignee_from_profile()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.assignee_user_id is null then
    if tg_op = 'INSERT' then
      raise exception using message = 'profile_required';
    end if;
    return new;
  end if;

  select
    coalesce(nullif(btrim(profile.full_name), ''), split_part(profile.email, '@', 1)),
    lower(profile.email)
  into new.assignee_name, new.assignee_email
  from public.profiles profile
  where profile.user_id = new.assignee_user_id
    and profile.active
    and profile.email is not null;

  if not found then
    raise exception using message = 'profile_not_available';
  end if;
  return new;
end;
$$;

drop trigger if exists sync_task_assignee_before_write on public.project_tasks;
create trigger sync_task_assignee_before_write
before insert or update of assignee_user_id, assignee_name, assignee_email on public.project_tasks
for each row execute function public.sync_task_assignee_from_profile();

create or replace function public.sync_project_member_from_profile()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.user_id is null then
    if tg_op = 'INSERT' then
      raise exception using message = 'profile_required';
    end if;
    return new;
  end if;

  select
    coalesce(nullif(btrim(profile.full_name), ''), split_part(profile.email, '@', 1)),
    lower(profile.email)
  into new.name, new.email
  from public.profiles profile
  where profile.user_id = new.user_id
    and profile.active
    and profile.email is not null;

  if not found then
    raise exception using message = 'profile_not_available';
  end if;
  return new;
end;
$$;

drop trigger if exists sync_project_member_before_write on public.project_members;
create trigger sync_project_member_before_write
before insert or update of user_id, name, email on public.project_members
for each row execute function public.sync_project_member_from_profile();

-- Os gatilhos que incluem automaticamente responsáveis como envolvidos passam a
-- preservar também o vínculo com o perfil do Supabase.
create or replace function public.add_project_owner_as_member()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, user_id, name, email, role, created_by)
  values (new.id, new.owner_user_id, new.owner_name, lower(new.owner_email), 'Responsável pelo projeto', new.created_by)
  on conflict (project_id, email) do update set
    user_id = excluded.user_id,
    name = excluded.name;
  return new;
end;
$$;

create or replace function public.add_task_assignee_as_member()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, user_id, name, email, role, created_by)
  values (new.project_id, new.assignee_user_id, new.assignee_name, lower(new.assignee_email), 'Responsável por tarefa', new.created_by)
  on conflict (project_id, email) do update set
    user_id = excluded.user_id,
    name = excluded.name;
  return new;
end;
$$;

drop trigger if exists add_task_assignee_member_after_write on public.project_tasks;
create trigger add_task_assignee_member_after_write
after insert or update of assignee_user_id, assignee_email, assignee_name on public.project_tasks
for each row execute function public.add_task_assignee_as_member();

-- Normaliza o formato anterior (somente nome) antes de ativar a validação.
update public.construction_micro_stages stage
set supplies = normalized.supplies
from (
  select
    source.id,
    jsonb_agg(
      jsonb_build_object(
        'name', coalesce(nullif(btrim(item.value ->> 'name'), ''), 'Insumo'),
        'total_value', case when coalesce(item.value ->> 'total_value', '') ~ '^\d+(\.\d+)?$' then (item.value ->> 'total_value')::numeric else 0 end,
        'total_quantity', case when coalesce(item.value ->> 'total_quantity', '') ~ '^\d+(\.\d+)?$' then (item.value ->> 'total_quantity')::numeric else 0 end,
        'used_quantity', least(
          case when coalesce(item.value ->> 'used_quantity', '') ~ '^\d+(\.\d+)?$' then (item.value ->> 'used_quantity')::numeric else 0 end,
          case when coalesce(item.value ->> 'total_quantity', '') ~ '^\d+(\.\d+)?$' then (item.value ->> 'total_quantity')::numeric else 0 end
        )
      ) order by item.ordinality
    ) as supplies
  from public.construction_micro_stages source
  cross join lateral jsonb_array_elements(source.supplies) with ordinality as item(value, ordinality)
  group by source.id
) normalized
where stage.id = normalized.id;

create or replace function public.validate_construction_supplies()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  item jsonb;
begin
  new.supplies := coalesce(new.supplies, '[]'::jsonb);
  if jsonb_typeof(new.supplies) <> 'array' then
    raise exception using message = 'invalid_supplies';
  end if;

  for item in select value from jsonb_array_elements(new.supplies) loop
    if jsonb_typeof(item) <> 'object'
      or not (item ?& array['name', 'total_value', 'total_quantity', 'used_quantity'])
      or char_length(btrim(coalesce(item ->> 'name', ''))) not between 1 and 140
      or jsonb_typeof(item -> 'total_value') <> 'number'
      or jsonb_typeof(item -> 'total_quantity') <> 'number'
      or jsonb_typeof(item -> 'used_quantity') <> 'number'
    then
      raise exception using message = 'invalid_supplies';
    end if;

    if (item ->> 'total_value')::numeric < 0
      or (item ->> 'total_quantity')::numeric < 0
      or (item ->> 'used_quantity')::numeric < 0
      or (item ->> 'used_quantity')::numeric > (item ->> 'total_quantity')::numeric
    then
      raise exception using message = 'invalid_supplies';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists validate_construction_supplies_before_write on public.construction_micro_stages;
create trigger validate_construction_supplies_before_write
before insert or update of supplies on public.construction_micro_stages
for each row execute function public.validate_construction_supplies();

-- Recria as views para expor as novas colunas adicionadas com c.* e p.*.
drop view if exists public.construction_progress_summary;
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

drop view if exists public.project_progress_summary;
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

grant select on public.construction_progress_summary, public.project_progress_summary to authenticated;

commit;
