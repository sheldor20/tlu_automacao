-- Arquivamento e exclusão segura de Processos e reuniões RA.

begin;

alter table public.ra_meetings
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(user_id) on delete set null;

create index if not exists ra_meetings_archived_date_idx
  on public.ra_meetings(archived_at, scheduled_at desc);

-- Administrar permite arquivar, restaurar e excluir; gerenciar também exige
-- que a RA esteja ativa, congelando pauta, decisões, tarefas e ATA arquivadas.
create or replace function public.can_administer_ra_meeting(p_meeting_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_system_admin() or exists (
    select 1 from public.ra_meetings meeting
    where meeting.id = p_meeting_id and meeting.leader_user_id = auth.uid()
  );
$$;

create or replace function public.can_manage_ra_meeting(p_meeting_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.can_administer_ra_meeting(p_meeting_id) and exists (
    select 1 from public.ra_meetings meeting
    where meeting.id = p_meeting_id and meeting.archived_at is null
  );
$$;

revoke all on function public.can_administer_ra_meeting(uuid) from public;
grant execute on function public.can_administer_ra_meeting(uuid) to authenticated;

drop policy if exists ra_meetings_update on public.ra_meetings;
drop policy if exists ra_meetings_delete on public.ra_meetings;

create policy ra_meetings_update on public.ra_meetings for update to authenticated
using (public.can_administer_ra_meeting(id))
with check (public.can_administer_ra_meeting(id));

create policy ra_meetings_delete on public.ra_meetings for delete to authenticated
using (public.can_administer_ra_meeting(id));

-- Permite limpar o PDF depois da exclusão do processo. A operação continua
-- restrita a gestores e ao bucket privado de documentos de Processos.
drop policy if exists process_documents_storage_delete on storage.objects;
create policy process_documents_storage_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'process-documents'
  and public.can_manage_processes()
);

commit;
