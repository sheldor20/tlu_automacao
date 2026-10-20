begin;
create table public.profile_contract_permissions (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  can_manage boolean not null default false
);
alter table public.profile_contract_permissions enable row level security;
create policy contract_permission_read on public.profile_contract_permissions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_system_admin()));
revoke all on public.profile_contract_permissions from anon, authenticated;
grant select on public.profile_contract_permissions to authenticated;
grant all on public.profile_contract_permissions to service_role;

create table public.contract_requests (
  id uuid primary key default gen_random_uuid(),
  protocol bigint generated always as identity unique,
  submission_id uuid not null unique,
  submission_digest text not null,
  tracking_token_hash text not null unique check (tracking_token_hash ~ '^[a-f0-9]{64}$'),
  requester_user_id uuid references public.profiles(user_id) on delete set null,
  requester_name text not null check (length(requester_name) between 1 and 200),
  requester_email text not null check (length(requester_email) between 3 and 320),
  details jsonb not null check (jsonb_typeof(details) = 'object' and details->>'type' in ('rental','services','purchase','amendment','termination','other')),
  status text not null default 'in_progress' check (status in ('in_progress','finalizing','missing_information')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contract_requests_requester on public.contract_requests(requester_user_id, created_at desc);
create index contract_requests_status on public.contract_requests(status, created_at desc);
create table public.contract_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.contract_requests(id) on delete cascade,
  actor_user_id uuid references public.profiles(user_id) on delete set null,
  actor_name text not null,
  kind text not null check(kind in ('created','updated','message','status')),
  status text not null check(status in ('in_progress','finalizing','missing_information')),
  message text not null default '',
  created_at timestamptz not null default now()
);
create index contract_request_events_request on public.contract_request_events(request_id, created_at);
-- All contract data, including token hashes, is accessed through authenticated server routes only.
alter table public.contract_requests enable row level security;
alter table public.contract_request_events enable row level security;
revoke all on public.contract_requests, public.contract_request_events from anon, authenticated;
grant all on public.contract_requests, public.contract_request_events to service_role;
grant usage, select on sequence public.contract_requests_protocol_seq to service_role;

create function public.contract_created_event() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.contract_request_events(request_id,actor_user_id,actor_name,kind,status,message)
    values(new.id,new.requester_user_id,new.requester_name,'created',new.status,'Solicitação de contrato recebida.');
  return new;
end;
$$;
revoke all on function public.contract_created_event() from public, anon, authenticated;
grant execute on function public.contract_created_event() to service_role;
create trigger contract_created after insert on public.contract_requests for each row execute function public.contract_created_event();

create function public.update_contract_request(p_id uuid, p_actor uuid, p_token_hash text, p_version integer,
  p_status text, p_details jsonb, p_message text) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.contract_requests; v_name text; v_manager boolean := false; v_owner boolean := false;
begin
  select * into r from public.contract_requests where id=p_id for update;
  if not found then raise exception 'contract_not_found'; end if;
  if p_actor is not null then
    select p.full_name,(p.is_admin or coalesce(c.can_manage,false)) into v_name,v_manager
      from public.profiles p left join public.profile_contract_permissions c on c.user_id=p.user_id
      where p.user_id=p_actor and p.active and p.deleted_at is null;
    if not found then raise exception 'contract_forbidden'; end if;
    v_owner := r.requester_user_id=p_actor;
  else
    v_owner := r.requester_user_id is null and p_token_hash is not null and r.tracking_token_hash=p_token_hash;
    v_name := r.requester_name;
  end if;
  if not (coalesce(v_manager,false) or coalesce(v_owner,false)) then raise exception 'contract_forbidden'; end if;
  if r.version<>p_version then raise exception 'contract_conflict'; end if;
  if p_status is not null and not v_manager then raise exception 'contract_forbidden'; end if;
  if p_status is not null and p_status not in ('in_progress','finalizing','missing_information') then raise exception 'contract_invalid_status'; end if;
  if p_status='missing_information' and length(trim(coalesce(p_message,'')))=0 then raise exception 'contract_message_required'; end if;
  if p_details is not null and not v_manager and r.status<>'missing_information' then raise exception 'contract_edit_forbidden'; end if;
  if p_details is null and p_status is null and length(trim(coalesce(p_message,'')))=0 then raise exception 'contract_empty_update'; end if;
  update public.contract_requests set details=coalesce(p_details,r.details),
    status=coalesce(p_status,case when p_details is not null and not v_manager then 'in_progress' else r.status end),
    version=version+1,updated_at=clock_timestamp() where id=p_id returning * into r;
  insert into public.contract_request_events(request_id,actor_user_id,actor_name,kind,status,message)
    values(p_id,p_actor,v_name,case when p_details is not null then 'updated' when p_status is not null then 'status' else 'message' end,
      r.status,coalesce(nullif(trim(p_message),''),'Dados do contrato atualizados.'));
  return to_jsonb(r)-'tracking_token_hash'-'submission_digest'-'submission_id';
end;
$$;
revoke all on function public.update_contract_request(uuid,uuid,text,integer,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.update_contract_request(uuid,uuid,text,integer,text,jsonb,text) to service_role;
commit;
