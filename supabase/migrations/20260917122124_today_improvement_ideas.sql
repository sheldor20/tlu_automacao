begin;

create table public.improvement_ideas (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  created_by uuid default auth.uid() references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  constraint improvement_ideas_message_check check (
    char_length(message) between 1 and 5000 and message ~ '[^[:space:]]'
  )
);

create index improvement_ideas_created_by_idx on public.improvement_ideas(created_by);
create index improvement_ideas_created_at_idx on public.improvement_ideas(created_at desc);

alter table public.improvement_ideas enable row level security;

revoke all on public.improvement_ideas from anon, authenticated;
grant select on public.improvement_ideas to authenticated;
-- The database supplies identity and timestamp; clients can only send the text.
grant insert (message) on public.improvement_ideas to authenticated;
grant all on public.improvement_ideas to service_role;

create policy improvement_ideas_insert on public.improvement_ideas
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active and profile.deleted_at is null
  )
);

create policy improvement_ideas_read on public.improvement_ideas
for select to authenticated
using (
  exists (
    select 1 from public.profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active and profile.deleted_at is null
  )
  and (created_by = (select auth.uid()) or (select public.is_system_admin()))
);

comment on table public.improvement_ideas is
  'Ideias enviadas pelo HOJE para melhorar o TLU Space, a rotina do time e automatizar tarefas.';

commit;
