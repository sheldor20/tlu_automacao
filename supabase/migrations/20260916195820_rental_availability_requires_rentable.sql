begin;

-- Disponibilidade exige imóvel desocupado e permissão de locação confirmada.
create or replace function public.management_rental_snapshot()
returns table (
  total_properties bigint,
  available_properties bigint,
  rented_properties bigint,
  renovation_properties bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_indicator_area_access('rh-marketing-clientes') then
    raise exception using message = 'indicator_area_access_required';
  end if;

  return query
  select
    count(*)::bigint,
    count(*) filter (where rental.status = 'desocupado' and rental.rentable is true)::bigint,
    count(*) filter (where rental.status = 'alugado')::bigint,
    count(*) filter (where rental.status = 'aguardando_reforma')::bigint
  from public.rentals rental;
end;
$$;

commit;
