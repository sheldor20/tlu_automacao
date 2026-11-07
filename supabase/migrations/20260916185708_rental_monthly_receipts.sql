begin;

-- Contract values remain untouched. Actual receipts are entered explicitly per month.
create table public.rental_receipts (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references public.rentals(id) on delete cascade,
  reference_month date not null,
  rent_received numeric(15,2) not null check (rent_received >= 0 and rent_received < 10000000000000),
  administration_fee numeric(15,2) not null default 0 check (administration_fee >= 0 and administration_fee < 10000000000000),
  reserve_fund numeric(15,2) not null default 0 check (reserve_fund >= 0 and reserve_fund < 10000000000000),
  fines numeric(15,2) not null default 0 check (fines >= 0 and fines < 10000000000000),
  reimbursements numeric(15,2) not null default 0 check (reimbursements >= 0 and reimbursements < 10000000000000),
  property_tax numeric(15,2) not null default 0 check (property_tax >= 0 and property_tax < 10000000000000),
  net_received numeric(16,2) generated always as
    (rent_received + fines + reimbursements - administration_fee - reserve_fund - property_tax) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rental_receipts_month_check check (
    extract(day from reference_month) = 1 and reference_month between date '1900-01-01' and date '9999-12-01'
  ),
  constraint rental_receipts_rental_month_key unique (rental_id, reference_month)
);

create index rental_receipts_reference_month_idx on public.rental_receipts(reference_month);
create trigger set_rental_receipts_updated_at before update on public.rental_receipts
for each row execute function public.set_updated_at();

alter table public.rental_receipts enable row level security;
create policy rental_receipts_department_access on public.rental_receipts
for all to authenticated
using ((select public.has_department_access('alugueis')))
with check ((select public.has_department_access('alugueis')));
revoke all on public.rental_receipts from public, anon;
grant select, insert, update, delete on public.rental_receipts to authenticated;

-- Old administration amounts must not prevent edits to the contract base value.
-- Keep the legacy columns and their contents for compatibility and historical reference.
alter table public.rentals drop constraint commission_not_above_rent;

create function public.rental_receipt_monthly_totals(p_year integer)
returns table (
  reference_month date, receipt_count bigint, rent_received numeric,
  administration_fee numeric, reserve_fund numeric, fines numeric,
  reimbursements numeric, property_tax numeric, net_received numeric
)
language sql stable security invoker set search_path = ''
as $$
  select r.reference_month, count(*), sum(r.rent_received), sum(r.administration_fee),
    sum(r.reserve_fund), sum(r.fines), sum(r.reimbursements), sum(r.property_tax), sum(r.net_received)
  from public.rental_receipts r
  where r.reference_month >= make_date(p_year, 1, 1)
    and r.reference_month <= make_date(p_year, 12, 1)
  group by r.reference_month order by r.reference_month;
$$;
revoke all on function public.rental_receipt_monthly_totals(integer) from public, anon;
grant execute on function public.rental_receipt_monthly_totals(integer) to authenticated;

comment on table public.rental_receipts is 'Recebimentos reais lançados manualmente por imóvel e mês. Não são gerados a partir do contrato.';
commit;
