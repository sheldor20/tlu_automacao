-- Hierarquia líder-liderado, privacidade de projetos/tarefas e alertas do Hoje.

begin;

create table if not exists public.profile_reporting_lines (
  report_user_id uuid primary key references public.profiles(user_id) on delete cascade,
  leader_user_id uuid not null references public.profiles(user_id) on delete restrict,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_line_no_self_leadership check (report_user_id <> leader_user_id)
);

create index if not exists profile_reporting_lines_leader_idx
  on public.profile_reporting_lines(leader_user_id, report_user_id);

create or replace function public.prevent_reporting_line_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cycle_found boolean;
begin
  with recursive leaders(user_id) as (
    select new.leader_user_id
    union all
    select line.leader_user_id
    from public.profile_reporting_lines line
    join leaders on line.report_user_id = leaders.user_id
    where line.report_user_id <> new.report_user_id
  )
  select exists (select 1 from leaders where user_id = new.report_user_id)
  into cycle_found;

  if cycle_found then
    raise exception using message = 'reporting_line_cycle';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_reporting_line_cycle_before_write on public.profile_reporting_lines;
create trigger prevent_reporting_line_cycle_before_write
before insert or update of report_user_id, leader_user_id on public.profile_reporting_lines
for each row execute function public.prevent_reporting_line_cycle();

drop trigger if exists set_profile_reporting_lines_updated_at on public.profile_reporting_lines;
create trigger set_profile_reporting_lines_updated_at
before update on public.profile_reporting_lines
for each row execute function public.set_updated_at();

alter table public.profile_reporting_lines enable row level security;

create or replace function public.is_direct_leader_of(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profile_reporting_lines line
    where line.report_user_id = p_user_id
      and line.leader_user_id = auth.uid()
  );
$$;

create or replace function public.is_team_leader()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profile_reporting_lines line
    where line.leader_user_id = auth.uid()
  );
$$;

revoke all on function public.is_direct_leader_of(uuid) from public;
revoke all on function public.is_team_leader() from public;
grant execute on function public.is_direct_leader_of(uuid), public.is_team_leader() to authenticated;

create policy profile_reporting_lines_read
on public.profile_reporting_lines for select to authenticated
using (
  public.is_system_admin()
  or report_user_id = auth.uid()
  or leader_user_id = auth.uid()
);

create policy profile_reporting_lines_admin_write
on public.profile_reporting_lines for all to authenticated
using (public.is_system_admin())
with check (public.is_system_admin());

grant select, insert, update, delete on public.profile_reporting_lines to authenticated;

