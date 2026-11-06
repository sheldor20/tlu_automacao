create function public.guard_distrato_legal_action_details()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  editable_keys constant text[] := array['block', 'lot', 'claimAmount', 'archivedOn'];
begin
  if (new.details - editable_keys) is distinct from (old.details - editable_keys) then
    raise exception 'Only quadra, lote, valor da causa and data do arquivamento can be edited' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_distrato_legal_action_details() from public, anon, authenticated;
create trigger guard_distrato_legal_action_details
  before update of details on public.distrato_legal_actions
  for each row execute function public.guard_distrato_legal_action_details();

grant update (details) on public.distrato_legal_actions to service_role;
