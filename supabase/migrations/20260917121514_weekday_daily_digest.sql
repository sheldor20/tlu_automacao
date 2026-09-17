begin;

-- Internal queue: only the server may read recipients, content or delivery state.
create table public.daily_digest_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  digest_date date not null,
  recipient text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped','expired')),
  content jsonb,
  email_payload jsonb,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  lease_id uuid,
  provider_id text,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique(user_id, digest_date),
  check(window_start < window_end and window_end < expires_at)
);
alter table public.daily_digest_outbox enable row level security;
revoke all on public.daily_digest_outbox from public, anon, authenticated;
grant all on public.daily_digest_outbox to service_role;
create index daily_digest_pending_idx on public.daily_digest_outbox(available_at, created_at)
  where status in ('pending','failed','sending');
create index daily_digest_sent_idx on public.daily_digest_outbox(user_id, window_end desc) where status = 'sent';
create index payment_events_digest_idx on public.payment_request_events(created_at, request_id);

create schema if not exists private;
grant usage on schema private to service_role;

-- An administrator also receives only their own assignments. Department grants
-- are enforced explicitly because the worker's service role bypasses RLS.
create function private.daily_digest_task_access(p_user uuid, p_task uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.project_tasks t
    join public.profiles p on p.user_id = p_user and p.active and p.deleted_at is null
    where t.id = p_task
      and (p.is_admin or exists (select 1 from public.profile_departments d
        where d.user_id = p_user and d.department_slug = case t.category when 'governance' then 'governanca' else 'projetos' end))
      and (exists (select 1 from public.project_task_assignees a where a.task_id = t.id and a.user_id = p_user)
        or exists (select 1 from public.project_subtasks s join public.project_subtask_assignees a on a.subtask_id = s.id
          where s.task_id = t.id and a.user_id = p_user))
  );
$$;
create function private.daily_digest_payment_access(p_user uuid, p_request uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.payment_requests r
    join public.profiles p on p.user_id = p_user and p.active and p.deleted_at is null
    where r.id = p_request and r.deleted_at is null
      and (r.requester_user_id = p_user or p.is_admin or exists (
        select 1 from public.profile_payment_permissions a where a.user_id = p_user and a.can_manage))
  );
$$;
revoke all on function private.daily_digest_task_access(uuid,uuid), private.daily_digest_payment_access(uuid,uuid) from public,anon,authenticated;
grant execute on function private.daily_digest_task_access(uuid,uuid), private.daily_digest_payment_access(uuid,uuid) to service_role;

create function public.enqueue_daily_digests(p_now timestamptz default now())
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  local_now timestamp := timezone('America/Sao_Paulo', p_now);
  day date := local_now::date;
  cutoff timestamptz := (day + time '07:45') at time zone 'America/Sao_Paulo';
  previous_day date := day - case when extract(isodow from day) = 1 then 3 else 1 end;
  inserted integer;
begin
  if extract(isodow from day) > 5 or p_now < cutoff then return 0; end if;
  insert into public.daily_digest_outbox(user_id,digest_date,recipient,window_start,window_end,expires_at,available_at)
  select p.user_id,day,lower(btrim(p.email)),
    coalesce((select max(o.window_end) from public.daily_digest_outbox o
      where o.user_id = p.user_id and o.status = 'sent' and o.window_end < cutoff),
      (previous_day + time '07:45') at time zone 'America/Sao_Paulo'),
    cutoff,(day + 1)::timestamp at time zone 'America/Sao_Paulo',p_now
  from public.profiles p where p.active and p.deleted_at is null
    and btrim(p.email) ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  on conflict(user_id,digest_date) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

create function public.claim_daily_digest()
returns setof public.daily_digest_outbox language plpgsql security invoker set search_path = '' as $$
begin
  update public.daily_digest_outbox set status = 'expired',locked_until = null
    where status in ('pending','failed','sending') and expires_at <= now();
  return query
    with candidate as (
      select id from public.daily_digest_outbox
      where expires_at > now() and window_end <= now() and attempts < 8
        and ((status in ('pending','failed') and available_at <= now()) or (status = 'sending' and locked_until < now()))
      order by created_at,id for update skip locked limit 1
    ) update public.daily_digest_outbox o
      set status = 'sending',attempts = attempts + 1,locked_until = now() + interval '5 minutes',lease_id = gen_random_uuid()
      from candidate c where o.id = c.id returning o.*;
