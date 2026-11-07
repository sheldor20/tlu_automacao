begin;

-- Keep the legacy agenda summary in sync with the authoritative decision rows.
-- Invoker security preserves the existing leader/admin and archive RLS checks.
create or replace function public.sync_ra_item_after_decision_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  meeting_status public.ra_meeting_status;
  latest_decision record;
begin
  -- Serialize changes for an item. A cascading deletion has no surviving item.
  perform 1 from public.ra_agenda_items where id = old.item_id for update;
  if not found then
    return null;
  end if;

  select status into meeting_status
  from public.ra_meetings where id = old.meeting_id for share;
  if meeting_status = 'encerrada' then
    raise exception 'Não é possível alterar definições de uma RA encerrada.';
  end if;

  select decision_text, decided_at into latest_decision
  from public.ra_decisions
  where item_id = old.item_id
  order by decided_at desc, id desc
  limit 1;

  update public.ra_agenda_items
  set decision_text = latest_decision.decision_text,
      resolved_at = latest_decision.decided_at
  where id = old.item_id;

  return null;
end;
$$;

revoke all on function public.sync_ra_item_after_decision_change() from public, anon, authenticated;

create trigger ra_decisions_sync_item_after_change
after update of decision_text or delete on public.ra_decisions
for each row execute function public.sync_ra_item_after_decision_change();

commit;
