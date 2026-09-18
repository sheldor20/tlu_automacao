-- Clube TLU: all public RPCs are service-only SECURITY INVOKER.
-- Browser writes go through /api/club with server-verified Auth identity.
create schema if not exists club_private;
revoke all on schema club_private from public, anon, authenticated;
grant usage on schema club_private to service_role;
create table public.club_partners (
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 2 and 120),
 category text not null default 'Geral' check(length(category)<=80), city text not null default '' check(length(city)<=100),
 contact_email text not null default '' check(length(contact_email)<=254), contact_phone text not null default '' check(length(contact_phone)<=40),
 active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.club_memberships (
 id uuid primary key default gen_random_uuid(), email text not null unique check(email=lower(btrim(email)) and length(email) between 3 and 254),
 kind text not null check(kind in ('partner','client')), partner_id uuid references public.club_partners(id) on delete restrict,
 client_id text references public.client_accounts(id) on delete restrict, active boolean not null default true,
 created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check((kind='partner' and partner_id is not null and client_id is null) or (kind='client' and client_id is not null and partner_id is null))
);
create index club_memberships_partner_idx on public.club_memberships(partner_id);
create index club_memberships_client_idx on public.club_memberships(client_id);
create index club_memberships_creator_idx on public.club_memberships(created_by);
create table public.club_offers (
 id uuid primary key default gen_random_uuid(), partner_id uuid not null references public.club_partners(id) on delete restrict,
 title text not null check(length(btrim(title)) between 3 and 140), benefit text not null check(length(btrim(benefit)) between 3 and 140),
 description text not null default '' check(length(description)<=2000), rules text not null check(length(btrim(rules)) between 5 and 5000),
 status text not null default 'draft' check(status in ('draft','active','paused')),
 starts_at timestamptz not null, ends_at timestamptz not null,
 redemption_days integer check(redemption_days between 1 and 365), max_issues integer check(max_issues between 1 and 1000000),
 per_client_limit integer not null default 1 check(per_client_limit between 1 and 100), version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,partner_id), check(ends_at>starts_at)
);
create index club_offers_partner_idx on public.club_offers(partner_id,created_at desc);
create table public.club_vouchers (
 id uuid primary key default gen_random_uuid(), offer_id uuid not null, partner_id uuid not null,
 client_id text not null references public.client_accounts(id) on delete restrict,
 code text not null unique check(code ~ '^TLU[0-9A-F]{20}$'), request_id uuid not null, snapshot jsonb not null,
 issued_at timestamptz not null default now(), expires_at timestamptz not null, redeemed_at timestamptz,
 redeemed_by uuid references auth.users(id) on delete set null,
 foreign key(offer_id,partner_id) references public.club_offers(id,partner_id) on delete restrict,
 unique(client_id,request_id), check(expires_at>issued_at)
);
create index club_vouchers_offer_idx on public.club_vouchers(offer_id,client_id);
create index club_vouchers_partner_idx on public.club_vouchers(partner_id,issued_at desc);
create index club_vouchers_client_idx on public.club_vouchers(client_id,issued_at desc);
create index club_vouchers_redeemer_idx on public.club_vouchers(redeemed_by);
create table public.club_events (
 id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id) on delete set null,
 action text not null, entity_id uuid not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index club_events_entity_idx on public.club_events(entity_id,created_at desc);
create index club_events_actor_idx on public.club_events(actor_id);
create table public.club_rate_limits (key text primary key, bucket timestamptz not null, attempts integer not null);
alter table public.club_partners enable row level security;
alter table public.club_memberships enable row level security;
alter table public.club_offers enable row level security;
alter table public.club_vouchers enable row level security;
alter table public.club_events enable row level security;
alter table public.club_rate_limits enable row level security;
revoke all on public.club_partners,public.club_memberships,public.club_offers,public.club_vouchers,public.club_events,public.club_rate_limits from public,anon,authenticated;
grant all on public.club_partners,public.club_memberships,public.club_offers,public.club_vouchers,public.club_events,public.club_rate_limits to service_role;
-- Membership is saved by a manager BEFORE an Auth invitation. Do not activate
-- internal profiles for newly invited external accounts. Existing staff is preserved.
create function club_private.isolate_external_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.club_memberships m where m.email=lower(new.email)) then new.active:=false; new.is_admin:=false; end if;
 return new;
