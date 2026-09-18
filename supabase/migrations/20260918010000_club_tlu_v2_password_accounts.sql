alter table public.club_memberships
 add column auth_user_id uuid unique references auth.users(id) on delete set null,
 add column password_ready boolean not null default false,
 add column last_login_at timestamptz;
create index club_memberships_auth_user_idx on public.club_memberships(auth_user_id) where auth_user_id is not null;
-- V2 requires a pre-registered membership bound to a confirmed Auth user with a password.
create or replace function club_private.actor(p_actor uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_email text;v_role text;v_name text;v_member public.club_memberships%rowtype;
begin
 if p_actor is null then raise exception 'club_forbidden';end if;
 select lower(email) into v_email from auth.users where id=p_actor and email_confirmed_at is not null and (banned_until is null or banned_until<=now());
 if v_email is null then raise exception 'club_forbidden';end if;
 select case when p.is_admin or d.access_level<>'viewer' then 'manager' else 'viewer' end,coalesce(p.full_name,p.email) into v_role,v_name from public.profiles p left join public.profile_departments d on d.user_id=p.user_id and d.department_slug='clientes' where p.user_id=p_actor and p.active and p.deleted_at is null and (p.is_admin or d.user_id is not null);
 if v_role is not null then return jsonb_build_object('role',v_role,'name',v_name);end if;
 select * into v_member from public.club_memberships where auth_user_id=p_actor and email=v_email and active and password_ready;
 if not found then raise exception 'club_forbidden';end if;
 if v_member.kind='partner' then select name into v_name from public.club_partners where id=v_member.partner_id and active; else select name into v_name from public.client_accounts where id=v_member.client_id;end if;
 if v_name is null then raise exception 'club_forbidden';end if;
 return jsonb_build_object('role',v_member.kind,'name',v_name,'partner_id',v_member.partner_id,'client_id',v_member.client_id,'membership_id',v_member.id);
end;$$;
revoke all on function club_private.actor(uuid) from public,anon,authenticated;grant execute on function club_private.actor(uuid) to service_role;
create function public.club_provision_target(p_actor uuid,p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a jsonb:=club_private.actor(p_actor);m public.club_memberships%rowtype;owner_name text;
begin if a->>'role'<>'manager' then raise exception 'club_forbidden';end if;select * into m from public.club_memberships where id=p_id for update;if not found or not m.active then raise exception 'club_not_found';end if;if m.kind='partner' then select name into owner_name from public.club_partners where id=m.partner_id and active;else select name into owner_name from public.client_accounts where id=m.client_id;end if;if owner_name is null then raise exception 'club_unavailable';end if;return jsonb_build_object('id',m.id,'email',m.email,'kind',m.kind,'owner_name',owner_name,'auth_user_id',m.auth_user_id,'password_ready',m.password_ready);end;$$;
revoke all on function public.club_provision_target(uuid,uuid) from public,anon,authenticated;grant execute on function public.club_provision_target(uuid,uuid) to service_role;
create function public.club_bind_auth_user(p_actor uuid,p_id uuid,p_auth_user uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a jsonb:=club_private.actor(p_actor);m public.club_memberships%rowtype;auth_email text;
begin if a->>'role'<>'manager' then raise exception 'club_forbidden';end if;select lower(email) into auth_email from auth.users where id=p_auth_user and email_confirmed_at is not null;select * into m from public.club_memberships where id=p_id for update;if not found or not m.active then raise exception 'club_not_found';end if;if auth_email is null or auth_email<>m.email then raise exception 'club_auth_mismatch';end if;update public.club_memberships set auth_user_id=p_auth_user,password_ready=true,updated_at=now() where id=p_id returning * into m;insert into public.club_events(actor_id,action,entity_id,details) values(p_actor,'credentials',m.id,jsonb_build_object('kind',m.kind));return jsonb_build_object('id',m.id,'email',m.email,'kind',m.kind,'password_ready',true);end;$$;
revoke all on function public.club_bind_auth_user(uuid,uuid,uuid) from public,anon,authenticated;grant execute on function public.club_bind_auth_user(uuid,uuid,uuid) to service_role;
create function public.club_mark_login(p_actor uuid) returns void language plpgsql security invoker set search_path='' as $$begin perform club_private.actor(p_actor);update public.club_memberships set last_login_at=now() where auth_user_id=p_actor and active and password_ready;end;$$;
revoke all on function public.club_mark_login(uuid) from public,anon,authenticated;grant execute on function public.club_mark_login(uuid) to service_role;
drop function if exists public.club_invite_target(uuid,uuid);