-- Retorna somente o próprio usuário e os liderados diretos para o seletor do Hoje.
create or replace function public.visible_today_users()
returns table(user_id uuid, full_name text, email text, is_self boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.user_id, profile.full_name, profile.email,
    profile.user_id = auth.uid() as is_self
  from public.profiles profile
  where profile.active
    and (
      profile.user_id = auth.uid()
      or public.is_system_admin()
      or exists (
        select 1 from public.profile_reporting_lines line
        where line.leader_user_id = auth.uid()
          and line.report_user_id = profile.user_id
      )
    )
  order by (profile.user_id = auth.uid()) desc, profile.full_name nulls last, profile.email;
$$;

revoke all on function public.visible_today_users() from public;
grant execute on function public.visible_today_users() to authenticated;

-- Participação pode ser avaliada para o próprio usuário ou para um liderado direto.
create or replace function public.user_is_involved_in_project(p_project_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects project
    where project.id = p_project_id and project.owner_user_id = p_user_id
  ) or exists (
    select 1 from public.project_members member
    where member.project_id = p_project_id and member.user_id = p_user_id
  ) or exists (
    select 1 from public.project_tasks task
    where task.project_id = p_project_id and task.assignee_user_id = p_user_id
  );
$$;

create or replace function public.has_project_access(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_department_access('projetos') and (
    public.is_system_admin()
    or public.user_is_involved_in_project(p_project_id, auth.uid())
    or exists (
      select 1
      from public.profile_reporting_lines line
      where line.leader_user_id = auth.uid()
        and public.user_is_involved_in_project(p_project_id, line.report_user_id)
    )
  );
$$;

-- Acesso completo passa a significar gestão dos projetos em que o usuário está
-- envolvido. A liderança direta é somente leitura; o administrador segue global.
create or replace function public.has_project_full_access(p_project_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_department_access('projetos') and (
    public.is_system_admin()
    or (
      p_project_id is not null
      and public.project_permission_scope() = 'full'
      and public.user_is_involved_in_project(p_project_id, auth.uid())
    )
  );
$$;

create or replace function public.can_create_project()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_department_access('projetos')
    and (public.is_system_admin() or public.project_permission_scope() = 'full');
$$;

create or replace function public.can_read_project_task(
  p_project_id uuid,
  p_assignee_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_department_access('projetos') and (
    public.is_system_admin()
    or p_assignee_user_id = auth.uid()
    or public.is_direct_leader_of(p_assignee_user_id)
    or (
      p_project_id is not null
      and public.project_permission_scope() = 'full'
      and public.user_is_involved_in_project(p_project_id, auth.uid())
    )
  );
$$;

revoke all on function public.user_is_involved_in_project(uuid, uuid) from public;
revoke all on function public.can_create_project() from public;
revoke all on function public.can_read_project_task(uuid, uuid) from public;
grant execute on function public.user_is_involved_in_project(uuid, uuid),
  public.can_create_project(), public.can_read_project_task(uuid, uuid) to authenticated;

drop policy if exists projects_read on public.projects;
drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;
drop policy if exists projects_delete on public.projects;
create policy projects_read on public.projects for select to authenticated
using (public.has_project_access(id));
create policy projects_insert on public.projects for insert to authenticated
with check (public.can_create_project());
create policy projects_update on public.projects for update to authenticated
using (public.has_project_full_access(id)) with check (public.has_project_full_access(id));
create policy projects_delete on public.projects for delete to authenticated
using (public.has_project_full_access(id));

drop policy if exists project_tasks_read on public.project_tasks;
drop policy if exists project_tasks_insert on public.project_tasks;
drop policy if exists project_tasks_update on public.project_tasks;
drop policy if exists project_tasks_delete on public.project_tasks;

create policy project_tasks_read on public.project_tasks for select to authenticated
using (public.can_read_project_task(project_id, assignee_user_id));

create policy project_tasks_insert on public.project_tasks for insert to authenticated
with check (
  public.has_department_access('projetos')
  and (
    public.is_system_admin()
    or (project_id is not null and public.has_project_full_access(project_id))
    or (project_id is null and (
      assignee_user_id = auth.uid()
      or public.is_direct_leader_of(assignee_user_id)
      or public.project_permission_scope() = 'full'
    ))
  )
);

create policy project_tasks_update on public.project_tasks for update to authenticated
using (
  public.is_system_admin()
  or assignee_user_id = auth.uid()
  or public.is_direct_leader_of(assignee_user_id)
  or (project_id is not null and public.has_project_full_access(project_id))
)
with check (
  public.is_system_admin()
  or assignee_user_id = auth.uid()
  or public.is_direct_leader_of(assignee_user_id)
  or (project_id is not null and public.has_project_full_access(project_id))
);

create policy project_tasks_delete on public.project_tasks for delete to authenticated
using (
  public.is_system_admin()
  or assignee_user_id = auth.uid()
  or public.is_direct_leader_of(assignee_user_id)
  or (project_id is not null and public.has_project_full_access(project_id))
);

-- Caixa de alertas persistente. O primeiro tipo registra quando outra pessoa
-- cria ou transfere uma tarefa para o usuário.
create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(user_id) on delete cascade,
  notification_type text not null check (notification_type in ('task_assigned')),
  entity_id uuid not null,
  title text not null check (char_length(btrim(title)) between 2 and 220),
  message text not null check (char_length(btrim(message)) between 2 and 500),
  actor_user_id uuid references public.profiles(user_id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipient_user_id, notification_type, entity_id)
);

create index if not exists user_notifications_recipient_idx
  on public.user_notifications(recipient_user_id, read_at, created_at desc);

alter table public.user_notifications enable row level security;

create policy user_notifications_read on public.user_notifications for select to authenticated
using (
  recipient_user_id = auth.uid()
  or public.is_system_admin()
  or public.is_direct_leader_of(recipient_user_id)
);
create policy user_notifications_recipient_update on public.user_notifications for update to authenticated
using (recipient_user_id = auth.uid())
with check (recipient_user_id = auth.uid());
create policy user_notifications_recipient_delete on public.user_notifications for delete to authenticated
using (recipient_user_id = auth.uid() or public.is_system_admin());

grant select, update, delete on public.user_notifications to authenticated;

create or replace function public.notify_task_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_name text;
begin
  if tg_op = 'UPDATE' and new.assignee_user_id is distinct from old.assignee_user_id then
    delete from public.user_notifications notification
    where notification.notification_type = 'task_assigned'
      and notification.entity_id = new.id
      and notification.recipient_user_id = old.assignee_user_id;
  end if;

  if new.assignee_user_id is null
    or new.assignee_user_id = auth.uid()
    or (tg_op = 'UPDATE' and new.assignee_user_id is not distinct from old.assignee_user_id)
  then
    return new;
  end if;

  select project.name into project_name
  from public.projects project
  where project.id = new.project_id;

  insert into public.user_notifications (
    recipient_user_id, notification_type, entity_id, title, message, actor_user_id, read_at, created_at
  ) values (
    new.assignee_user_id,
    'task_assigned',
    new.id,
    'Nova tarefa atribuída',
    case when new.project_id is null
      then new.title
      else new.title || ' · ' || coalesce(project_name, 'Projeto')
    end,
    coalesce(auth.uid(), new.created_by),
    null,
    now()
  )
  on conflict (recipient_user_id, notification_type, entity_id) do update
    set title = excluded.title,
        message = excluded.message,
        actor_user_id = excluded.actor_user_id,
        read_at = null,
        created_at = now();

  return new;
end;
$$;

drop trigger if exists notify_task_assignment_after_write on public.project_tasks;
create trigger notify_task_assignment_after_write
after insert or update of assignee_user_id on public.project_tasks
for each row execute function public.notify_task_assignment();

create or replace function public.delete_task_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.user_notifications notification
  where notification.notification_type = 'task_assigned'
    and notification.entity_id = old.id;
  return old;
end;
$$;

drop trigger if exists delete_task_notifications_after_delete on public.project_tasks;
create trigger delete_task_notifications_after_delete
after delete on public.project_tasks
for each row execute function public.delete_task_notifications();

-- Cada obra define seu próprio ciclo de vistoria; 15 dias permanece como padrão.
alter table public.constructions
  add column if not exists inspection_interval_days integer not null default 15;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'constructions_inspection_interval_valid'
      and conrelid = 'public.constructions'::regclass
  ) then
    alter table public.constructions
      add constraint constructions_inspection_interval_valid
      check (inspection_interval_days between 1 and 365);
  end if;
end;
$$;

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
  (coalesce(i.last_inspection_at, c.start_date) + c.inspection_interval_days) as next_inspection_at,
  (
    c.status = 'em_andamento'
    and (timezone('America/Sao_Paulo', now()))::date
      >= (coalesce(i.last_inspection_at, c.start_date) + c.inspection_interval_days)
  ) as inspection_due
from public.constructions c
left join stage_data s on s.construction_id = c.id
left join budget_data b on b.construction_id = c.id
left join activity_data a on a.construction_id = c.id
left join inspection_data i on i.construction_id = c.id;

grant select on public.construction_progress_summary to authenticated;

-- Contador do menu Hoje. A função é invoker para preservar as RLS das tabelas
-- e retorna somente as pendências do próprio usuário autenticado.
create or replace function public.current_user_today_alert_count()
returns integer
language sql
stable
set search_path = ''
as $$
  with calendar as (
    select (timezone('America/Sao_Paulo', now()))::date as today
  ), rental_dates as (
    select
      rental.*,
      case
        when rental.status = 'alugado' and rental.lease_start_date is not null then
          make_date(
            extract(year from calendar.today)::integer,
            extract(month from rental.lease_start_date)::integer,
            least(
              extract(day from rental.lease_start_date)::integer,
              extract(day from (
                date_trunc(
                  'month',
                  make_date(
                    extract(year from calendar.today)::integer,
                    extract(month from rental.lease_start_date)::integer,
                    1
                  ) + interval '1 month'
                ) - interval '1 day'
              ))::integer
            )
          )
        else null
      end as adjustment_this_year,
      calendar.today
    from public.rentals rental
    cross join calendar
    where public.has_department_access('alugueis')
  ), normalized_rentals as (
    select
      rental.*,
      case
        when rental.adjustment_this_year < rental.today then (rental.adjustment_this_year + interval '1 year')::date
        else rental.adjustment_this_year
      end as next_adjustment
    from rental_dates rental
  )
  select (
    case when public.has_department_access('projetos') then
      (select count(*) from public.user_notifications notification
       where notification.recipient_user_id = auth.uid() and notification.read_at is null)
      +
      (select count(*) from public.project_tasks task, calendar
       where task.assignee_user_id = auth.uid()
         and task.status <> 'concluida'
         and task.due_date < calendar.today)
    else 0 end
    +
    case when public.has_department_access('obras') then
      (select count(*) from public.construction_progress_summary work, calendar
       where work.responsible_user_id = auth.uid()
         and work.archived_at is null
         and work.status = 'em_andamento'
         and work.next_inspection_at <= calendar.today + 3)
    else 0 end
    +
    (select coalesce(sum(
      case when rental.status = 'aguardando_reforma' then 1 else 0 end
      + case
          when rental.status = 'alugado' and rental.lease_end_date < rental.today then 1
          when rental.status = 'alugado' and rental.lease_end_date <= rental.today + 60 then 1
          else 0
        end
      + case
          when rental.status = 'alugado' and rental.next_adjustment <= rental.today + 45 then 1
          else 0
        end
    ), 0) from normalized_rentals rental)
  )::integer;
$$;

revoke all on function public.current_user_today_alert_count() from public;
grant execute on function public.current_user_today_alert_count() to authenticated;

commit;