end; $$;
revoke all on function club_private.isolate_external_profile() from public,anon,authenticated;
create trigger club_external_profile_guard before insert on public.profiles for each row execute function club_private.isolate_external_profile();
create function club_private.actor(p_actor uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_email text; v_role text; v_name text; v_member public.club_memberships%rowtype;
begin
 if p_actor is null then raise exception 'club_forbidden'; end if;
 select lower(u.email) into v_email from auth.users u where u.id=p_actor and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now());
 if v_email is null then raise exception 'club_forbidden'; end if;
 if exists(select 1 from public.profiles where user_id=p_actor and deleted_at is not null) then raise exception 'club_forbidden'; end if;
 select case when p.is_admin or d.access_level<>'viewer' then 'manager' else 'viewer' end,coalesce(p.full_name,p.email) into v_role,v_name
 from public.profiles p left join public.profile_departments d on d.user_id=p.user_id and d.department_slug='clientes'
 where p.user_id=p_actor and p.active and p.deleted_at is null and (p.is_admin or d.user_id is not null);
 if v_role is not null then return jsonb_build_object('role',v_role,'name',v_name); end if;
 select * into v_member from public.club_memberships where email=v_email and active;
 if not found then raise exception 'club_forbidden'; end if;
 if v_member.kind='partner' then
  select name into v_name from public.club_partners where id=v_member.partner_id and active;
  if not found then raise exception 'club_forbidden'; end if;
 else select name into v_name from public.client_accounts where id=v_member.client_id;
 end if;
 return jsonb_build_object('role',v_member.kind,'name',v_name,'partner_id',v_member.partner_id,'client_id',v_member.client_id);
