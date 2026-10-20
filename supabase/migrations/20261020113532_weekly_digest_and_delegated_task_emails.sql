begin;
-- Preserve real authorship on every creation path, including templates and RA.
alter table public.project_tasks add column creator_name text;
update public.project_tasks t set creator_name=p.full_name from public.profiles p where p.user_id=t.created_by;
create function private.prepare_task_creator() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='INSERT' then
    new.created_by := coalesce(auth.uid(),new.created_by);
    select full_name into new.creator_name from public.profiles where user_id=new.created_by;
  else
    new.created_by:=old.created_by; new.creator_name:=old.creator_name;
  end if;
  return new;
end; $$;
revoke all on function private.prepare_task_creator() from public,anon,authenticated;
create trigger task_creator_before_write before insert or update on public.project_tasks for each row execute function private.prepare_task_creator();

-- These helpers are internal only. Evaluate existing access functions as the
-- recipient, restoring the caller's claims before returning, including errors.
create function private.task_recipient_access(p_user uuid,p_task uuid,p_comment boolean default false) returns boolean
language plpgsql security invoker set search_path='' as $$
declare saved text:=current_setting('request.jwt.claims',true); allowed boolean;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','authenticated')::text,true);
  select exists(select 1 from public.profiles where user_id=p_user and active and deleted_at is null)
    and public.can_read_project_task(p_task)
    and (not p_comment or public.can_access_project_task_activity(p_task,'comment',false)) into allowed;
  perform set_config('request.jwt.claims',coalesce(saved,''),true);
  return allowed;
exception when others then
  perform set_config('request.jwt.claims',coalesce(saved,''),true); raise;
