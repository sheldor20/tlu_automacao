-- Permite registrar várias definições para o mesmo assunto da pauta.

begin;

alter table public.ra_decisions
  drop constraint if exists ra_decisions_item_id_key;

create index if not exists ra_decisions_item_idx
  on public.ra_decisions(item_id, decided_at);

create or replace function public.record_ra_decision(p_item_id uuid, p_decision_text text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  item_row record;
  decision_id uuid;
begin
  select item.id, item.content, section.meeting_id, meeting.status
  into item_row
  from public.ra_agenda_items item
  join public.ra_agenda_sections section on section.id = item.section_id
  join public.ra_meetings meeting on meeting.id = section.meeting_id
  where item.id = p_item_id;

  if item_row.id is null or not public.can_manage_ra_meeting(item_row.meeting_id) then
    raise exception using message = 'ra_manage_required';
  end if;
  if item_row.status = 'encerrada' then
    raise exception using message = 'ra_already_closed';
  end if;
  if char_length(btrim(coalesce(p_decision_text, ''))) < 2 then
    raise exception using message = 'ra_decision_required';
  end if;

  insert into public.ra_decisions (meeting_id, item_id, title, decision_text, decided_by)
  values (item_row.meeting_id, p_item_id, left(item_row.content, 220), btrim(p_decision_text), auth.uid())
  returning id into decision_id;

  -- Mantém o último texto no item para compatibilidade com atas já existentes.
  update public.ra_agenda_items
  set kind = 'definicao', decision_text = btrim(p_decision_text), resolved_at = now()
  where id = p_item_id;

  return decision_id;
end;
$$;

revoke all on function public.record_ra_decision(uuid, text) from public;
grant execute on function public.record_ra_decision(uuid, text) to authenticated;

commit;
