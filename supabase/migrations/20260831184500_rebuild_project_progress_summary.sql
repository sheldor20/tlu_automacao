-- Reconstrói a visão depois da inclusão de projects.category.
-- Views com p.* não passam a expor automaticamente colunas adicionadas à tabela.

begin;

drop view if exists public.project_progress_summary;
create view public.project_progress_summary
with (security_invoker = true)
as
select
  project.*,
  count(task.id)::integer as total_tasks,
  count(task.id) filter (where task.status = 'concluida')::integer as completed_tasks,
  count(task.id) filter (
    where task.status <> 'concluida' and task.due_date < current_date
  )::integer as overdue_tasks,
  case
    when count(task.id) = 0 then 0
    else round(
      100.0 * count(task.id) filter (where task.status = 'concluida') / count(task.id),
      2
    )
  end as progress_percent
from public.projects project
left join public.project_tasks task on task.project_id = project.id
group by project.id;

grant select on public.project_progress_summary to authenticated;

commit;
