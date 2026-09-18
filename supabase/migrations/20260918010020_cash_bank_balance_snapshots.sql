create table if not exists public.cash_bank_balance_snapshots (
  as_of date not null,
  scope_hash text not null check (scope_hash ~ '^[a-f0-9]{64}$'),
  company_ids text[] not null check (cardinality(company_ids) > 0),
  amount numeric not null check (amount > '-Infinity'::numeric and amount < 'Infinity'::numeric),
  account_count integer not null check (account_count > 0),
  synchronized_at timestamptz not null,
  source_app_id text not null,
  source_sheet_id text not null,
  source_object_id text not null,
  primary key (as_of, scope_hash)
);
alter table public.cash_bank_balance_snapshots enable row level security;
revoke all on table public.cash_bank_balance_snapshots from public, anon, authenticated;
grant select, insert, update, delete on table public.cash_bank_balance_snapshots to service_role;
comment on table public.cash_bank_balance_snapshots is 'Cache servidor do saldo inicial DFC por data e conjunto exato de empresas. A API exige acesso ativo ao Financeiro. Não contém credenciais nem números de contas.';
