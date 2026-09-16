begin;

-- Only this bounded lookup bypasses RLS: leaders cannot otherwise read their
-- reports' department assignments. Never return an area the viewer lacks.
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.today_department_access(p_user_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(department.slug order by department.position), '{}'::text[])
  from public.departments department
  join public.profiles target on target.user_id = p_user_id and target.active
  where auth.uid() is not null
    and exists (
      select 1 from public.profiles viewer
      where viewer.user_id = auth.uid() and viewer.active
    )
    and (
      p_user_id = auth.uid()
      or public.is_system_admin()
      or public.is_direct_leader_of(p_user_id)
    )
    and public.has_department_access(department.slug)
    and (
      target.is_admin
      or exists (
        select 1 from public.profile_departments access
        where access.user_id = p_user_id and access.department_slug = department.slug
      )
    );
$$;

revoke all on function private.today_department_access(uuid) from public, anon;
grant execute on function private.today_department_access(uuid) to authenticated;

create or replace function public.today_department_access(p_user_id uuid)
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  select private.today_department_access(p_user_id);
$$;

revoke all on function public.today_department_access(uuid) from public, anon;
grant execute on function public.today_department_access(uuid) to authenticated;

-- Assignment notifications can outlive a department grant or a task. Apply the
-- same access check to direct reads and the SECURITY INVOKER Hoje badge RPC.
drop policy if exists user_notifications_read on public.user_notifications;
create policy user_notifications_read on public.user_notifications
for select to authenticated
using (
  (recipient_user_id = auth.uid() or public.is_system_admin() or public.is_direct_leader_of(recipient_user_id))
  and notification_type = 'task_assigned'
  and exists (
    select 1 from public.project_tasks task
    where task.id = entity_id
      and (case task.category when 'governance' then 'governanca' else 'projetos' end)
        = any(private.today_department_access(recipient_user_id))
      and exists (
        select 1 from public.project_task_assignees assignee
        where assignee.task_id = task.id and assignee.user_id = recipient_user_id
      )
  )
);

commit;