end; $$;
revoke all on function club_private.actor(uuid) from public,anon,authenticated;
grant execute on function club_private.actor(uuid) to service_role;
create function public.club_context(p_actor uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select club_private.actor(p_actor); $$;
revoke all on function public.club_context(uuid) from public,anon,authenticated;
grant execute on function public.club_context(uuid) to service_role;
-- Separate committed RPC call: a failed command cannot roll back rate accounting.
create function public.club_rate_limit(p_actor uuid,p_action text) returns boolean language plpgsql security invoker set search_path='' as $$
declare v_count integer; v_bucket timestamptz:=date_trunc('minute',clock_timestamp()); v_limit integer;
begin
 perform club_private.actor(p_actor);
 if p_action not in ('partner','offer','member','claim','check','redeem','invite') then raise exception 'club_invalid'; end if;
 v_limit:=case when p_action='invite' then 5 when p_action in ('check','redeem') then 30 else 60 end;
 insert into public.club_rate_limits as r(key,bucket,attempts) values(p_actor::text||':'||p_action,v_bucket,1)
 on conflict(key) do update set bucket=excluded.bucket,attempts=case when r.bucket=excluded.bucket then r.attempts+1 else 1 end returning attempts into v_count;
 return v_count<=v_limit;
end; $$;
revoke all on function public.club_rate_limit(uuid,text) from public,anon,authenticated;
grant execute on function public.club_rate_limit(uuid,text) to service_role;
create function public.club_command(p_actor uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a jsonb:=club_private.actor(p_actor); r text:=a->>'role'; o public.club_offers%rowtype; v public.club_vouchers%rowtype;
 m public.club_memberships%rowtype; p public.club_partners%rowtype; result jsonb; target uuid; n bigint; request_key uuid;
 customer text; normalized text; attempts integer:=0; lim integer; member_id uuid;
begin
 if p_action in ('partner','member','invite') and r<>'manager' then raise exception 'club_forbidden'; end if;
 if p_action='partner' then
  if p_data->>'id' is not null then
   update public.club_partners set name=btrim(p_data->>'name'),category=btrim(p_data->>'category'),city=btrim(p_data->>'city'),
    contact_email=lower(btrim(p_data->>'contact_email')),contact_phone=btrim(p_data->>'contact_phone'),active=(p_data->>'active')::boolean,updated_at=now()
   where id=(p_data->>'id')::uuid returning to_jsonb(club_partners.*) into result;
  else
   insert into public.club_partners(name,category,city,contact_email,contact_phone,active)
   values(btrim(p_data->>'name'),btrim(p_data->>'category'),btrim(p_data->>'city'),lower(btrim(p_data->>'contact_email')),btrim(p_data->>'contact_phone'),(p_data->>'active')::boolean)
   returning to_jsonb(club_partners.*) into result;
  end if;
 elsif p_action='member' then
  if p_data->>'id' is not null then
   update public.club_memberships set active=(p_data->>'active')::boolean,updated_at=now() where id=(p_data->>'id')::uuid returning to_jsonb(club_memberships.*) into result;
  else
   insert into public.club_memberships(email,kind,partner_id,client_id,created_by)
   values(lower(btrim(p_data->>'email')),p_data->>'kind',nullif(p_data->>'partner_id','')::uuid,nullif(p_data->>'client_id',''),p_actor)
   returning to_jsonb(club_memberships.*) into result;
  end if;
 elsif p_action='invite' then
  select * into m from public.club_memberships where id=(p_data->>'id')::uuid and active;
  if not found then raise exception 'club_not_found'; end if;
  if m.kind='partner' and not exists(select 1 from public.club_partners where id=m.partner_id and active) then raise exception 'club_unavailable'; end if;
  return jsonb_build_object('email',m.email);
 elsif p_action='offer' then
  if r not in ('manager','partner') then raise exception 'club_forbidden'; end if;
  target:=(p_data->>'partner_id')::uuid;
  if r='partner' and target<>(a->>'partner_id')::uuid then raise exception 'club_forbidden'; end if;
  select * into p from public.club_partners where id=target and active for share;
  if not found then raise exception 'club_unavailable'; end if;
  if p_data->>'id' is not null then
   select * into o from public.club_offers where id=(p_data->>'id')::uuid and partner_id=target for update;
   if not found then raise exception 'club_not_found'; end if;
   if o.version<>(p_data->>'version')::integer then raise exception 'club_conflict'; end if;
   select count(*) into n from public.club_vouchers where offer_id=o.id;
   lim:=nullif(p_data->>'max_issues','')::integer;
   if lim is not null and lim<n then raise exception 'club_limit_below_issued'; end if;
   update public.club_offers set title=btrim(p_data->>'title'),benefit=btrim(p_data->>'benefit'),description=btrim(p_data->>'description'),
    rules=btrim(p_data->>'rules'),status=p_data->>'status',starts_at=(p_data->>'starts_at')::timestamptz,ends_at=(p_data->>'ends_at')::timestamptz,
    redemption_days=nullif(p_data->>'redemption_days','')::integer,max_issues=lim,per_client_limit=(p_data->>'per_client_limit')::integer,version=version+1,updated_at=now()
   where id=o.id returning to_jsonb(club_offers.*) into result;
  else
   insert into public.club_offers(partner_id,title,benefit,description,rules,status,starts_at,ends_at,redemption_days,max_issues,per_client_limit)
   values(target,btrim(p_data->>'title'),btrim(p_data->>'benefit'),btrim(p_data->>'description'),btrim(p_data->>'rules'),p_data->>'status',
    (p_data->>'starts_at')::timestamptz,(p_data->>'ends_at')::timestamptz,nullif(p_data->>'redemption_days','')::integer,nullif(p_data->>'max_issues','')::integer,(p_data->>'per_client_limit')::integer)
   returning to_jsonb(club_offers.*) into result;
  end if;
 elsif p_action='claim' then
  if r<>'client' then raise exception 'club_forbidden'; end if;
  customer:=a->>'client_id'; request_key:=(p_data->>'request_id')::uuid;
  select * into v from public.club_vouchers where client_id=customer and request_id=request_key;
  if found then
   if v.offer_id<>(p_data->>'offer_id')::uuid then raise exception 'club_request_conflict'; end if;
   return to_jsonb(v);
  end if;
  -- Consistent lock ordering; stock and per-client checks serialize per offer.
  select cp.* into p from public.club_partners cp join public.club_offers co on co.partner_id=cp.id
   where co.id=(p_data->>'offer_id')::uuid and cp.active for share of cp;
  if not found then raise exception 'club_unavailable'; end if;
  select * into o from public.club_offers where id=(p_data->>'offer_id')::uuid for update;
  select * into v from public.club_vouchers where client_id=customer and request_id=request_key;
  if found then
   if v.offer_id<>o.id then raise exception 'club_request_conflict'; end if;
   return to_jsonb(v);
  end if;
  if o.status<>'active' or now()<o.starts_at or now()>=o.ends_at then raise exception 'club_unavailable'; end if;
  select count(*) into n from public.club_vouchers where offer_id=o.id;
  if o.max_issues is not null and n>=o.max_issues then raise exception 'club_sold_out'; end if;
  select count(*) into n from public.club_vouchers where offer_id=o.id and client_id=customer;
  if n>=o.per_client_limit then raise exception 'club_client_limit'; end if;
  loop
   attempts:=attempts+1;
   begin
    insert into public.club_vouchers(offer_id,partner_id,client_id,code,request_id,snapshot,expires_at)
    values(o.id,o.partner_id,customer,'TLU'||upper(encode(extensions.gen_random_bytes(10),'hex')),request_key,
     jsonb_build_object('title',o.title,'benefit',o.benefit,'rules',o.rules,'description',o.description,'partner_name',p.name,'offer_version',o.version),
     least(o.ends_at,now()+make_interval(days=>coalesce(o.redemption_days,36500)))) returning * into v;
    exit;
   exception when unique_violation then
    select * into v from public.club_vouchers where client_id=customer and request_id=request_key;
    if found then
     if v.offer_id<>o.id then raise exception 'club_request_conflict'; end if;
     return to_jsonb(v);
    end if;
    if attempts>=5 then raise exception 'club_retry'; end if;
   end;
  end loop;
  result:=to_jsonb(v);
 elsif p_action in ('check','redeem') then
  if r not in ('manager','partner') then raise exception 'club_forbidden'; end if;
  normalized:=upper(regexp_replace(p_data->>'code','[[:space:]-]','','g'));
  if normalized !~ '^TLU[0-9A-F]{20}$' then raise exception 'club_not_found'; end if;
  select * into v from public.club_vouchers where code=normalized and (r='manager' or partner_id=(a->>'partner_id')::uuid);
  if not found then raise exception 'club_not_found'; end if;
  select * into p from public.club_partners where id=v.partner_id and active for share;
  if not found then raise exception 'club_unavailable'; end if;
  select * into v from public.club_vouchers where id=v.id for update;
  if p_action='check' then
   return jsonb_build_object('id',v.id,'snapshot',v.snapshot,'issued_at',v.issued_at,'expires_at',v.expires_at,'redeemed_at',v.redeemed_at,
    'state',case when v.redeemed_at is not null then 'used' when v.expires_at<=now() then 'expired' else 'available' end);
  end if;
  if v.redeemed_at is not null then raise exception 'club_already_used'; end if;
  if v.expires_at<=now() then raise exception 'club_expired'; end if;
  update public.club_vouchers set redeemed_at=now(),redeemed_by=p_actor where id=v.id returning * into v;
  result:=jsonb_build_object('id',v.id,'redeemed_at',v.redeemed_at,'snapshot',v.snapshot,'state','used');
 else raise exception 'club_invalid';
 end if;
 if result is null then raise exception 'club_not_found'; end if;
 insert into public.club_events(actor_id,action,entity_id,details) values(p_actor,p_action,(result->>'id')::uuid,
  case when p_action='offer' then jsonb_build_object('version',result->'version','status',result->'status')
   when p_action in ('partner','member') then jsonb_build_object('active',result->'active') else '{}'::jsonb end);
 return result;
end; $$;
revoke all on function public.club_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.club_command(uuid,text,jsonb) to service_role;
create function club_private.email_registered(p_email text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where lower(email)=lower(p_email)); $$;
revoke all on function club_private.email_registered(text) from public,anon,authenticated;
grant execute on function club_private.email_registered(text) to service_role;
create function public.club_invite_target(p_actor uuid,p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare target jsonb;
begin target:=public.club_command(p_actor,'invite',jsonb_build_object('id',p_id));
 return target||jsonb_build_object('registered',club_private.email_registered(target->>'email'));
end; $$;
revoke all on function public.club_invite_target(uuid,uuid) from public,anon,authenticated;
grant execute on function public.club_invite_target(uuid,uuid) to service_role;
create function public.club_workspace(p_actor uuid,p_tab text default 'offers',p_page integer default 0,p_search text default '',p_status text default 'all',p_partner uuid default null)
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
 -- Exact totals are calculated separately from pagination.
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