end; $$;
revoke all on function private.task_recipient_access(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function private.task_recipient_access(uuid,uuid,boolean) to service_role;

create table public.task_email_outbox (
 id uuid primary key default gen_random_uuid(), task_id uuid not null references public.project_tasks(id) on delete cascade,
 user_id uuid not null references public.profiles(user_id) on delete cascade,
 recipient text not null, content jsonb not null, email_payload jsonb,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','skipped','expired')),
 attempts integer not null default 0, available_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '23 hours',
 locked_until timestamptz,lease_id uuid,provider_id text,sent_at timestamptz,last_error text,
 created_at timestamptz not null default now()
);
alter table public.task_email_outbox enable row level security;
revoke all on public.task_email_outbox from public,anon,authenticated;
grant all on public.task_email_outbox to service_role;
create index task_email_pending_idx on public.task_email_outbox(available_at,created_at) where status in ('pending','failed','sending');
create function private.enqueue_task_email() returns trigger language plpgsql security definer set search_path='' as $$
declare task public.project_tasks%rowtype; message text; event_kind text;
begin
  if TG_TABLE_NAME='project_tasks' then
    if new.status is not distinct from old.status then return new; end if;
    task:=new; event_kind:='status_changed'; message:=new.status::text;
  else
    if new.kind<>'comment' then return new; end if;
    select * into task from public.project_tasks where id=new.task_id;
    event_kind:='comment'; message:=new.body;
  end if;
  if auth.uid() is null or task.created_by is null then return new; end if;
  -- Only delegated work: at least one assignee must differ from its creator.
  if not (exists(select 1 from public.project_task_assignees where task_id=task.id and user_id<>task.created_by)
    or exists(select 1 from public.project_subtasks s join public.project_subtask_assignees a on a.subtask_id=s.id where s.task_id=task.id and a.user_id<>task.created_by)) then return new; end if;
  if not private.task_recipient_access(task.created_by,task.id,event_kind='comment') then return new; end if;
  insert into public.task_email_outbox(task_id,user_id,recipient,content)
  select task.id,p.user_id,lower(btrim(p.email)),jsonb_build_object('name',p.full_name,'title',task.title,'kind',event_kind,'message',message,
    'href',case task.category when 'governance' then '/governanca' else '/projetos' end || case when task.project_id is null then '#quadro-tarefas' else '/'||task.project_id||'?tab=tarefas' end)
  from public.profiles p where p.user_id=task.created_by and p.active and p.deleted_at is null;
  return new;
end; $$;
revoke all on function private.enqueue_task_email() from public,anon,authenticated;
create trigger task_email_after_status after update of status on public.project_tasks for each row execute function private.enqueue_task_email();
create trigger task_email_after_comment after insert on public.project_task_activity for each row execute function private.enqueue_task_email();
create or replace function public.claim_task_email()
returns setof public.task_email_outbox language plpgsql security invoker set search_path = '' as $$
begin
  update public.task_email_outbox set status = 'expired',locked_until = null
    where status in ('pending','failed','sending') and expires_at <= now();
  return query
    with candidate as (
      select id from public.task_email_outbox
      where expires_at > now() and attempts < 8
        and ((status in ('pending','failed') and available_at <= now()) or (status = 'sending' and locked_until < now()))
      order by created_at,id for update skip locked limit 1
    ) update public.task_email_outbox o
      set status = 'sending',attempts = attempts + 1,locked_until = now() + interval '5 minutes',lease_id = gen_random_uuid()
      from candidate c where o.id = c.id returning o.*;
end;
$$;
create function public.task_email_authorized(p_job uuid) returns boolean language sql security invoker set search_path='' as $$
select exists(select 1 from public.task_email_outbox o join public.profiles p on p.user_id=o.user_id
where o.id=p_job and o.expires_at>now() and lower(btrim(p.email))=o.recipient and private.task_recipient_access(o.user_id,o.task_id,o.content->>'kind'='comment'));
$$;
revoke all on function public.claim_task_email(),public.task_email_authorized(uuid) from public,anon,authenticated;
grant execute on function public.claim_task_email(),public.task_email_authorized(uuid) to service_role;

grant select on public.performance_agreements to service_role;

grant execute on function public.can_read_project_task(uuid), public.can_access_project_task_activity(uuid,text,boolean), public.has_project_access(uuid),
  public.has_department_access(text), public.can_access_ra_meeting(uuid), public.can_manage_processes(),
  public.has_indicator_area_access(text), public.can_access_performance_agreement(uuid),
  private.can_access_tlu_meeting(uuid) to service_role;

-- Expire old daily jobs so the transition cannot send a stale daily digest.
update public.daily_digest_outbox set status='expired',locked_until=null where status in ('pending','failed','sending');
create or replace function public.enqueue_daily_digests(p_now timestamptz default now())
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  local_now timestamp := timezone('America/Sao_Paulo', p_now);
  day date := local_now::date;
  cutoff timestamptz := (day + time '07:45') at time zone 'America/Sao_Paulo';
  previous_day date := day - 7;
  inserted integer;
begin
  if extract(isodow from day) <> 1 or p_now < cutoff then return 0; end if;
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
create function private.weekly_digest_sections(p_user uuid,p_day date) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare saved text:=current_setting('request.jwt.claims',true); result jsonb;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','authenticated')::text,true);
 select coalesce(jsonb_agg(to_jsonb(s) order by s.section,s.title),'[]'::jsonb) into result from (
   select 'Projetos'::text as section,p.id::text as id,p.name as title,p.status::text as detail,
     case p.category when 'governance' then '/governanca/' else '/projetos/' end||p.id as href
   from public.projects p where p.archived_at is null and public.has_project_access(p.id)
   union all
   select 'Reuniões',m.id::text,m.title,to_char(timezone('America/Sao_Paulo',m.scheduled_at),'DD/MM/YYYY HH24:MI'),'/pauta-ra'
   from public.ra_meetings m where m.archived_at is null and timezone('America/Sao_Paulo',m.scheduled_at)::date>=p_day
     and timezone('America/Sao_Paulo',m.scheduled_at)::date<p_day+7 and public.can_access_ra_meeting(m.id)
   union all
   select 'Novos negócios',b.stage::text,'Negócios · '||b.stage::text,count(*)::text||' negócio(s) nesta etapa','/novos-negocios'
   from public.businesses b where public.has_department_access('novos-negocios') and b.archived_at is null group by b.stage
   union all
   select 'Obras',c.status::text,'Obras · '||c.status::text,count(*)::text||' obra(s) neste status','/obras'
   from public.constructions c where public.has_department_access('obras') and c.archived_at is null group by c.status
   union all
   select 'Aluguéis',r.status::text,'Imóveis · '||r.status::text,count(*)::text||' imóvel(is) neste status','/alugueis'
   from public.rentals r where public.has_department_access('alugueis') group by r.status
   union all
   select 'Processos',b.id::text,b.title,b.status::text,'/processos'
   from public.business_processes b where public.has_department_access('processos')
     and b.status<>'arquivado' and (b.status='publicado' or public.can_manage_processes())
   union all
   select 'Acordo de Performance',a.id::text,a.cycle||' · '||(g.goal->>'title'),
     'Prazo: '||to_char((g.goal->>'due_date')::date,'DD/MM/YYYY')||' · Indicador: '||(g.goal->>'indicator')||' · Resultado esperado: '||(g.goal->>'expected_result'),
     '/acordo-performance'
   from public.performance_agreements a cross join lateral jsonb_array_elements(a.goals) g(goal)
   where public.can_access_performance_agreement(a.report_user_id)
     and a.starts_on<p_day+7 and a.ends_on>=p_day
     and (g.goal->>'due_date')::date<p_day+7
   union all
   select 'Indicadores',c.area,c.area,count(*)::text||' indicador(es) disponível(is) para acompanhamento','/indicadores/'||c.area
   from public.management_metric_catalog c where public.has_indicator_area_access(c.area) group by c.area
   union all
   select 'Áreas disponíveis',d.slug,d.name,'Consulte os acompanhamentos e pendências da semana','/'||d.slug
   from public.departments d where public.has_department_access(d.slug)
 ) s;
 perform set_config('request.jwt.claims',coalesce(saved,''),true);
 return result;
exception when others then
 perform set_config('request.jwt.claims',coalesce(saved,''),true); raise;
end; $$;
revoke all on function private.weekly_digest_sections(uuid,date) from public,anon,authenticated;
grant execute on function private.weekly_digest_sections(uuid,date) to service_role;
create or replace function public.daily_digest_content(p_job uuid)
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
    where t.status <> 'concluida' and t.due_date < job.digest_date + 7 and project.archived_at is null
      and private.daily_digest_task_access(job.user_id,t.id) and private.task_recipient_access(job.user_id,t.id)
      and (exists (select 1 from public.project_task_assignees a where a.task_id = t.id and a.user_id = job.user_id)
        or exists (select 1 from public.project_subtasks s join public.project_subtask_assignees a on a.subtask_id = s.id
          where s.task_id = t.id and a.user_id = job.user_id and s.completed_at is null))
  ), events as materialized (
    select r.id as request_id,r.protocol,r.title,r.status,
      coalesce(e.kind,'status_changed') as kind,coalesce(e.created_at,r.created_at) as created_at,r.id,
      1 as rank,coalesce(e.event_count,0) as event_count
    from public.payment_requests r cross join job
    left join lateral (
      select ev.kind,ev.created_at,count(*) over() as event_count from public.payment_request_events ev
      where ev.request_id=r.id and ev.created_at>job.window_start and ev.created_at<=job.window_end
      order by ev.created_at desc,ev.id desc limit 1
    ) e on true
    where private.daily_digest_payment_access(job.user_id,r.id)
      and (r.status not in ('finalized','rejected','cancelled') or e.event_count>0)
  ) select jsonb_build_object(
    'sections',private.weekly_digest_sections(job.user_id,job.digest_date),
    'weekly',true, 'name',coalesce(nullif(btrim(job.full_name),''),'Olá'), 'date',job.digest_date,
    'today_count',(select count(*) from tasks where not overdue),
    'overdue_count',(select count(*) from tasks where overdue),
    'payment_count',(select count(*) from events where rank = 1),
    'event_count',(select coalesce(sum(event_count),0) from events),
    'today',coalesce((select jsonb_agg(to_jsonb(t) order by t.due_date,t.id)
      from (select * from tasks where not overdue order by due_date,id limit 10) t),'[]'::jsonb),
    'overdue',coalesce((select jsonb_agg(to_jsonb(t) order by t.due_date,t.id)
      from (select * from tasks where overdue order by due_date,id limit 10) t),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id)
      from (select * from events where rank = 1 order by created_at desc,id limit 10) e),'[]'::jsonb)
  ) from job;
$$;
create or replace function public.daily_digest_authorized(p_job uuid)
returns boolean language sql security invoker set search_path = '' as $$
  select exists (
    select 1 from public.daily_digest_outbox o
    join public.profiles p on p.user_id = o.user_id and p.active and p.deleted_at is null
      and lower(btrim(p.email)) = o.recipient
    where o.id = p_job and o.expires_at > now()
      and coalesce(o.content->'sections','[]'::jsonb) = private.weekly_digest_sections(o.user_id,o.digest_date)
      and not exists (select 1 from jsonb_array_elements(coalesce(o.content->'today','[]') || coalesce(o.content->'overdue','[]')) item
        where not private.daily_digest_task_access(o.user_id,(item->>'id')::uuid) or not private.task_recipient_access(o.user_id,(item->>'id')::uuid))
      and not exists (select 1 from jsonb_array_elements(coalesce(o.content->'payments','[]')) item
        where not private.daily_digest_payment_access(o.user_id,(item->>'request_id')::uuid))
  );
$$;
commit;
