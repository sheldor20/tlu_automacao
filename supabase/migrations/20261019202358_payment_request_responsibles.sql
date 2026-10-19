begin;
create table public.payment_request_responsibles (
 request_id uuid not null references public.payment_requests(id) on delete cascade,
 user_id uuid not null references public.profiles(user_id) on delete cascade,
 assigned_by uuid references public.profiles(user_id) on delete set null,
 created_at timestamptz not null default now(), primary key(request_id,user_id)
);
create index payment_responsibles_user_idx on public.payment_request_responsibles(user_id,request_id);
create index payment_responsibles_assigner_idx on public.payment_request_responsibles(assigned_by);
alter table public.payment_request_responsibles enable row level security;
revoke all on public.payment_request_responsibles from public,anon,authenticated;
grant select on public.payment_request_responsibles to authenticated;
grant all on public.payment_request_responsibles to service_role;
create policy payment_responsibles_read on public.payment_request_responsibles for select to authenticated using (
 exists(select 1 from public.profiles p where p.user_id=(select auth.uid()) and p.active and p.deleted_at is null)
 and (user_id=(select auth.uid()) or (select public.can_manage_payments()))
);
create function public.is_payment_responsible(p_id uuid,p_actor uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.payment_request_responsibles a join public.profiles p on p.user_id=a.user_id
 where a.request_id=p_id and a.user_id=p_actor and p.active and p.deleted_at is null)
$$;
revoke all on function public.is_payment_responsible(uuid,uuid) from public,anon,authenticated;
grant execute on function public.is_payment_responsible(uuid,uuid) to service_role;
alter policy payment_request_read on public.payment_requests using (
 deleted_at is null and (
 (select public.can_manage_payments()) or
 exists(select 1 from public.profiles p where p.user_id=(select auth.uid()) and p.active and p.deleted_at is null
 and (requester_user_id=p.user_id or exists(select 1 from public.payment_request_responsibles a where a.request_id=payment_requests.id and a.user_id=p.user_id)))
 ));
-- Extend the existing per-request checks without changing lifecycle validation.
do $$
declare def text; sig text;
begin
 foreach sig in array array['public.payment_request_action(uuid,uuid,text,text,jsonb)','public.complete_payment_file(uuid,uuid,text)'] loop
  def:=pg_get_functiondef(sig::regprocedure);
  if position('(p.is_admin or coalesce(a.can_manage,false))' in def)=0 then raise exception 'Unexpected payment permission definition'; end if;
  def:=replace(def,'(p.is_admin or coalesce(a.can_manage,false))','(p.is_admin or coalesce(a.can_manage,false) or public.is_payment_responsible(r.id,p_actor))');
  execute def;
 end loop;
 def:=pg_get_functiondef('public.manage_payment_request(uuid,uuid,integer,text,jsonb)'::regprocedure);
 def:=replace(def,$old$if not v_manager and (p_action <> 'edit' or r.requester_user_id is distinct from p_actor)$old$,$new$if not v_manager and (p_action <> 'edit' or (r.requester_user_id is distinct from p_actor and not public.is_payment_responsible(p_id,p_actor)))$new$);
 execute def;
end $$;
create function public.assign_payment_responsible(p_id uuid,p_actor uuid,p_user uuid,p_remove boolean,p_version integer) returns void language plpgsql security invoker set search_path='' as $$
declare r public.payment_requests%rowtype; actor_name text; target_name text; changed integer;
begin
 select p.full_name into actor_name from public.profiles p left join public.profile_payment_permissions a on a.user_id=p.user_id
 where p.user_id=p_actor and p.active and p.deleted_at is null and (p.is_admin or coalesce(a.can_manage,false));
 if not found then raise exception 'payment_forbidden'; end if;
 select * into r from public.payment_requests where id=p_id for update;
 if not found or r.deleted_at is not null then raise exception 'payment_not_found'; end if;
 if r.version is distinct from p_version then raise exception 'payment_conflict'; end if;
 select full_name into target_name from public.profiles where user_id=p_user and (p_remove or (active and deleted_at is null));
 if not found then raise exception 'payment_forbidden'; end if;
 if p_remove then
  delete from public.payment_request_responsibles where request_id=p_id and user_id=p_user;
 else
  insert into public.payment_request_responsibles(request_id,user_id,assigned_by) values(p_id,p_user,p_actor) on conflict do nothing;
 end if;
 get diagnostics changed = row_count;
 if changed=0 then return; end if;
 update public.payment_requests set version=version+1,updated_at=now() where id=p_id;
 insert into public.payment_request_events(request_id,kind,status,message,actor_id,actor_name)
 values(p_id,'reply',r.status,case when p_remove then 'Responsável removido: ' else 'Responsável vinculado: ' end||target_name,p_actor,actor_name);
end $$;
revoke all on function public.assign_payment_responsible(uuid,uuid,uuid,boolean,integer) from public,anon,authenticated;
grant execute on function public.assign_payment_responsible(uuid,uuid,uuid,boolean,integer) to service_role;
commit;
