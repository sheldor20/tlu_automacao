begin;

create table public.profile_payment_permissions (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  can_manage boolean not null default false
);
alter table public.profile_payment_permissions enable row level security;
create policy payment_permission_read on public.profile_payment_permissions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_system_admin()));
revoke all on public.profile_payment_permissions from anon, authenticated;
grant select on public.profile_payment_permissions to authenticated;
grant all on public.profile_payment_permissions to service_role;

create function public.can_manage_payments() returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.active and p.deleted_at is null
    and (p.is_admin or exists(select 1 from public.profile_payment_permissions a where a.user_id = p.user_id and a.can_manage)));
$$;
revoke all on function public.can_manage_payments() from public, anon;
grant execute on function public.can_manage_payments() to authenticated, service_role;

create table public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  protocol bigint generated always as identity unique,
  submission_id uuid not null unique,
  submission_digest text not null,
  requester_user_id uuid references public.profiles(user_id) on delete set null,
  requester_name text not null check(length(requester_name) between 1 and 200),
  requester_email text not null check(length(requester_email) <= 320),
  requester_phone text not null default '',
  company_key text not null,
  company_name text not null,
  project_name text not null default '',
  type text not null check(type in ('service','materials','termination','bills')),
  title text not null check(length(title) between 1 and 180),
  description text not null check(length(description) between 1 and 8000),
  amount numeric(14,2) not null check(amount > 0 and amount <= 999999999.99),
  budget_max numeric(14,2) check(budget_max >= 0 and budget_max <= 999999999.99),
  due_date date not null,
  beneficiary jsonb not null check(jsonb_typeof(beneficiary) = 'object'),
  details jsonb not null check(jsonb_typeof(details) = 'object'),
  quotes jsonb not null default '[]' check(jsonb_typeof(quotes) = 'array'),
  status text not null default 'submitted' check(status in ('submitted','reviewing','awaiting_information','approved','scheduled','paid','rejected','cancelled')),
  source text not null check(source in ('internal','public','whatsapp','email')),
  source_reference text,
  scheduled_date date,
  paid_at timestamptz,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((status <> 'scheduled' or scheduled_date is not null) and (status <> 'paid' or paid_at is not null))
);
create index payment_requests_owner_idx on public.payment_requests(requester_user_id, created_at desc);
create index payment_requests_status_due_idx on public.payment_requests(status, due_date);
create index payment_requests_company_idx on public.payment_requests(company_key);
alter table public.payment_requests enable row level security;
create policy payment_request_read on public.payment_requests for select to authenticated using (
  (select public.can_manage_payments()) or (requester_user_id = (select auth.uid()) and exists(select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.active and p.deleted_at is null))
);
revoke all on public.payment_requests from anon, authenticated;
grant select on public.payment_requests to authenticated;
grant all on public.payment_requests to service_role;
grant usage,select on sequence public.payment_requests_protocol_seq to service_role;

