-- Cronograma de obras, vistorias quinzenais e tarefas avulsas no quadro geral.

begin;

alter table public.construction_macro_stages
  add column if not exists start_date date,
  add column if not exists end_date date;

alter table public.construction_micro_stages
  add column if not exists start_date date,
  add column if not exists end_date date;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'valid_construction_macro_stage_dates'
      and conrelid = 'public.construction_macro_stages'::regclass
  ) then
    alter table public.construction_macro_stages
      add constraint valid_construction_macro_stage_dates
      check (start_date is null or end_date is null or end_date >= start_date);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'valid_construction_micro_stage_dates'
      and conrelid = 'public.construction_micro_stages'::regclass
  ) then
    alter table public.construction_micro_stages
      add constraint valid_construction_micro_stage_dates
      check (start_date is null or end_date is null or end_date >= start_date);
  end if;
end;
$$;

create index if not exists construction_macro_stage_dates_idx
  on public.construction_macro_stages(construction_id, start_date, end_date);
create index if not exists construction_micro_stage_dates_idx
  on public.construction_micro_stages(macro_stage_id, start_date, end_date);

create table if not exists public.construction_inspections (
  id uuid primary key default gen_random_uuid(),
  construction_id uuid not null references public.constructions(id) on delete cascade,
  inspected_at date not null default current_date,
  note text check (char_length(note) <= 1500),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists construction_inspections_latest_idx
  on public.construction_inspections(construction_id, inspected_at desc, created_at desc);

alter table public.construction_inspections enable row level security;

create policy construction_inspections_department_access
on public.construction_inspections for all to authenticated
using (public.has_department_access('obras'))
with check (public.has_department_access('obras'));

grant select, insert, update, delete on public.construction_inspections to authenticated;

-- Recria a visão de etapas para que as novas colunas de data façam parte do
-- resultado consumido pelas telas autenticada e pública.
drop view if exists public.construction_progress_summary;
drop view if exists public.construction_macro_stage_progress;

create view public.construction_macro_stage_progress
with (security_invoker = true)
as
select
  macro.*,
  coalesce(round(avg(micro.progress_percent), 2), 0) as progress_percent
from public.construction_macro_stages macro
left join public.construction_micro_stages micro on micro.macro_stage_id = macro.id
group by macro.id;

-- Acrescenta a situação da vistoria à visão já consumida por Obras e Hoje.
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
), activity_data as (
  select update.construction_id, max(update.created_at) as last_activity_at
  from public.construction_updates update
  group by update.construction_id
), inspection_data as (
  select inspection.construction_id, max(inspection.inspected_at) as last_inspection_at
  from public.construction_inspections inspection
  group by inspection.construction_id
)
select
  c.*,
  coalesce(s.progress_percent, 0) as progress_percent,
  coalesce(s.stage_weight_total, 0) as stage_weight_total,
  coalesce(b.realized_total, 0) as realized_total,
  coalesce(b.realized_current_month, 0) as realized_current_month,
  coalesce(a.last_activity_at, c.created_at) as last_activity_at,
  i.last_inspection_at,
  (coalesce(i.last_inspection_at, c.start_date) + 15) as next_inspection_at,
  (
    c.status = 'em_andamento'
    and (timezone('America/Sao_Paulo', now()))::date
      >= (coalesce(i.last_inspection_at, c.start_date) + 15)
  ) as inspection_due
from public.constructions c
left join stage_data s on s.construction_id = c.id
left join budget_data b on b.construction_id = c.id
left join activity_data a on a.construction_id = c.id
left join inspection_data i on i.construction_id = c.id;

grant select on public.construction_macro_stage_progress,
  public.construction_progress_summary to authenticated;

-- Uma tarefa sem projeto é avulsa e existe somente no quadro geral de tarefas.
alter table public.project_tasks
  alter column project_id drop not null;

create index if not exists project_tasks_global_board_idx
  on public.project_tasks(status, position, due_date);

create or replace function public.add_task_assignee_as_member()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.project_id is null then
    return new;
  end if;

  insert into public.project_members (project_id, user_id, name, email, role, created_by)
  values (
    new.project_id,
    new.assignee_user_id,
    new.assignee_name,
    lower(new.assignee_email),
    'Responsável por tarefa',
    new.created_by
  )
  on conflict (project_id, email) do update
    set user_id = excluded.user_id,
        name = excluded.name;
  return new;
end;
$$;

drop policy if exists project_tasks_read on public.project_tasks;
drop policy if exists project_tasks_insert on public.project_tasks;
drop policy if exists project_tasks_update on public.project_tasks;
drop policy if exists project_tasks_delete on public.project_tasks;

create policy project_tasks_read on public.project_tasks for select to authenticated
using (
  (
    project_id is not null
    and (
      public.has_project_full_access(project_id)
      or (public.has_project_access(project_id) and assignee_user_id = auth.uid())
    )
  )
  or (
    project_id is null
    and public.has_department_access('projetos')
    and (public.project_permission_scope() = 'full' or assignee_user_id = auth.uid())
  )
);

create policy project_tasks_insert on public.project_tasks for insert to authenticated
with check (
  (project_id is not null and public.has_project_full_access(project_id))
  or (
    project_id is null
    and public.has_department_access('projetos')
    and (public.project_permission_scope() = 'full' or assignee_user_id = auth.uid())
  )
);

create policy project_tasks_update on public.project_tasks for update to authenticated
using (
  (
    project_id is not null
    and (
      public.has_project_full_access(project_id)
      or (public.has_project_access(project_id) and assignee_user_id = auth.uid())
    )
  )
  or (
    project_id is null
    and public.has_department_access('projetos')
    and (public.project_permission_scope() = 'full' or assignee_user_id = auth.uid())
  )
)
with check (
  (
    project_id is not null
    and (
      public.has_project_full_access(project_id)
      or (public.has_project_access(project_id) and assignee_user_id = auth.uid())
    )
  )
  or (
    project_id is null
    and public.has_department_access('projetos')
    and (public.project_permission_scope() = 'full' or assignee_user_id = auth.uid())
  )
);

create policy project_tasks_delete on public.project_tasks for delete to authenticated
using (
  (project_id is not null and public.has_project_full_access(project_id))
  or (
    project_id is null
    and public.has_department_access('projetos')
    and (public.project_permission_scope() = 'full' or assignee_user_id = auth.uid())
  )
);

commit;
