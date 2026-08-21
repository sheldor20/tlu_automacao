-- Contador seguro das pendências exibidas no menu Hoje.

begin;

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
