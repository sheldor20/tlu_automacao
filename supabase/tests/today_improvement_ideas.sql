-- Run with the postgres role. Every fixture and idea is rolled back.
begin;

select set_config('test.idea_author', gen_random_uuid()::text, true),
       set_config('test.idea_other', gen_random_uuid()::text, true),
       set_config('test.idea_admin', gen_random_uuid()::text, true),
       set_config('test.idea_inactive', gen_random_uuid()::text, true);

insert into auth.users (id, email)
select current_setting(key)::uuid, current_setting(key) || '@example.invalid'
from unnest(array['test.idea_author', 'test.idea_other', 'test.idea_admin', 'test.idea_inactive']) as key;

update public.profiles
set active = user_id <> current_setting('test.idea_inactive')::uuid,
    is_admin = user_id = current_setting('test.idea_admin')::uuid
where user_id in (
  current_setting('test.idea_author')::uuid, current_setting('test.idea_other')::uuid,
  current_setting('test.idea_admin')::uuid, current_setting('test.idea_inactive')::uuid
);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.idea_author'), true);

insert into public.improvement_ideas (message) values ('Teste transacional: automatizar uma tarefa.');

do $$
begin
  if not exists (select 1 from public.improvement_ideas
    where created_by = auth.uid() and created_at = now()
      and message = 'Teste transacional: automatizar uma tarefa.') then
    raise exception 'Author, timestamp or persisted message was not set correctly';
  end if;
  begin
    insert into public.improvement_ideas (message) values (E' \n\t ');
    raise exception 'Whitespace-only message was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.improvement_ideas (message) values (repeat('a', 5001));
    raise exception 'Oversized message was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.improvement_ideas (message, created_by)
    values ('Forged author', current_setting('test.idea_other')::uuid);
    raise exception 'Forged author was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.improvement_ideas (message, created_at) values ('Forged date', now());
    raise exception 'Client timestamp was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.improvement_ideas set message = 'Changed';
    raise exception 'Idea update was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.improvement_ideas;
    raise exception 'Idea delete was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', current_setting('test.idea_other'), true);
do $$
begin
  if exists (select 1 from public.improvement_ideas where created_by = current_setting('test.idea_author')::uuid) then
    raise exception 'Another user can read the author idea';
  end if;
end $$;

select set_config('request.jwt.claim.sub', current_setting('test.idea_admin'), true);
do $$
begin
  if not exists (select 1 from public.improvement_ideas where created_by = current_setting('test.idea_author')::uuid) then
    raise exception 'Administrator cannot read submitted ideas';
  end if;
end $$;

select set_config('request.jwt.claim.sub', current_setting('test.idea_inactive'), true);
do $$
begin
  begin
    insert into public.improvement_ideas (message) values ('Inactive user');
    raise exception 'Inactive user can submit an idea';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.improvement_ideas) then
    raise exception 'Inactive user can read ideas';
  end if;
end $$;

reset role;
update public.profiles set active = false where user_id = current_setting('test.idea_author')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.idea_author'), true);
do $$
begin
  if exists (select 1 from public.improvement_ideas) then
    raise exception 'Deactivated author can still read ideas';
  end if;
end $$;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  begin
    insert into public.improvement_ideas (message) values ('Anonymous idea');
    raise exception 'Anonymous user can submit an idea';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.improvement_ideas;
    raise exception 'Anonymous user can read ideas';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
select 'All improvement idea persistence and access checks passed; fixtures rolled back.' as result;
