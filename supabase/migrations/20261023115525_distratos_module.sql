begin;
insert into public.departments(slug,name,position) values ('distratos','Distratos',13) on conflict(slug) do nothing;

create table public.distrato_documents (
  id uuid primary key,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  contract_id text not null references public.client_contracts(id),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  input jsonb not null check (jsonb_typeof(input)='object'),
  unit jsonb not null check (jsonb_typeof(unit)='object'),
  correction jsonb not null check (jsonb_typeof(correction)='object'),
  calculation jsonb not null check (jsonb_typeof(calculation)='object'),
  term text not null,
  draft boolean not null default true
);
create index distrato_documents_contract_created_idx on public.distrato_documents(contract_id,created_at desc);
create index distrato_documents_created_by_idx on public.distrato_documents(created_by);
alter table public.distrato_documents enable row level security;
revoke all on public.distrato_documents from anon,authenticated,service_role;
grant select on public.distrato_documents to authenticated;
grant select,insert on public.distrato_documents to service_role;
create policy distrato_documents_read on public.distrato_documents for select to authenticated using(public.has_department_access('distratos'));
-- Writes are immutable snapshots through the authorized server endpoint only.
commit;
