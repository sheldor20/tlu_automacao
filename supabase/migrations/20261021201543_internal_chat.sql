begin;
create schema if not exists chat_private;
revoke all on schema chat_private from public, anon;
grant usage on schema chat_private to authenticated;

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  name text check (char_length(btrim(name)) between 2 and 100),
  is_group boolean not null default false,
  direct_key text unique,
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  check ((is_group and name is not null and direct_key is null) or (not is_group and direct_key is not null and name is null))
);
create table public.chat_members (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id),
  last_read_at timestamptz not null default now(),
  primary key (conversation_id,user_id)
);
create index chat_members_user on public.chat_members(user_id,conversation_id);
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles(user_id),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default clock_timestamp()
);
create index chat_messages_history on public.chat_messages(conversation_id,created_at desc,id desc);
create index chat_messages_sender on public.chat_messages(sender_id);
create index chat_conversations_creator on public.chat_conversations(created_by);

-- Only this non-exposed helper bypasses RLS to avoid recursive member policies.
create function chat_private.is_member(p_conversation uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.chat_members m join public.profiles p on p.user_id=m.user_id
    where m.conversation_id=p_conversation and m.user_id=auth.uid() and p.active and p.deleted_at is null
  )
$$;
revoke all on function chat_private.is_member(uuid) from public,anon;
grant execute on function chat_private.is_member(uuid) to authenticated;

alter table public.chat_conversations enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
revoke all on public.chat_conversations,public.chat_members,public.chat_messages from anon,authenticated;
grant select on public.chat_conversations,public.chat_members,public.chat_messages to authenticated;
grant insert(conversation_id,body) on public.chat_messages to authenticated;
create policy chat_conversations_read on public.chat_conversations for select to authenticated using(chat_private.is_member(id));
create policy chat_members_read on public.chat_members for select to authenticated using(chat_private.is_member(conversation_id));
create policy chat_messages_read on public.chat_messages for select to authenticated using(chat_private.is_member(conversation_id));
create policy chat_messages_send on public.chat_messages for insert to authenticated
with check(sender_id=(select auth.uid()) and chat_private.is_member(conversation_id));

-- Atomic creation validates every participant, including the caller.
create function chat_private.create_conversation(p_members uuid[],p_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; v_id uuid; v_key text; v_group boolean := p_name is not null;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where user_id=auth.uid() and active and deleted_at is null) then
    raise exception 'Seu usuário não tem acesso ao chat.';
  end if;
  select array_agg(distinct u order by u) into v_ids from unnest(array_append(p_members,auth.uid())) u;
  if cardinality(v_ids) not between 2 and 50 or array_position(v_ids,null) is not null or
     (not v_group and cardinality(v_ids)<>2) then raise exception 'Selecione de 1 a 49 participantes.'; end if;
  if v_group and char_length(btrim(p_name)) not between 2 and 100 then raise exception 'O nome do grupo deve ter de 2 a 100 caracteres.'; end if;
  if (select count(*) from public.profiles where user_id=any(v_ids) and active and deleted_at is null)<>cardinality(v_ids) then
    raise exception 'Selecione apenas usuários cadastrados e ativos.';
  end if;
  if not v_group then
    v_key := array_to_string(v_ids,':');
    perform pg_advisory_xact_lock(hashtextextended(v_key,0));
    select id into v_id from public.chat_conversations where direct_key=v_key;
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.chat_conversations(name,is_group,direct_key,created_by)
    values(case when v_group then btrim(p_name) end,v_group,v_key,auth.uid()) returning id into v_id;
  insert into public.chat_members(conversation_id,user_id) select v_id,unnest(v_ids);
  return v_id;
end $$;
revoke all on function chat_private.create_conversation(uuid[],text) from public,anon;
grant execute on function chat_private.create_conversation(uuid[],text) to authenticated;
create function public.create_chat_conversation(p_members uuid[],p_name text default null) returns uuid
language sql security invoker set search_path='' as $$ select chat_private.create_conversation(p_members,p_name) $$;
revoke all on function public.create_chat_conversation(uuid[],text) from public,anon;
grant execute on function public.create_chat_conversation(uuid[],text) to authenticated;

