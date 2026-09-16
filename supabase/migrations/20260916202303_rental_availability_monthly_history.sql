begin;

-- Guarda a posição do mês corrente; competências anteriores permanecem fechadas.
create function public.record_rental_availability_month()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Serializa alterações concorrentes antes de contar a carteira.
  perform pg_advisory_xact_lock(hashtextextended('rental-availability-month', 0));
  insert into public.management_indicator_values (
    area, metric_key, reference_month, dimension_key, value, source, notes, metadata
  )
  select
    'rh-marketing-clientes', 'imoveis_disponiveis',
    date_trunc('month', now() at time zone 'America/Sao_Paulo')::date,
    'total', count(*), 'TLU Space — Aluguéis',
    'Imóveis desocupados com permissão para locação. Posição atualizada durante o mês.',
    jsonb_build_object('automatic', true,
      'derived_from', 'rentals.status=desocupado AND rentals.rentable=true')
  from public.rentals
  where status = 'desocupado' and rentable is true
  on conflict (area, metric_key, reference_month, dimension_key) do update set
    value = excluded.value,
    source = excluded.source,
    notes = excluded.notes,
    metadata = excluded.metadata
  where management_indicator_values.value is distinct from excluded.value
    or management_indicator_values.metadata is distinct from excluded.metadata;
  return null;
end;
$$;

-- Esta função só pode ser executada pelo gatilho, após uma alteração autorizada.
revoke all on function public.record_rental_availability_month() from public, anon, authenticated, service_role;

create trigger record_rental_availability_month
after insert or delete or update of status, rentable on public.rentals
for each statement execute function public.record_rental_availability_month();

-- Aciona a primeira captura sem modificar nenhum imóvel.
update public.rentals set status = status where false;

commit;
