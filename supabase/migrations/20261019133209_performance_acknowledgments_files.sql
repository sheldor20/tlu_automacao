begin;
drop policy performance_agreements_insert on public.performance_agreements;
drop policy performance_agreements_update on public.performance_agreements;
create policy performance_agreements_insert on public.performance_agreements for insert to authenticated
with check (report_user_id <> (select auth.uid()) and public.can_access_performance_agreement(report_user_id));
create policy performance_agreements_update on public.performance_agreements for update to authenticated
using (report_user_id <> (select auth.uid()) and public.can_access_performance_agreement(report_user_id))
with check (report_user_id <> (select auth.uid()) and public.can_access_performance_agreement(report_user_id));

create table public.performance_acknowledgments (
 id uuid primary key default gen_random_uuid(),
 agreement_id uuid not null references public.performance_agreements(id),
 agreement_version integer not null,
 signer_id uuid not null default auth.uid() references public.profiles(user_id),
 signature_name text not null check (length(btrim(signature_name)) between 3 and 200),
 signed_at timestamptz not null default now(),
 statement text not null default '',
 snapshot jsonb not null default '{}',
 unique (agreement_id, agreement_version)
);
alter table public.performance_acknowledgments enable row level security;
revoke all on public.performance_acknowledgments from public, anon, authenticated;
grant select, insert on public.performance_acknowledgments to authenticated;
create policy performance_acknowledgments_read on public.performance_acknowledgments for select to authenticated
using (exists(select 1 from public.performance_agreements a where a.id = agreement_id));
create policy performance_acknowledgments_sign on public.performance_acknowledgments for insert to authenticated
with check (signer_id = (select auth.uid()) and exists(select 1 from public.performance_agreements a where a.id = agreement_id and a.report_user_id = (select auth.uid()) and a.version = agreement_version));

create schema if not exists performance_private;
revoke all on schema performance_private from public, anon, authenticated;
create function performance_private.validate_performance_acknowledgment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare agreement public.performance_agreements;
begin
 -- The private trigger locks the agreement for an employee who cannot UPDATE it.
 -- Authorization remains explicit because this function bypasses RLS.
 select * into agreement from public.performance_agreements where id = new.agreement_id for share;
 if auth.uid() is null or agreement.id is null or agreement.report_user_id <> auth.uid() or not public.can_access_performance_agreement(agreement.report_user_id) or agreement.version <> new.agreement_version then
   raise exception 'performance_agreement_conflict';
 end if;
 new.signer_id := auth.uid();
 new.signed_at := clock_timestamp();
 new.signature_name := btrim(new.signature_name);
 new.statement := 'Declaro que recebi, li e compreendi as metas e expectativas deste ciclo e me comprometo a segui-las.';
 new.snapshot := to_jsonb(agreement);
 return new;
end; $$;
revoke all on function performance_private.validate_performance_acknowledgment() from public, anon, authenticated;
create trigger validate_performance_acknowledgment before insert on public.performance_acknowledgments
for each row execute function performance_private.validate_performance_acknowledgment();

insert into storage.buckets (id, name, public, file_size_limit)
values ('performance-files', 'performance-files', false, 20971520);
create policy performance_files_read on storage.objects for select to authenticated
using (bucket_id = 'performance-files' and exists (
 select 1 from public.performance_agreements a where a.id::text = (storage.foldername(name))[1]
));
create policy performance_files_upload on storage.objects for insert to authenticated
with check (bucket_id = 'performance-files' and (storage.foldername(name))[2] = (select auth.uid())::text and exists (
 select 1 from public.performance_agreements a where a.id::text = (storage.foldername(name))[1]
));
commit;
