-- Server-only derived AI results and cost metadata. Business authorization must
-- run before cache lookup; keys include actor/tenant, model, prompt version and input.
create table if not exists public.ai_result_cache (
  cache_key text primary key check (cache_key ~ '^[a-f0-9]{64}$'),
  purpose text not null,
  actor_id uuid references auth.users(id) on delete cascade,
  value jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_result_cache_expiry_idx on public.ai_result_cache(expires_at);
alter table public.ai_result_cache enable row level security;
revoke all on public.ai_result_cache from public, anon, authenticated;
grant select, insert, update, delete on public.ai_result_cache to service_role;

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  system_name text not null,
  operation text not null,
  actor_id uuid references auth.users(id) on delete set null,
  response_id text,
  model text,
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cached_input_tokens bigint not null default 0 check (cached_input_tokens >= 0),
  reasoning_tokens bigint not null default 0 check (reasoning_tokens >= 0),
  cache_hit boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists ai_usage_response_once_idx on public.ai_usage_events(system_name, response_id) where response_id is not null and not cache_hit;
create index if not exists ai_usage_operation_time_idx on public.ai_usage_events(system_name, operation, created_at);
alter table public.ai_usage_events enable row level security;
revoke all on public.ai_usage_events from public, anon, authenticated;
grant select, insert on public.ai_usage_events to service_role;

-- Bound cache retention without exposing maintenance RPCs to browsers.
create or replace function public.prune_ai_result_cache() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.ai_result_cache where cache_key in (
    select cache_key from public.ai_result_cache where expires_at < now() order by expires_at limit 100
  );
  return null;
end;
$$;
revoke all on function public.prune_ai_result_cache() from public, anon, authenticated;
drop trigger if exists prune_ai_cache_after_insert on public.ai_result_cache;
create trigger prune_ai_cache_after_insert after insert on public.ai_result_cache
for each statement execute function public.prune_ai_result_cache();
notify pgrst, 'reload schema';

