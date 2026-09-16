begin;

alter table public.payment_requests add column deleted_at timestamptz;
alter table public.payment_requests add column deleted_by uuid references public.profiles(user_id) on delete set null;
create index payment_requests_deleted_by_idx on public.payment_requests(deleted_by) where deleted_by is not null;

-- Excluded requests and their files/history are hidden even through direct Data API reads.
alter policy payment_request_read on public.payment_requests using (
  deleted_at is null and (
    (select public.can_manage_payments()) or
    (requester_user_id = (select auth.uid()) and exists (
      select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.active and p.deleted_at is null
    ))
  )
);

-- Original values remain available only to the server for auditing.
create table public.payment_request_revisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.payment_requests(id) on delete cascade,
  actor_id uuid references public.profiles(user_id) on delete set null,
  action text not null check(action in ('edit','delete')),
  before_data jsonb not null,
  after_data jsonb not null,
  created_at timestamptz not null default now()
);
create index payment_revisions_request_idx on public.payment_request_revisions(request_id,created_at);
create index payment_revisions_actor_idx on public.payment_request_revisions(actor_id);
alter table public.payment_request_revisions enable row level security;
create policy payment_revisions_deny_browser on public.payment_request_revisions for all to anon,authenticated using(false) with check(false);
revoke all on public.payment_request_revisions from public,anon,authenticated;
grant all on public.payment_request_revisions to service_role;