end;
$$;

create function public.daily_digest_content(p_job uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with job as (
    select o.*,p.full_name from public.daily_digest_outbox o
    join public.profiles p on p.user_id = o.user_id and p.active and p.deleted_at is null
      and lower(btrim(p.email)) = o.recipient
    where o.id = p_job
  ), tasks as materialized (
    select t.id,t.title,t.due_date,
      coalesce(project.name,'Atividade avulsa') as project_name,
      (case t.category when 'governance' then '/governanca' else '/projetos' end)
        || case when t.project_id is null then '#quadro-tarefas' else '/' || t.project_id || '?tab=tarefas' end as href,
      t.due_date < job.digest_date as overdue
    from public.project_tasks t cross join job
    left join public.projects project on project.id = t.project_id
    where t.status <> 'concluida' and t.due_date <= job.digest_date and project.archived_at is null
      and private.daily_digest_task_access(job.user_id,t.id)
      and (exists (select 1 from public.project_task_assignees a where a.task_id = t.id and a.user_id = job.user_id)
        or exists (select 1 from public.project_subtasks s join public.project_subtask_assignees a on a.subtask_id = s.id
          where s.task_id = t.id and a.user_id = job.user_id and s.completed_at is null))
  ), events as materialized (
    select e.id,e.request_id,e.kind,e.status,e.created_at,r.protocol,r.title,
      row_number() over (partition by e.request_id order by e.created_at desc,e.id desc) as rank,
      count(*) over (partition by e.request_id) as event_count
    from public.payment_request_events e join public.payment_requests r on r.id = e.request_id cross join job
    where e.created_at > job.window_start and e.created_at <= job.window_end
      and private.daily_digest_payment_access(job.user_id,r.id)
  ) select jsonb_build_object(
    'name',coalesce(nullif(btrim(job.full_name),''),'Olá'), 'date',job.digest_date,
    'today_count',(select count(*) from tasks where not overdue),
    'overdue_count',(select count(*) from tasks where overdue),
    'payment_count',(select count(*) from events where rank = 1),
    'event_count',(select count(*) from events),
    'today',coalesce((select jsonb_agg(to_jsonb(t) order by t.due_date,t.id)
      from (select * from tasks where not overdue order by due_date,id limit 10) t),'[]'::jsonb),
    'overdue',coalesce((select jsonb_agg(to_jsonb(t) order by t.due_date,t.id)
      from (select * from tasks where overdue order by due_date,id limit 10) t),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id)
      from (select * from events where rank = 1 order by created_at desc,id limit 10) e),'[]'::jsonb)
  ) from job;
$$;

-- Revalidate recipients and every displayed item even when retrying a frozen
-- email. Never send an old snapshot after access or ownership has been removed.
create function public.daily_digest_authorized(p_job uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.daily_digest_outbox o
    join public.profiles p on p.user_id = o.user_id and p.active and p.deleted_at is null
      and lower(btrim(p.email)) = o.recipient
    where o.id = p_job and o.expires_at > now()
      and not exists (select 1 from jsonb_array_elements(coalesce(o.content->'today','[]') || coalesce(o.content->'overdue','[]')) item
        where not private.daily_digest_task_access(o.user_id,(item->>'id')::uuid))
      and not exists (select 1 from jsonb_array_elements(coalesce(o.content->'payments','[]')) item
        where not private.daily_digest_payment_access(o.user_id,(item->>'request_id')::uuid))
  );
$$;

revoke all on function public.enqueue_daily_digests(timestamptz),public.claim_daily_digest(),public.daily_digest_content(uuid),public.daily_digest_authorized(uuid) from public,anon,authenticated;
grant execute on function public.enqueue_daily_digests(timestamptz),public.claim_daily_digest(),public.daily_digest_content(uuid),public.daily_digest_authorized(uuid) to service_role;
commit;