-- Capability secrets are deliberately separate from requester-visible records.
create table public.payment_request_tokens (
  request_id uuid primary key references public.payment_requests(id) on delete cascade,
  token_hash text not null unique,
  token text not null
);
create table public.payment_request_files (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.payment_requests(id) on delete cascade,
  path text not null unique,
  name text not null check(length(name) between 1 and 200),
  kind text not null check(kind in ('support','quote','receipt')),
  size bigint not null check(size between 1 and 10485760),
  mime_type text not null,
  ready boolean not null default false,
  uploaded_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now()
);
create index payment_files_request_idx on public.payment_request_files(request_id);
create index payment_files_uploader_idx on public.payment_request_files(uploaded_by);
create table public.payment_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.payment_requests(id) on delete cascade,
  kind text not null,
  status text not null,
  message text not null default '',
  actor_id uuid references public.profiles(user_id) on delete set null,
  actor_name text not null,
  created_at timestamptz not null default now()
);
create index payment_events_request_idx on public.payment_request_events(request_id, created_at);
create index payment_events_actor_idx on public.payment_request_events(actor_id);
create table public.payment_email_outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.payment_request_events(id) on delete cascade,
  request_id uuid not null references public.payment_requests(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','sending','sent','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  lease_id uuid,
  provider_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index payment_outbox_claim_idx on public.payment_email_outbox(status,available_at);
create index payment_outbox_request_idx on public.payment_email_outbox(request_id);
create table public.payment_rate_limits (key text primary key, started_at timestamptz not null default now(), hits integer not null default 1);

alter table public.payment_request_tokens enable row level security;
alter table public.payment_request_files enable row level security;
alter table public.payment_request_events enable row level security;
alter table public.payment_email_outbox enable row level security;
alter table public.payment_rate_limits enable row level security;
revoke all on public.payment_request_tokens, public.payment_request_files, public.payment_request_events, public.payment_email_outbox, public.payment_rate_limits from anon, authenticated;
grant all on public.payment_request_tokens, public.payment_request_files, public.payment_request_events, public.payment_email_outbox, public.payment_rate_limits to service_role;
create policy payment_files_read on public.payment_request_files for select to authenticated using (ready and exists(select 1 from public.payment_requests r where r.id=request_id));
create policy payment_events_read on public.payment_request_events for select to authenticated using (exists(select 1 from public.payment_requests r where r.id=request_id));
grant select on public.payment_request_files,public.payment_request_events to authenticated;

create function public.enqueue_payment_email() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  insert into public.payment_email_outbox(event_id,request_id) values(new.id,new.request_id);
  return new;
end;
$$;
revoke all on function public.enqueue_payment_email() from public,anon,authenticated;
create trigger payment_email_after_event after insert on public.payment_request_events for each row execute function public.enqueue_payment_email();

create function public.payment_check_rate(p_key text,p_limit integer,p_window integer) returns boolean language plpgsql security invoker set search_path='' as $$
declare v_hits integer;
begin
  if p_limit < 1 or p_window < 1 then raise exception 'invalid_rate_limit'; end if;
  insert into public.payment_rate_limits(key) values(p_key)
  on conflict(key) do update set
    hits=case when payment_rate_limits.started_at < now()-make_interval(secs=>p_window) then 1 else payment_rate_limits.hits+1 end,
    started_at=case when payment_rate_limits.started_at < now()-make_interval(secs=>p_window) then now() else payment_rate_limits.started_at end
  returning hits into v_hits;
  delete from public.payment_rate_limits where started_at < now()-interval '2 days';
  return v_hits <= p_limit;
end;
$$;

create function public.create_payment_request(p_data jsonb,p_actor uuid,p_token text,p_token_hash text,p_digest text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request public.payment_requests%rowtype; v_company text; v_profile public.profiles%rowtype; v_snapshot uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_data->>'submission_id'));
  select * into v_request from public.payment_requests where submission_id=(p_data->>'submission_id')::uuid;
  if found then
    if v_request.submission_digest <> p_digest or v_request.requester_user_id is distinct from p_actor then raise exception 'submission_conflict'; end if;
    return jsonb_build_object('id',v_request.id,'protocol',v_request.protocol,'token',(select token from public.payment_request_tokens where request_id=v_request.id));
  end if;
  if p_actor is not null then
    select * into v_profile from public.profiles where user_id=p_actor and active and deleted_at is null;
    if not found then raise exception 'payment_forbidden'; end if;
  end if;
  select id into v_snapshot from public.enterprise_performance_snapshots order by captured_at desc,id desc limit 1;
  select name into v_company from public.enterprise_performance_companies where snapshot_id=v_snapshot and company_key=p_data->>'company_key';
  if v_company is null then raise exception 'payment_company_not_found'; end if;
  insert into public.payment_requests(submission_id,submission_digest,requester_user_id,requester_name,requester_email,requester_phone,
    company_key,company_name,project_name,type,title,description,amount,budget_max,due_date,beneficiary,details,quotes,source)
  values((p_data->>'submission_id')::uuid,p_digest,p_actor,p_data->>'requester_name',p_data->>'requester_email',p_data->>'requester_phone',
    p_data->>'company_key',v_company,p_data->>'project_name',p_data->'details'->>'type',p_data->>'title',p_data->>'description',(p_data->>'amount')::numeric,
    (p_data->>'budget_max')::numeric,(p_data->>'due_date')::date,p_data->'beneficiary',p_data->'details',p_data->'quotes',case when p_actor is null then 'public' else 'internal' end)
  returning * into v_request;
  insert into public.payment_request_tokens(request_id,token,token_hash) values(v_request.id,p_token,p_token_hash);
  insert into public.payment_request_events(request_id,kind,status,message,actor_id,actor_name)
    values(v_request.id,'created','submitted','Solicitação recebida.',p_actor,v_request.requester_name);
  return jsonb_build_object('id',v_request.id,'protocol',v_request.protocol,'token',p_token);
end;
$$;

