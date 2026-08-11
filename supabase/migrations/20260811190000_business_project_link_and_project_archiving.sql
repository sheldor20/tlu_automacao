-- Vínculo obrigatório entre novos negócios e projetos + arquivamento de projetos.
-- Compatível com registros já existentes: negócios legados podem permanecer sem
-- vínculo até a próxima edição, mas toda nova inclusão é protegida no banco.

begin;

alter table public.projects
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

alter table public.businesses
  add column if not exists project_id uuid references public.projects(id) on delete restrict;

create index if not exists businesses_project_idx on public.businesses(project_id);
create index if not exists projects_archived_idx on public.projects(archived_at, updated_at desc);

create or replace function public.validate_business_project()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  eligible boolean;
begin
  -- Permite que registros legados ainda sem vínculo recebam outras atualizações.
  if tg_op = 'UPDATE' and new.project_id is not distinct from old.project_id then
    return new;
  end if;

  if new.project_id is null then
    raise exception using message = 'business_project_required';
  end if;

  select exists (
    select 1
    from public.projects p
    where p.id = new.project_id
      and p.archived_at is null
      and p.status in ('ativo', 'concluido')
  ) into eligible;

  if not coalesce(eligible, false) then
    raise exception using message = 'business_project_not_eligible';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_business_project_before_write on public.businesses;
create trigger validate_business_project_before_write
before insert or update of project_id on public.businesses
for each row execute function public.validate_business_project();

-- A view precisa ser recriada para expor archived_at e archived_by ao frontend.
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

grant select on public.project_progress_summary to authenticated;

commit;
