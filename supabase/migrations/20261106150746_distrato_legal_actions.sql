create table public.distrato_legal_actions (
  id uuid primary key default gen_random_uuid(),
  protocol text not null check (length(trim(protocol)) between 1 and 120),
  protocol_key text generated always as (regexp_replace(lower(protocol), '[^a-z0-9]', '', 'g')) stored,
  details jsonb not null check (jsonb_typeof(details) = 'object'),
  status text not null default 'EM TRÂMITE'
    check (status in ('EM TRÂMITE', 'CUMPRIMENTO DE SENTENÇA', 'AGUARDANDO ARQUIVAMENTO', 'ARQUIVADO')),
  observations text not null default '' check (length(observations) <= 12000),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  revision uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint distrato_legal_actions_protocol_key unique (protocol_key),
  check (protocol_key <> '')
);

alter table public.distrato_legal_actions enable row level security;
revoke all on public.distrato_legal_actions from public, anon, authenticated, service_role;
grant select, insert on public.distrato_legal_actions to service_role;
grant update (status, observations, updated_by, revision, updated_at) on public.distrato_legal_actions to service_role;
