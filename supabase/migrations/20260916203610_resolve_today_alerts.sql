begin;

-- A new occurrence must be actionable again, but unrelated edits and Qlik
-- refreshes must not bring back an alert the person already resolved.
alter table public.project_tasks add column today_alert_version integer not null default 0;
alter table public.rentals add column today_alert_version integer not null default 0;

create or replace function private.advance_today_alert_version()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.today_alert_version := old.today_alert_version;
  if (tg_table_name = 'rentals' and old.status is distinct from new.status)
    or (tg_table_name = 'project_tasks' and old.status::text = 'concluida' and new.status::text <> 'concluida') then
    new.today_alert_version := old.today_alert_version + 1;
  end if;
  return new;
end;
$$;
revoke all on function private.advance_today_alert_version() from public, anon, authenticated;
create trigger advance_today_alert_version before update on public.project_tasks
for each row execute function private.advance_today_alert_version();
create trigger advance_today_alert_version before update on public.rentals
for each row execute function private.advance_today_alert_version();

-- One source of alerts for the page, resolution validation and sidebar count.
-- SECURITY INVOKER keeps all source-table RLS and the viewer/subject intersection.
create or replace function public.today_alert_candidates(p_user_id uuid)
returns table (
  id text, occurrence_key text, title text, description text,
  category text, tone text, href text, sort_order integer
)
language sql stable security invoker set search_path = '' as $$
  with access as materialized (
    select public.today_department_access(p_user_id) as departments,
      timezone('America/Sao_Paulo', now())::date as today
  ), overdue as (
    select task.*, access.today,
      case when task.project_id is null then 'Atividade avulsa' else coalesce(project.name, 'Projeto') end as project_name
    from public.project_tasks task
    left join public.projects project on project.id = task.project_id
    cross join access
    where (case task.category when 'governance' then 'governanca' else 'projetos' end) = any(access.departments)
      and task.status <> 'concluida' and task.due_date < access.today
      and (exists (select 1 from public.project_task_assignees a where a.task_id = task.id and a.user_id = p_user_id)
        or exists (select 1 from public.project_subtasks s join public.project_subtask_assignees a on a.subtask_id = s.id
          where s.task_id = task.id and a.user_id = p_user_id))
  ), rental_dates as (
    select rental.*, access.today,
      make_date(extract(year from access.today)::integer,
        extract(month from rental.lease_start_date)::integer,
        least(extract(day from rental.lease_start_date)::integer,
          extract(day from (date_trunc('month', make_date(extract(year from access.today)::integer,
            extract(month from rental.lease_start_date)::integer, 1) + interval '1 month') - interval '1 day'))::integer)) as adjustment_this_year
    from public.rentals rental cross join access
    where 'alugueis' = any(access.departments)
  ), rental_alerts as (
    select rental.*, case when adjustment_this_year < today
      then (adjustment_this_year + interval '1 year')::date else adjustment_this_year end as next_adjustment
    from rental_dates rental
  )
  select 'overdue-' || task.id, task.due_date::text || ':' || task.today_alert_version,
    task.title, task.project_name || ' · atraso de ' || (task.today - task.due_date) || ' dia(s)',
    'task', 'danger',
    (case task.category when 'governance' then '/governanca' else '/projetos' end)
      || (case when task.project_id is null then '#quadro-tarefas' else '/' || task.project_id || '?tab=tarefas' end),
    task.due_date - task.today
  from overdue task
  union all
  select 'inspection-' || work.id, work.next_inspection_at::text,
    work.name, (case when work.next_inspection_at < access.today then 'Vistoria atrasada há ' || (access.today - work.next_inspection_at) || ' dia(s)'
      when work.next_inspection_at = access.today then 'Vistoria vence hoje'
      else 'Vistoria vence em ' || (work.next_inspection_at - access.today) || ' dia(s)' end)
      || ' · ciclo de ' || work.inspection_interval_days || ' dia(s)',
    'inspection', case when work.next_inspection_at <= access.today then 'danger' else 'warning' end,
    '/obras/' || work.id || '?tab=atualizacoes',
    (case when work.next_inspection_at <= access.today then 100 else 300 end) + (work.next_inspection_at - access.today)
  from public.construction_progress_summary work cross join access
  where 'obras' = any(access.departments) and work.responsible_user_id = p_user_id
    and work.archived_at is null and work.status = 'em_andamento' and work.next_inspection_at <= access.today + 3
  union all
  select rental.id || '-reforma', rental.today_alert_version::text,
    rental.name, 'Imóvel aguardando reforma · Aguardando reforma', 'rental', 'danger', '/alugueis/' || rental.id, 200
  from rental_alerts rental where rental.status = 'aguardando_reforma'
  union all
  select rental.id || (case when rental.lease_end_date < rental.today then '-contrato' else '-renovacao' end),
    rental.lease_end_date::text || ':' || rental.today_alert_version,
    rental.name, (case when rental.lease_end_date < rental.today
      then 'Contrato vencido há ' || (rental.today - rental.lease_end_date) || ' dia(s)'
      else 'Renovação/contrato vence em ' || (rental.lease_end_date - rental.today) || ' dia(s)' end) || ' · Alugado',
    'rental', case when rental.lease_end_date <= rental.today + 15 then 'danger' else 'warning' end,
    '/alugueis/' || rental.id, case when rental.lease_end_date <= rental.today + 15 then 200 else 400 end
  from rental_alerts rental where rental.status = 'alugado' and rental.lease_end_date <= rental.today + 60
  union all
  select rental.id || '-reajuste', rental.next_adjustment::text || ':' || rental.today_alert_version,
    rental.name, 'Reajuste anual em ' || (rental.next_adjustment - rental.today) || ' dia(s) · Alugado',
    'rental', case when rental.next_adjustment <= rental.today + 7 then 'danger' else 'warning' end,
    '/alugueis/' || rental.id, case when rental.next_adjustment <= rental.today + 7 then 200 else 400 end
  from rental_alerts rental where rental.status = 'alugado' and rental.next_adjustment <= rental.today + 45
  union all
  select 'notification-' || notification.id, extract(epoch from notification.created_at)::text,
    notification.title, notification.message || ' · ' || to_char(timezone('America/Sao_Paulo', notification.created_at), 'DD/MM/YYYY'),
    'notification', 'info',
    (case task.category when 'governance' then '/governanca' else '/projetos' end)
      || (case when task.project_id is null then '#quadro-tarefas' else '/' || task.project_id || '?tab=tarefas' end), 500
  from public.user_notifications notification
  join public.project_tasks task on task.id = notification.entity_id
  cross join access
  where notification.recipient_user_id = p_user_id and notification.read_at is null
    and (case task.category when 'governance' then 'governanca' else 'projetos' end) = any(access.departments);