create function public.manage_payment_request(p_id uuid,p_actor uuid,p_version integer,p_action text,p_data jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare
  r public.payment_requests%rowtype;
  v_after public.payment_requests%rowtype;
  v_name text; v_company text; v_snapshot uuid; v_type text;
begin
  select p.full_name into v_name from public.profiles p
    left join public.profile_payment_permissions a on a.user_id=p.user_id
    where p.user_id=p_actor and p.active and p.deleted_at is null and (p.is_admin or coalesce(a.can_manage,false));
  if not found then raise exception 'payment_forbidden'; end if;
  select * into r from public.payment_requests where id=p_id for update;
  if not found or r.deleted_at is not null then raise exception 'payment_not_found'; end if;
  if p_version is distinct from r.version then raise exception 'payment_conflict'; end if;
  if p_action='delete' then
    update public.payment_requests set deleted_at=now(),deleted_by=p_actor,version=version+1,updated_at=now() where id=p_id;
  elsif p_action='edit' then
    v_type := p_data->'details'->>'type';
    if r.status in ('paid','finalized') and v_type in ('service','termination') and not exists (
      select 1 from public.payment_request_files where request_id=p_id and kind='receipt' and ready
    ) then raise exception 'payment_receipt_required'; end if;
    if p_data->>'company_key'=r.company_key then
      v_company := r.company_name;
    else
      select id into v_snapshot from public.enterprise_performance_snapshots order by captured_at desc,id desc limit 1;
      select name into v_company from public.enterprise_performance_companies where snapshot_id=v_snapshot and company_key=p_data->>'company_key';
      if v_company is null then raise exception 'payment_company_not_found'; end if;
    end if;
    update public.payment_requests set
      requester_name=p_data->>'requester_name',requester_email=p_data->>'requester_email',
      requester_phone=p_data->>'requester_phone',company_key=p_data->>'company_key',company_name=v_company,
      project_name=p_data->>'project_name',type=v_type,title=p_data->>'title',description=p_data->>'description',
      amount=(p_data->>'amount')::numeric,budget_max=(p_data->>'budget_max')::numeric,due_date=(p_data->>'due_date')::date,
      beneficiary=p_data->'beneficiary',details=p_data->'details',quotes=p_data->'quotes',
      version=version+1,updated_at=now()
      where id=p_id;
  else raise exception 'payment_invalid_action'; end if;
  select * into v_after from public.payment_requests where id=p_id;
  insert into public.payment_request_revisions(request_id,actor_id,action,before_data,after_data)
    values(p_id,p_actor,p_action,to_jsonb(r)-'submission_digest'-'submission_id',to_jsonb(v_after)-'submission_digest'-'submission_id');
  insert into public.payment_request_events(request_id,kind,status,message,actor_id,actor_name)
    values(p_id,case when p_action='delete' then 'deleted' else 'edited' end,r.status,
      case when p_action='delete' then 'Solicitação excluída pela gestão de pagamentos.' else 'Dados da solicitação atualizados pela gestão de pagamentos.' end,
      p_actor,coalesce(v_name,'Gestão de pagamentos'));
end;
$$;
revoke all on function public.manage_payment_request(uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_payment_request(uuid,uuid,integer,text,jsonb) to service_role;

create or replace function public.payment_request_action(p_id uuid,p_actor uuid,p_token_hash text,p_action text,p_payload jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare r public.payment_requests%rowtype; v_manager boolean := false; v_name text; v_status text; v_kind text; v_message text;
begin
  select * into r from public.payment_requests where id=p_id for update;
  if not found or r.deleted_at is not null then raise exception 'payment_not_found'; end if;
  if p_actor is not null then
    select p.full_name,(p.is_admin or coalesce(a.can_manage,false)) into v_name,v_manager from public.profiles p
      left join public.profile_payment_permissions a on a.user_id=p.user_id where p.user_id=p_actor and p.active and p.deleted_at is null;
    if not found or (not v_manager and r.requester_user_id is distinct from p_actor) then raise exception 'payment_forbidden'; end if;
  else
    if not exists(select 1 from public.payment_request_tokens where request_id=p_id and token_hash=p_token_hash) then raise exception 'payment_forbidden'; end if;
    v_name := r.requester_name;
  end if;
  if (p_payload->>'version')::integer is distinct from r.version then raise exception 'payment_conflict'; end if;
  if r.status in ('finalized','rejected','cancelled') or (r.status='paid' and (p_action is distinct from 'status' or p_payload->>'status' is distinct from 'finalized')) then raise exception 'payment_closed'; end if;
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
      when 'scheduled' then v_status in ('paid','awaiting_information','cancelled')
      when 'paid' then v_status='finalized' else false end,false) then raise exception 'payment_invalid_transition'; end if;
    if v_status in ('awaiting_information','rejected','cancelled') and length(v_message)=0 then raise exception 'payment_message_required'; end if;
    if v_status='scheduled' and nullif(p_payload->>'scheduled_date','') is null then raise exception 'payment_schedule_required'; end if;
    if v_status in ('paid','finalized') and r.type in ('service','termination') and not exists(select 1 from public.payment_request_files where request_id=p_id and kind='receipt' and ready) then raise exception 'payment_receipt_required'; end if;
    v_kind := case when v_status='awaiting_information' then 'information_requested' else 'status_changed' end;
  else raise exception 'payment_invalid_action'; end if;
  update public.payment_requests set status=v_status,version=version+1,updated_at=now(),
    scheduled_date=case when v_status='scheduled' then (p_payload->>'scheduled_date')::date else scheduled_date end,
    paid_at=case when v_status='paid' then now() else paid_at end,
    finalized_at=case when v_status='finalized' then now() else finalized_at end where id=p_id;
  insert into public.payment_request_events(request_id,kind,status,message,actor_id,actor_name) values(p_id,v_kind,v_status,v_message,p_actor,coalesce(v_name,'Usuário'));
end;
$$;

create or replace function public.complete_payment_file(p_file_id uuid,p_actor uuid,p_token_hash text) returns void language plpgsql security invoker set search_path='' as $$
declare f public.payment_request_files%rowtype; r public.payment_requests%rowtype; v_manager boolean := false; v_name text;
begin
  select * into f from public.payment_request_files where id=p_file_id;
  if not found then raise exception 'payment_not_found'; end if;
  select * into r from public.payment_requests where id=f.request_id for update;
  if not found or r.deleted_at is not null then raise exception 'payment_not_found'; end if;
  if p_actor is not null then
    select p.full_name,(p.is_admin or coalesce(a.can_manage,false)) into v_name,v_manager from public.profiles p
      left join public.profile_payment_permissions a on a.user_id=p.user_id where p.user_id=p_actor and p.active and p.deleted_at is null;
    if not found or (not v_manager and r.requester_user_id is distinct from p_actor) then raise exception 'payment_forbidden'; end if;
  else
    if not exists(select 1 from public.payment_request_tokens where request_id=r.id and token_hash=p_token_hash) then raise exception 'payment_forbidden'; end if;
    v_name := r.requester_name;
  end if;
  if f.kind='receipt' and not v_manager then raise exception 'payment_forbidden'; end if;
  if r.status in ('paid','finalized','rejected','cancelled') then raise exception 'payment_closed'; end if;
  update public.payment_request_files set ready=true where id=p_file_id and not ready;
  if found then
    insert into public.payment_request_events(request_id,kind,status,message,actor_id,actor_name)
      values(r.id,'file_uploaded',r.status,case when f.kind='receipt' then 'Comprovante de pagamento anexado: ' else 'Documento anexado: ' end || f.name,p_actor,coalesce(v_name,'Usuário'));
  end if;
end;
$$;

create or replace function public.create_payment_request(p_data jsonb,p_actor uuid,p_token text,p_token_hash text,p_digest text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request public.payment_requests%rowtype; v_company text; v_profile public.profiles%rowtype; v_snapshot uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_data->>'submission_id'));
  select * into v_request from public.payment_requests where submission_id=(p_data->>'submission_id')::uuid;
  if found then
    if v_request.deleted_at is not null then raise exception 'payment_not_found'; end if;
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

revoke all on function public.payment_request_action(uuid,uuid,text,text,jsonb), public.complete_payment_file(uuid,uuid,text), public.create_payment_request(jsonb,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.payment_request_action(uuid,uuid,text,text,jsonb), public.complete_payment_file(uuid,uuid,text), public.create_payment_request(jsonb,uuid,text,text,text) to service_role;

commit;
