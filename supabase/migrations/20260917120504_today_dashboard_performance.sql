begin;

-- Fetch only the selected person's open tasks and the fields rendered by Hoje.
-- All reads still run under the caller's RLS; department access is refreshed
-- on every request, including when the selected person is a direct report.
create or replace function public.today_dashboard(p_user_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  viewer_id uuid := auth.uid();
  target_id uuid;
  users jsonb;
  departments text[];
  tasks jsonb;
  alerts jsonb;
begin
  if viewer_id is null or not exists (
    select 1 from public.profiles where user_id = viewer_id and active
  ) then
    raise exception using errcode = '42501', message = 'profile_not_available';
  end if;

  select coalesce(jsonb_agg(to_jsonb(person) order by person.is_self desc, person.full_name nulls last, person.email), '[]'::jsonb)
  into users from public.visible_today_users() person;
  target_id := case when exists (
    select 1 from jsonb_array_elements(users) person
    where person->>'user_id' = p_user_id::text
  ) then p_user_id else viewer_id end;
  departments := public.today_department_access(target_id);

  select coalesce(jsonb_agg(to_jsonb(item) order by item.due_date, item.id), '[]'::jsonb)
  into tasks from (
    select task.id, task.project_id, task.category, task.title, task.due_date,
      task.status, task.assignee_name,
      case when task.project_id is null then 'Atividade avulsa' else coalesce(project.name, 'Projeto') end as project_name,
      coalesce((select jsonb_agg(jsonb_build_object('assignee_name', a.assignee_name) order by a.assignee_name)
        from public.project_task_assignees a where a.task_id = task.id), '[]'::jsonb) as assignees
    from public.project_tasks task
    left join public.projects project on project.id = task.project_id
    where task.status <> 'concluida'
      and (case task.category when 'governance' then 'governanca' else 'projetos' end) = any(departments)
      and (exists (select 1 from public.project_task_assignees a where a.task_id = task.id and a.user_id = target_id)
        or exists (select 1 from public.project_subtasks s join public.project_subtask_assignees a on a.subtask_id = s.id
          where s.task_id = task.id and a.user_id = target_id))
  ) item;

  select coalesce(jsonb_agg(to_jsonb(alert) order by alert.sort_order, alert.title), '[]'::jsonb)
  into alerts from public.today_alerts(target_id) alert;
  return jsonb_build_object('current_user_id', viewer_id, 'selected_user_id', target_id,
    'users', users, 'departments', departments, 'tasks', tasks, 'alerts', alerts);
end;
$$;
revoke all on function public.today_dashboard(uuid) from public, anon;
grant execute on function public.today_dashboard(uuid) to authenticated;

-- The persistent menu previously fetched these three small tables separately
-- on every navigation. Keep live permission checks in one network request.
create or replace function public.current_user_app_access()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'profile', (select jsonb_build_object('full_name', p.full_name, 'email', p.email,
      'active', p.active, 'is_admin', p.is_admin) from public.profiles p where p.user_id = (select auth.uid())),
    'departments', coalesce((select jsonb_agg(d.department_slug) from public.profile_departments d
      where d.user_id = (select auth.uid())), '[]'::jsonb),
    'indicator_areas', coalesce((select jsonb_agg(a.area) from public.profile_indicator_areas a
      where a.user_id = (select auth.uid())), '[]'::jsonb)
  );
$$;
revoke all on function public.current_user_app_access() from public, anon;
grant execute on function public.current_user_app_access() to authenticated;

commit;