$$;
revoke all on function public.today_alert_candidates(uuid) from public, anon;
grant execute on function public.today_alert_candidates(uuid) to authenticated;

create table public.today_alert_resolutions (
  user_id uuid not null default auth.uid() references public.profiles(user_id) on delete cascade,
  alert_id text not null check (char_length(alert_id) between 1 and 100),
  occurrence_key text not null check (char_length(occurrence_key) between 1 and 120),
  resolved_at timestamptz not null default now(),
  primary key (user_id, alert_id, occurrence_key)
);
alter table public.today_alert_resolutions enable row level security;
revoke all on public.today_alert_resolutions from anon, authenticated;
grant select, delete on public.today_alert_resolutions to authenticated;
grant insert(user_id, alert_id, occurrence_key) on public.today_alert_resolutions to authenticated;

create policy today_alert_resolutions_read on public.today_alert_resolutions for select to authenticated
using (user_id = (select auth.uid()) or public.is_system_admin() or public.is_direct_leader_of(user_id));
create policy today_alert_resolutions_insert on public.today_alert_resolutions for insert to authenticated
with check (user_id = (select auth.uid()) and exists (
  select 1 from public.today_alert_candidates(auth.uid()) alert
  where alert.id = alert_id and alert.occurrence_key = today_alert_resolutions.occurrence_key
));
create policy today_alert_resolutions_delete on public.today_alert_resolutions for delete to authenticated
using (user_id = (select auth.uid()) and exists (
  select 1 from public.today_alert_candidates(auth.uid()) alert
  where alert.id = alert_id and alert.occurrence_key = today_alert_resolutions.occurrence_key
));

create or replace function public.today_alerts(p_user_id uuid)
returns table (
  id text, occurrence_key text, title text, description text,
  category text, tone text, href text, sort_order integer, resolved_at timestamptz
)
language sql stable security invoker set search_path = '' as $$
  select alert.*, resolution.resolved_at
  from public.today_alert_candidates(p_user_id) alert
  left join public.today_alert_resolutions resolution
    on resolution.user_id = p_user_id and resolution.alert_id = alert.id and resolution.occurrence_key = alert.occurrence_key
  order by alert.sort_order, alert.title;
$$;
revoke all on function public.today_alerts(uuid) from public, anon;
grant execute on function public.today_alerts(uuid) to authenticated;

create or replace function public.resolve_today_alert(p_alert_id text, p_occurrence_key text)
returns timestamptz language plpgsql security invoker set search_path = '' as $$
declare saved_at timestamptz;
begin
  if not exists (select 1 from public.today_alert_candidates(auth.uid()) alert
    where alert.id = p_alert_id and alert.occurrence_key = p_occurrence_key) then
    raise exception using errcode = '42501', message = 'today_alert_not_available';
  end if;
  insert into public.today_alert_resolutions(user_id, alert_id, occurrence_key)
  values (auth.uid(), p_alert_id, p_occurrence_key) on conflict do nothing;
  select resolved_at into saved_at from public.today_alert_resolutions
    where user_id = auth.uid() and alert_id = p_alert_id and occurrence_key = p_occurrence_key;
  return saved_at;
end;
$$;
revoke all on function public.resolve_today_alert(text, text) from public, anon;
grant execute on function public.resolve_today_alert(text, text) to authenticated;

create or replace function public.reopen_today_alert(p_alert_id text, p_occurrence_key text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.today_alert_candidates(auth.uid()) alert
    where alert.id = p_alert_id and alert.occurrence_key = p_occurrence_key) then
    raise exception using errcode = '42501', message = 'today_alert_not_available';
  end if;
  delete from public.today_alert_resolutions
    where user_id = auth.uid() and alert_id = p_alert_id and occurrence_key = p_occurrence_key;
end;
$$;
revoke all on function public.reopen_today_alert(text, text) from public, anon;
grant execute on function public.reopen_today_alert(text, text) to authenticated;

create or replace function public.current_user_today_alert_count()
returns integer language sql stable security invoker set search_path = '' as $$
  select count(*)::integer from public.today_alerts(auth.uid()) where resolved_at is null;
$$;
revoke all on function public.current_user_today_alert_count() from public, anon;
grant execute on function public.current_user_today_alert_count() to authenticated;

commit;
