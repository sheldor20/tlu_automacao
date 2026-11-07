alter table public.club_memberships
 add column auth_user_id uuid unique references auth.users(id) on delete set null,
 add column password_ready boolean not null default false,
 add column last_login_at timestamptz;

create index club_memberships_auth_user_idx on public.club_memberships(auth_user_id) where auth_user_id is not null;

create or replace function club_private.actor(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_email text; v_role text; v_name text; v_member public.club_memberships%rowtype;
begin
 if p_actor is null then raise exception 'club_forbidden'; end if;
 select lower(u.email) into v_email from auth.users u
 where u.id=p_actor and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now());
 if v_email is null then raise exception 'club_forbidden'; end if;
 if exists(select 1 from public.profiles where user_id=p_actor and deleted_at is not null) then raise exception 'club_forbidden'; end if;
 select case when p.is_admin or d.access_level<>'viewer' then 'manager' else 'viewer' end,coalesce(p.full_name,p.email)
 into v_role,v_name
 from public.profiles p left join public.profile_departments d on d.user_id=p.user_id and d.department_slug='clientes'
 where p.user_id=p_actor and p.active and p.deleted_at is null and (p.is_admin or d.user_id is not null);
 if v_role is not null then return jsonb_build_object('role',v_role,'name',v_name); end if;
 select * into v_member from public.club_memberships
 where auth_user_id=p_actor and email=v_email and active and password_ready;
 if not found then raise exception 'club_forbidden'; end if;
 if v_member.kind='partner' then
  select name into v_name from public.club_partners where id=v_member.partner_id and active;
  if not found then raise exception 'club_forbidden'; end if;
 else
  select name into v_name from public.client_accounts where id=v_member.client_id;
  if not found then raise exception 'club_forbidden'; end if;
 end if;
 return jsonb_build_object('role',v_member.kind,'name',v_name,'partner_id',v_member.partner_id,'client_id',v_member.client_id,'membership_id',v_member.id);
end; $$;
revoke all on function club_private.actor(uuid) from public,anon,authenticated;
grant execute on function club_private.actor(uuid) to service_role;