create function chat_private.mark_read(p_conversation uuid,p_through timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not chat_private.is_member(p_conversation) then raise exception 'Conversa indisponível.'; end if;
  update public.chat_members set last_read_at=greatest(last_read_at,least(p_through,clock_timestamp()))
    where conversation_id=p_conversation and user_id=auth.uid();
end $$;
revoke all on function chat_private.mark_read(uuid,timestamptz) from public,anon;
grant execute on function chat_private.mark_read(uuid,timestamptz) to authenticated;
create function public.mark_chat_read(p_conversation uuid,p_through timestamptz) returns void
language sql security invoker set search_path='' as $$ select chat_private.mark_read(p_conversation,p_through) $$;
revoke all on function public.mark_chat_read(uuid,timestamptz) from public,anon;
grant execute on function public.mark_chat_read(uuid,timestamptz) to authenticated;

create function public.chat_inbox() returns table(id uuid,name text,is_group boolean,created_by uuid,participants jsonb,last_body text,last_at timestamptz,unread bigint)
language sql stable security invoker set search_path='' as $$
  select c.id,c.name,c.is_group,c.created_by,
    (select jsonb_agg(jsonb_build_object('user_id',m.user_id,'full_name',p.full_name,'email',p.email) order by p.full_name)
      from public.chat_members m left join public.profiles p on p.user_id=m.user_id where m.conversation_id=c.id),
    latest.body,coalesce(latest.created_at,c.created_at),
    (select count(*) from public.chat_messages msg where msg.conversation_id=c.id and msg.sender_id<>auth.uid() and msg.created_at>mine.last_read_at)
  from public.chat_conversations c join public.chat_members mine on mine.conversation_id=c.id and mine.user_id=auth.uid()
  left join lateral (select body,created_at from public.chat_messages where conversation_id=c.id order by created_at desc,id desc limit 1) latest on true
  order by coalesce(latest.created_at,c.created_at) desc,c.id
$$;
revoke all on function public.chat_inbox() from public,anon;
grant execute on function public.chat_inbox() to authenticated;

-- Group creator manages the roster; individual conversations always retain their pair.
create function chat_private.set_group_members(p_conversation uuid,p_members uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare v_ids uuid[];
begin
  perform 1 from public.chat_conversations where id=p_conversation and is_group and created_by=auth.uid() for update;
  if not found or not chat_private.is_member(p_conversation) then raise exception 'Apenas o criador pode gerenciar o grupo.'; end if;
  select array_agg(distinct u) into v_ids from unnest(array_append(p_members,auth.uid())) u;
  if cardinality(v_ids) not between 2 and 50 or array_position(v_ids,null) is not null or
     (select count(*) from public.profiles where user_id=any(v_ids) and active and deleted_at is null)<>cardinality(v_ids) then
    raise exception 'Selecione de 1 a 49 usuários ativos.';
  end if;
  delete from public.chat_members where conversation_id=p_conversation and not(user_id=any(v_ids));
  insert into public.chat_members(conversation_id,user_id) select p_conversation,unnest(v_ids) on conflict do nothing;
end $$;
revoke all on function chat_private.set_group_members(uuid,uuid[]) from public,anon;
grant execute on function chat_private.set_group_members(uuid,uuid[]) to authenticated;
create function public.set_chat_group_members(p_conversation uuid,p_members uuid[]) returns void
language sql security invoker set search_path='' as $$ select chat_private.set_group_members(p_conversation,p_members) $$;
revoke all on function public.set_chat_group_members(uuid,uuid[]) from public,anon;
grant execute on function public.set_chat_group_members(uuid,uuid[]) to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.chat_messages,public.chat_members,public.chat_conversations;
  end if;
end $$;
commit;