create function public.payment_request_action(p_id uuid,p_actor uuid,p_token_hash text,p_action text,p_payload jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare r public.payment_requests%rowtype; v_manager boolean := false; v_name text; v_status text; v_kind text; v_message text;
begin
  select * into r from public.payment_requests where id=p_id for update;
  if not found then raise exception 'payment_not_found'; end if;
  if p_actor is not null then
    select p.full_name,(p.is_admin or coalesce(a.can_manage,false)) into v_name,v_manager from public.profiles p
      left join public.profile_payment_permissions a on a.user_id=p.user_id where p.user_id=p_actor and p.active and p.deleted_at is null;
    if not found or (not v_manager and r.requester_user_id is distinct from p_actor) then raise exception 'payment_forbidden'; end if;
  else
    if not exists(select 1 from public.payment_request_tokens where request_id=p_id and token_hash=p_token_hash) then raise exception 'payment_forbidden'; end if;
    v_name := r.requester_name;
  end if;
  if (p_payload->>'version')::integer is distinct from r.version then raise exception 'payment_conflict'; end if;
  if r.status in ('paid','rejected','cancelled') then raise exception 'payment_closed'; end if;
  v_message := btrim(coalesce(p_payload->>'message',''));
  v_status := r.status;
  if p_action='reply' then
    if length(v_message) not between 1 and 5000 then raise exception 'payment_message_required'; end if;
    v_kind := 'reply';
    if r.status='awaiting_information' and not v_manager then v_status := 'reviewing'; end if;
  elsif p_action in ('request_info','status') then
    if not v_manager then raise exception 'payment_forbidden'; end if;
    v_status := case when p_action='request_info' then 'awaiting_information' else p_payload->>'status' end;
    if not coalesce(case r.status
      when 'submitted' then v_status in ('reviewing','awaiting_information','rejected','cancelled')
      when 'reviewing' then v_status in ('awaiting_information','approved','rejected','cancelled')
      when 'awaiting_information' then v_status in ('reviewing','rejected','cancelled')
      when 'approved' then v_status in ('scheduled','paid','awaiting_information','cancelled')
      when 'scheduled' then v_status in ('paid','awaiting_information','cancelled') else false end,false) then raise exception 'payment_invalid_transition'; end if;
    if v_status in ('awaiting_information','rejected','cancelled') and length(v_message)=0 then raise exception 'payment_message_required'; end if;
    if v_status='scheduled' and nullif(p_payload->>'scheduled_date','') is null then raise exception 'payment_schedule_required'; end if;
    if v_status='paid' and not exists(select 1 from public.payment_request_files where request_id=p_id and kind='receipt' and ready) then raise exception 'payment_receipt_required'; end if;
    v_kind := case when v_status='awaiting_information' then 'information_requested' else 'status_changed' end;
  else raise exception 'payment_invalid_action'; end if;
  update public.payment_requests set status=v_status,version=version+1,updated_at=now(),
    scheduled_date=case when v_status='scheduled' then (p_payload->>'scheduled_date')::date else scheduled_date end,
    paid_at=case when v_status='paid' then now() else paid_at end where id=p_id;
  insert into public.payment_request_events(request_id,kind,status,message,actor_id,actor_name) values(p_id,v_kind,v_status,v_message,p_actor,coalesce(v_name,'Usuário'));
end;
$$;

create function public.complete_payment_file(p_file_id uuid,p_actor uuid,p_token_hash text) returns void language plpgsql security invoker set search_path='' as $$
declare f public.payment_request_files%rowtype; r public.payment_requests%rowtype; v_manager boolean := false; v_name text;
begin
  select * into f from public.payment_request_files where id=p_file_id;
  if not found then raise exception 'payment_not_found'; end if;
  select * into r from public.payment_requests where id=f.request_id for update;
  if p_actor is not null then
    select p.full_name,(p.is_admin or coalesce(a.can_manage,false)) into v_name,v_manager from public.profiles p
      left join public.profile_payment_permissions a on a.user_id=p.user_id where p.user_id=p_actor and p.active and p.deleted_at is null;
    if not found or (not v_manager and r.requester_user_id is distinct from p_actor) then raise exception 'payment_forbidden'; end if;
  else
    if not exists(select 1 from public.payment_request_tokens where request_id=r.id and token_hash=p_token_hash) then raise exception 'payment_forbidden'; end if;
    v_name := r.requester_name;
  end if;
  if f.kind='receipt' and not v_manager then raise exception 'payment_forbidden'; end if;
  if r.status in ('paid','rejected','cancelled') then raise exception 'payment_closed'; end if;
  update public.payment_request_files set ready=true where id=p_file_id and not ready;
  if found then
    insert into public.payment_request_events(request_id,kind,status,message,actor_id,actor_name)
      values(r.id,'file_uploaded',r.status,case when f.kind='receipt' then 'Comprovante de pagamento anexado: ' else 'Documento anexado: ' end || f.name,p_actor,coalesce(v_name,'Usuário'));
  end if;
end;
$$;
revoke all on function public.complete_payment_file(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.complete_payment_file(uuid,uuid,text) to service_role;

create function public.claim_payment_emails(p_limit integer default 10) returns setof public.payment_email_outbox language sql security invoker set search_path='' as $$
  with candidates as (
    select id from public.payment_email_outbox where attempts < 12 and ((status in ('pending','failed') and available_at <= now()) or (status='sending' and locked_until < now()))
    order by created_at for update skip locked limit least(greatest(p_limit,1),20)
  ) update public.payment_email_outbox o set status='sending',attempts=attempts+1,locked_until=now()+interval '10 minutes',lease_id=gen_random_uuid()
    from candidates c where o.id=c.id returning o.*;
$$;

revoke all on function public.payment_check_rate(text,integer,integer), public.create_payment_request(jsonb,uuid,text,text,text), public.payment_request_action(uuid,uuid,text,text,jsonb), public.claim_payment_emails(integer) from public,anon,authenticated;
grant execute on function public.payment_check_rate(text,integer,integer), public.create_payment_request(jsonb,uuid,text,text,text), public.payment_request_action(uuid,uuid,text,text,jsonb), public.claim_payment_emails(integer) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('payment-documents','payment-documents',false,10485760,
  array['application/pdf','image/jpeg','image/png','image/webp','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
-- No direct storage policies. All upload/download capabilities follow server authorization.
commit;
