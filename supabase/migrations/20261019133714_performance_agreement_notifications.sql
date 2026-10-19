begin;

alter table public.user_notifications drop constraint user_notifications_notification_type_check;
alter table public.user_notifications add constraint user_notifications_notification_type_check
check (notification_type in ('task_assigned', 'performance_pending', 'performance_signed'));

-- Separate recipient-only policy; the existing task policy remains unchanged.
create policy performance_notifications_read on public.user_notifications for select to authenticated
using (
 recipient_user_id = (select auth.uid())
 and notification_type in ('performance_pending', 'performance_signed')
 and exists (select 1 from public.performance_agreements a where a.id = entity_id
   and public.can_access_performance_agreement(a.report_user_id)
   and ((notification_type = 'performance_pending' and a.report_user_id = (select auth.uid()))
     or (notification_type = 'performance_signed' and a.report_user_id <> (select auth.uid()))))
);

create function performance_private.notify_performance_pending() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or not public.can_access_performance_agreement(new.report_user_id)
    or new.report_user_id = auth.uid() then
   raise exception 'performance_notification_not_authorized';
 end if;
 -- An edit makes the current revision pending again, replacing the old occurrence.
 delete from public.user_notifications where entity_id = new.id and notification_type = 'performance_signed';
 insert into public.user_notifications(recipient_user_id, notification_type, entity_id, title, message, actor_user_id)
 values (new.report_user_id, 'performance_pending', new.id, 'Acordo pendente de assinatura',
   'Leia e assine o acordo de performance: ' || new.cycle || ' · Revisão ' || new.version, auth.uid())
 on conflict (recipient_user_id, notification_type, entity_id) do update
 set title = excluded.title, message = excluded.message, actor_user_id = excluded.actor_user_id,
     read_at = null, created_at = clock_timestamp();
 return new;
end; $$;
revoke all on function performance_private.notify_performance_pending() from public, anon, authenticated;
create trigger notify_performance_pending after insert or update on public.performance_agreements
for each row execute function performance_private.notify_performance_pending();

create function performance_private.notify_performance_signed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare agreement public.performance_agreements;
begin
 select * into agreement from public.performance_agreements where id = new.agreement_id;
 if auth.uid() is null or new.signer_id <> auth.uid() or agreement.report_user_id <> auth.uid()
   or not public.can_access_performance_agreement(agreement.report_user_id) then
   raise exception 'performance_notification_not_authorized';
 end if;
 delete from public.user_notifications where notification_type = 'performance_pending' and entity_id = new.agreement_id;
 insert into public.user_notifications(recipient_user_id, notification_type, entity_id, title, message, actor_user_id)
 select line.leader_user_id, 'performance_signed', agreement.id, 'Acordo de performance assinado',
   left(new.signature_name || ' assinou ' || agreement.cycle || ' · Revisão ' || new.agreement_version, 500), new.signer_id
 from public.profile_reporting_lines line
 join public.profiles leader on leader.user_id = line.leader_user_id and leader.active and leader.deleted_at is null
 where line.report_user_id = agreement.report_user_id
 on conflict (recipient_user_id, notification_type, entity_id) do update
 set title = excluded.title, message = excluded.message, actor_user_id = excluded.actor_user_id,
     read_at = null, created_at = clock_timestamp();
 return new;
end; $$;
revoke all on function performance_private.notify_performance_signed() from public, anon, authenticated;
create trigger notify_performance_signed after insert on public.performance_acknowledgments
for each row execute function performance_private.notify_performance_signed();

-- Include existing unsigned cycles without sending external messages.
insert into public.user_notifications(recipient_user_id, notification_type, entity_id, title, message, actor_user_id)
select a.report_user_id, 'performance_pending', a.id, 'Acordo pendente de assinatura',
 'Leia e assine o acordo de performance: ' || a.cycle || ' · Revisão ' || a.version, a.updated_by
from public.performance_agreements a
where not exists(select 1 from public.performance_acknowledgments s where s.agreement_id = a.id and s.agreement_version = a.version)
on conflict (recipient_user_id, notification_type, entity_id) do nothing;

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
  where notification.notification_type = 'task_assigned' and notification.recipient_user_id = p_user_id and notification.read_at is null
    and (case task.category when 'governance' then 'governanca' else 'projetos' end) = any(access.departments)
  union all
  select 'notification-' || notification.id, extract(epoch from notification.created_at)::text,
    notification.title, notification.message || ' · ' || to_char(timezone('America/Sao_Paulo', notification.created_at), 'DD/MM/YYYY'),
    'notification', 'info', '/acordo-performance?agreement=' || agreement.id, 450
  from public.user_notifications notification
  join public.performance_agreements agreement on agreement.id = notification.entity_id
  where notification.notification_type in ('performance_pending', 'performance_signed')
    and notification.recipient_user_id = p_user_id and p_user_id = (select auth.uid())
    and notification.read_at is null
    and (notification.notification_type <> 'performance_pending' or not exists (
      select 1 from public.performance_acknowledgments signature
      where signature.agreement_id = agreement.id and signature.agreement_version = agreement.version
    ));
$$;

commit;