create or replace function public.club_provision_target(p_actor uuid,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a jsonb:=club_private.actor(p_actor); m public.club_memberships%rowtype; owner_name text;
begin
 if a->>'role'<>'manager' then raise exception 'club_forbidden'; end if;
 select * into m from public.club_memberships where id=p_id for update;
 if not found then raise exception 'club_not_found'; end if;
 if not m.active then raise exception 'club_unavailable'; end if;
 if m.kind='partner' then
  select name into owner_name from public.club_partners where id=m.partner_id and active;
  if not found then raise exception 'club_unavailable'; end if;
 else
  select name into owner_name from public.client_accounts where id=m.client_id;
  if not found then raise exception 'club_unavailable'; end if;
 end if;
 return jsonb_build_object('id',m.id,'email',m.email,'kind',m.kind,'owner_name',owner_name,
   'auth_user_id',m.auth_user_id,'password_ready',m.password_ready);
end; $$;
revoke all on function public.club_provision_target(uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_provision_target(uuid,uuid) to service_role;

create or replace function public.club_bind_auth_user(p_actor uuid,p_id uuid,p_auth_user uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a jsonb:=club_private.actor(p_actor); m public.club_memberships%rowtype; auth_email text;
begin
 if a->>'role'<>'manager' then raise exception 'club_forbidden'; end if;
 select lower(email) into auth_email from auth.users where id=p_auth_user and email_confirmed_at is not null;
 if auth_email is null then raise exception 'club_auth_not_ready'; end if;
 select * into m from public.club_memberships where id=p_id for update;
 if not found or not m.active then raise exception 'club_not_found'; end if;
 if auth_email<>m.email then raise exception 'club_auth_mismatch'; end if;
 update public.club_memberships set auth_user_id=p_auth_user,password_ready=true,updated_at=now()
 where id=p_id returning * into m;
 insert into public.club_events(actor_id,action,entity_id,details)
 values(p_actor,'credentials',m.id,jsonb_build_object('kind',m.kind));
 return jsonb_build_object('id',m.id,'email',m.email,'kind',m.kind,'password_ready',true);
end; $$;
revoke all on function public.club_bind_auth_user(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_bind_auth_user(uuid,uuid,uuid) to service_role;

create or replace function public.club_mark_login(p_actor uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
 perform club_private.actor(p_actor);
 update public.club_memberships set last_login_at=now() where auth_user_id=p_actor and active and password_ready;
end; $$;
revoke all on function public.club_mark_login(uuid) from public,anon,authenticated;
grant execute on function public.club_mark_login(uuid) to service_role;

create or replace function public.club_workspace(p_actor uuid,p_tab text default 'offers',p_page integer default 0,p_search text default '',p_status text default 'all',p_partner uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare a jsonb:=club_private.actor(p_actor); r text:=a->>'role'; items jsonb:='[]'::jsonb; options jsonb:='[]'::jsonb;
 stats jsonb; total bigint:=0; offset_rows integer:=least(greatest(p_page,0),100000)*25;
begin
 if length(p_search)>120 or p_tab not in ('offers','partners','vouchers','members','clients') then raise exception 'club_invalid'; end if;
 if p_tab in ('members','clients') and r<>'manager' then raise exception 'club_forbidden'; end if;
 if p_tab='partners' and r not in ('manager','viewer') then raise exception 'club_forbidden'; end if;
 if p_tab='clients' then
  select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into items from (select id,name,email from public.client_accounts
   where length(btrim(p_search))>=2 and (name ilike '%'||p_search||'%' or id=p_search) order by name,id limit 25) c;
  return jsonb_build_object('items',items);
 end if;
 select jsonb_build_object('issued',count(*),'used',count(*) filter(where redeemed_at is not null),
  'available',count(*) filter(where redeemed_at is null and expires_at>now()),'expired',count(*) filter(where redeemed_at is null and expires_at<=now())) into stats
 from public.club_vouchers v where (r in ('manager','viewer') or (r='partner' and v.partner_id=(a->>'partner_id')::uuid) or (r='client' and v.client_id=a->>'client_id'))
  and (p_partner is null or v.partner_id=p_partner);
 if r in ('manager','viewer') then
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active) order by name),'[]'::jsonb) into options from public.club_partners;
 elsif r='partner' then
  select jsonb_build_array(jsonb_build_object('id',id,'name',name,'active',active)) into options from public.club_partners where id=(a->>'partner_id')::uuid;
 end if;
 if p_tab='offers' then
  with base as (
   select o.*,p.name as partner_name,p.category,p.city,case when o.ends_at<=now() then 'expired' when o.status='active' and o.starts_at>now() then 'scheduled' else o.status end as display_status
   from public.club_offers o join public.club_partners p on p.id=o.partner_id
   where (r in ('manager','viewer') or (r='partner' and o.partner_id=(a->>'partner_id')::uuid)
    or (r='client' and p.active and o.status='active' and o.starts_at<=now() and o.ends_at>now()))
   and (p_partner is null or o.partner_id=p_partner)
   and (o.title ilike '%'||p_search||'%' or p.name ilike '%'||p_search||'%' or o.benefit ilike '%'||p_search||'%')
  ), filtered as (select * from base where p_status='all' or display_status=p_status),
  paged as (select * from filtered order by created_at desc,id limit 25 offset offset_rows)
  select (select count(*) from filtered),coalesce(jsonb_agg(to_jsonb(pg)||jsonb_build_object('issued_count',c.issued,'used_count',c.used,'own_count',c.own)),'[]'::jsonb) into total,items
  from paged pg cross join lateral (select count(*) as issued,count(*) filter(where redeemed_at is not null) as used,count(*) filter(where client_id=a->>'client_id') as own
   from public.club_vouchers where offer_id=pg.id) c;
 elsif p_tab='partners' then
  with filtered as (select * from public.club_partners where (name ilike '%'||p_search||'%' or category ilike '%'||p_search||'%')
   and (p_status='all' or (p_status='active' and active) or (p_status='inactive' and not active))),
  paged as (select * from filtered order by name,id limit 25 offset offset_rows)
  select (select count(*) from filtered),coalesce(jsonb_agg(to_jsonb(pg)||jsonb_build_object(
   'offers_count',(select count(*) from public.club_offers where partner_id=pg.id),
   'issued_count',(select count(*) from public.club_vouchers where partner_id=pg.id),
   'used_count',(select count(*) from public.club_vouchers where partner_id=pg.id and redeemed_at is not null))),'[]'::jsonb) into total,items from paged pg;
 elsif p_tab='members' then
  with filtered as (select m.*,coalesce(p.name,c.name) as owner_name from public.club_memberships m
   left join public.club_partners p on p.id=m.partner_id left join public.client_accounts c on c.id=m.client_id
   where (m.email ilike '%'||p_search||'%' or coalesce(p.name,c.name) ilike '%'||p_search||'%')
   and (p_status='all' or (p_status='active' and m.active) or (p_status='inactive' and not m.active))),
  paged as (select * from filtered order by created_at desc,id limit 25 offset offset_rows)
  select (select count(*) from filtered),coalesce(jsonb_agg(to_jsonb(pg)),'[]'::jsonb) into total,items from paged pg;
 elsif p_tab='vouchers' then
  with base as (select v.*,case when v.redeemed_at is not null then 'used' when v.expires_at<=now() then 'expired' else 'available' end as state
   from public.club_vouchers v where (r in ('manager','viewer') or (r='partner' and v.partner_id=(a->>'partner_id')::uuid) or (r='client' and v.client_id=a->>'client_id'))
   and (p_partner is null or v.partner_id=p_partner)
   and (v.snapshot->>'title' ilike '%'||p_search||'%' or v.snapshot->>'partner_name' ilike '%'||p_search||'%')),
  filtered as (select * from base where p_status='all' or state=p_status),
  paged as (select * from filtered order by issued_at desc,id limit 25 offset offset_rows)
  select (select count(*) from filtered),coalesce(jsonb_agg(jsonb_build_object('id',pg.id,'offer_id',pg.offer_id,'snapshot',pg.snapshot,
   'issued_at',pg.issued_at,'expires_at',pg.expires_at,'redeemed_at',pg.redeemed_at,'state',pg.state,'code',case when r<>'partner' then pg.code else null end)),'[]'::jsonb) into total,items from paged pg;
 end if;
 return jsonb_build_object('actor',a,'stats',stats,'items',items,'total',total,'page',greatest(p_page,0),'page_size',25,'partners',options);
end; $$;
revoke all on function public.club_workspace(uuid,text,integer,text,text,uuid) from public,anon,authenticated;
grant execute on function public.club_workspace(uuid,text,integer,text,text,uuid) to service_role;