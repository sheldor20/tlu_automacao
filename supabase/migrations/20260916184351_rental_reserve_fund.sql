begin;

alter table public.rentals
  add column reserve_fund numeric(18,2) not null default 0
  constraint rentals_reserve_fund_check check (reserve_fund >= 0);

comment on column public.rentals.reserve_fund is
  'Fundo de reserva do imóvel, em reais.';

-- Preserve stored values and compatibility with the monthly summary and older clients.
comment on column public.rentals.broker_commission is
  'Taxa de administração mensal em reais. Nome legado mantido por compatibilidade.';

commit;
