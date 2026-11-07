begin;

-- Access follows the CURRENT reporting line; there is no admin/HR bypass.
create function public.can_access_performance_agreement(p_report_user_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.profiles actor
    where actor.user_id = (select auth.uid()) and actor.active and actor.deleted_at is null
  ) and exists (
    select 1 from public.profiles report
    where report.user_id = p_report_user_id and report.active and report.deleted_at is null
  ) and (
    p_report_user_id = (select auth.uid()) or exists (
      select 1 from public.profile_reporting_lines line
      where line.report_user_id = p_report_user_id and line.leader_user_id = (select auth.uid())
    )
  );
$$;
revoke all on function public.can_access_performance_agreement(uuid) from public, anon;
grant execute on function public.can_access_performance_agreement(uuid) to authenticated;

create table public.performance_agreements (
  id uuid primary key default gen_random_uuid(),
  report_user_id uuid not null references public.profiles(user_id) on delete restrict,
  cycle text not null check (length(btrim(cycle)) between 1 and 120),
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  expectations text not null default '' check (length(expectations) <= 10000),
  goals jsonb not null,
  version integer not null default 1,
  created_by uuid not null default auth.uid() references public.profiles(user_id),
  updated_by uuid not null default auth.uid() references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index performance_agreements_cycle_key
  on public.performance_agreements (report_user_id, lower(btrim(cycle)));

alter table public.performance_agreements enable row level security;
revoke all on public.performance_agreements from public, anon, authenticated;
grant select, insert, update on public.performance_agreements to authenticated;

create policy performance_agreements_read on public.performance_agreements
for select to authenticated using (public.can_access_performance_agreement(report_user_id));
create policy performance_agreements_insert on public.performance_agreements
for insert to authenticated with check (public.can_access_performance_agreement(report_user_id));
create policy performance_agreements_update on public.performance_agreements
for update to authenticated
using (public.can_access_performance_agreement(report_user_id))
with check (public.can_access_performance_agreement(report_user_id));

create function public.validate_performance_agreement()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare goal jsonb;
begin
  if tg_op = 'UPDATE' then
    if row(new.id, new.report_user_id, new.created_by, new.created_at) is distinct from
       row(old.id, old.report_user_id, old.created_by, old.created_at) then
      raise exception 'performance_agreement_identity_immutable';
    end if;
    new.version := old.version + 1;
  else
    new.created_by := auth.uid();
    new.created_at := now();
    new.version := 1;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  new.cycle := btrim(new.cycle);
  if jsonb_typeof(new.goals) is distinct from 'array' then
    raise exception 'performance_agreement_invalid_goals';
  end if;
  if jsonb_array_length(new.goals) not between 1 and 30 then
    raise exception 'performance_agreement_invalid_goals';
  end if;
  for goal in select value from jsonb_array_elements(new.goals) loop
    if jsonb_typeof(goal) is distinct from 'object'
      or jsonb_typeof(goal->'title') is distinct from 'string'
      or jsonb_typeof(goal->'indicator') is distinct from 'string'
      or jsonb_typeof(goal->'expected_result') is distinct from 'string'
      or jsonb_typeof(goal->'due_date') is distinct from 'string'
      or length(btrim(goal->>'title')) not between 1 and 300
      or length(btrim(goal->>'indicator')) not between 1 and 500
      or length(btrim(goal->>'expected_result')) not between 1 and 1000
      or (goal->>'due_date') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'performance_agreement_invalid_goal';
    end if;
    if (goal->>'due_date')::date not between new.starts_on and new.ends_on then
      raise exception 'performance_agreement_invalid_deadline';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.validate_performance_agreement() from public, anon, authenticated;
create trigger validate_performance_agreement_before_write
before insert or update on public.performance_agreements
for each row execute function public.validate_performance_agreement();

commit;
