begin;
alter table public.performance_agreements add column archived_at timestamptz;
alter table public.performance_agreements add column archived_by uuid references public.profiles(user_id);
create index performance_agreements_archived_by on public.performance_agreements(archived_by);
create function public.validate_performance_archive() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
 if tg_op = 'INSERT' then
   new.archived_at := null; new.archived_by := null;
 elsif old.archived_at is not null then
   raise exception 'performance_agreement_archived';
 elsif new.archived_at is not null then
   new.archived_at := clock_timestamp(); new.archived_by := auth.uid();
 else new.archived_by := null;
 end if;
 return new;
end; $$;
revoke all on function public.validate_performance_archive() from public, anon, authenticated;
create trigger validate_performance_archive before insert or update on public.performance_agreements
for each row execute function public.validate_performance_archive();

-- Explicit administrative grant: administrators do not automatically read agreements.
create table public.profile_performance_permissions (
 user_id uuid primary key references public.profiles(user_id) on delete cascade,
 can_review boolean not null default false
);
alter table public.profile_performance_permissions enable row level security;
revoke all on public.profile_performance_permissions from public, anon, authenticated;
grant select on public.profile_performance_permissions to authenticated;
grant all on public.profile_performance_permissions to service_role;
create policy performance_permission_read on public.profile_performance_permissions
for select to authenticated using (user_id = (select auth.uid()) or (select public.is_system_admin()));

create function public.can_review_performance_agreements() returns boolean
language sql stable security invoker set search_path = '' as $$
 select exists(select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.active and p.deleted_at is null)
 and exists(select 1 from public.profile_performance_permissions p where p.user_id = (select auth.uid()) and p.can_review);
$$;
revoke all on function public.can_review_performance_agreements() from public, anon;
grant execute on function public.can_review_performance_agreements() to authenticated;
create policy performance_agreements_review on public.performance_agreements
for select to authenticated using ((select public.can_review_performance_agreements()));
-- INSERT / UPDATE still require the current direct leader, regardless of review access.

create table public.performance_agreement_contracts (
 id uuid primary key default gen_random_uuid(),
 agreement_id uuid not null references public.performance_agreements(id),
 agreement_version integer not null,
 report_user_id uuid not null references public.profiles(user_id),
 leader_user_id uuid not null references public.profiles(user_id),
 report_identity jsonb not null,
 leader_identity jsonb not null,
 snapshot jsonb not null,
 terms text not null,
 content_hash text not null,
 leader_signature_name text not null check(length(btrim(leader_signature_name)) between 3 and 200),
 leader_signed_at timestamptz not null default now(),
 unique(agreement_id, agreement_version)
);
create index performance_contracts_report on public.performance_agreement_contracts(report_user_id, leader_signed_at desc);
create index performance_contracts_leader on public.performance_agreement_contracts(leader_user_id, leader_signed_at desc);
alter table public.performance_agreement_contracts enable row level security;
revoke all on public.performance_agreement_contracts from public, anon, authenticated;
grant select, insert on public.performance_agreement_contracts to authenticated;
grant all on public.performance_agreement_contracts to service_role;
create policy performance_contracts_read on public.performance_agreement_contracts for select to authenticated
using (exists(select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.active and p.deleted_at is null)
 and (report_user_id = (select auth.uid()) or leader_user_id = (select auth.uid()) or (select public.can_review_performance_agreements())));
create policy performance_contracts_issue on public.performance_agreement_contracts for insert to authenticated
with check (leader_user_id = (select auth.uid()) and report_user_id <> (select auth.uid()) and public.can_access_performance_agreement(report_user_id));

-- The leader already has UPDATE on the agreement, allowing a share lock without elevated privileges.
create function public.validate_performance_contract() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare a public.performance_agreements; report public.profiles; leader public.profiles;
begin
 select * into a from public.performance_agreements where id = new.agreement_id for share;
 if auth.uid() is null or a.id is null or a.report_user_id = auth.uid()
   or not public.can_access_performance_agreement(a.report_user_id) or a.version <> new.agreement_version or a.archived_at is not null then
   raise exception 'performance_agreement_conflict';
 end if;
 select * into report from public.profiles where user_id = a.report_user_id;
 select * into leader from public.profiles where user_id = auth.uid();
 new.report_user_id := a.report_user_id;
 new.leader_user_id := auth.uid();
 new.report_identity := jsonb_build_object('user_id',report.user_id,'full_name',coalesce(nullif(report.full_name,''),report.email),'email',report.email);
 new.leader_identity := jsonb_build_object('user_id',leader.user_id,'full_name',coalesce(nullif(leader.full_name,''),leader.email),'email',leader.email);
 new.snapshot := to_jsonb(a);
 new.terms := 'O líder e o liderado registram neste instrumento as metas, os indicadores, os resultados esperados e os prazos do ciclo indicado. O líder se compromete a comunicar as expectativas e acompanhar a execução. O liderado declara ciência das condições e se compromete a atuar para alcançar as metas, comunicando impedimentos ao líder. As partes realizarão o acompanhamento durante a vigência. Qualquer alteração gera uma nova revisão, que exige novo registro de assinatura. Os documentos e as assinaturas de revisões anteriores são preservados para consulta. Este instrumento registra os compromissos de performance do ciclo e não altera, por si só, as condições do vínculo de trabalho.';
 new.leader_signature_name := btrim(new.leader_signature_name);
 new.leader_signed_at := clock_timestamp();
 new.content_hash := encode(sha256(convert_to(jsonb_build_object('agreement',new.snapshot,'report',new.report_identity,'leader',new.leader_identity,'terms',new.terms)::text,'UTF8')),'hex');
 return new;
end; $$;
revoke all on function public.validate_performance_contract() from public, anon, authenticated;
create trigger performance_contract_snapshot before insert on public.performance_agreement_contracts
for each row execute function public.validate_performance_contract();

create table public.performance_contract_acceptances (
 id uuid primary key default gen_random_uuid(),
 contract_id uuid not null unique references public.performance_agreement_contracts(id),
 signer_id uuid not null default auth.uid() references public.profiles(user_id),
 signature_name text not null check(length(btrim(signature_name)) between 3 and 200),
 location_description text not null check(length(btrim(location_description)) between 2 and 200),
 latitude double precision check(latitude between -90 and 90),
 longitude double precision check(longitude between -180 and 180),
 check((latitude is null) = (longitude is null)),
 signed_at timestamptz not null default now(),
 content_hash text not null,
 statement text not null
);
create index performance_acceptances_signer on public.performance_contract_acceptances(signer_id);
alter table public.performance_contract_acceptances enable row level security;
revoke all on public.performance_contract_acceptances from public, anon, authenticated;
grant select, insert on public.performance_contract_acceptances to authenticated;
grant all on public.performance_contract_acceptances to service_role;
create policy performance_acceptances_read on public.performance_contract_acceptances for select to authenticated
using (exists(select 1 from public.performance_agreement_contracts c where c.id = contract_id));
create policy performance_acceptances_sign on public.performance_contract_acceptances for insert to authenticated
with check (signer_id = (select auth.uid()) and exists(select 1 from public.performance_agreement_contracts c where c.id = contract_id and c.report_user_id = (select auth.uid())));
create function public.validate_performance_contract_acceptance() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare c public.performance_agreement_contracts;
begin
 select * into c from public.performance_agreement_contracts where id = new.contract_id;
 if auth.uid() is null or c.id is null or c.report_user_id <> auth.uid() or not exists(select 1 from public.performance_agreements a where a.id=c.agreement_id and a.version=c.agreement_version and a.archived_at is null) then
   raise exception 'performance_contract_signature_forbidden';
 end if;
 new.signer_id := auth.uid();
 new.signature_name := btrim(new.signature_name);
 new.location_description := btrim(new.location_description);
 new.signed_at := clock_timestamp();
 new.content_hash := c.content_hash;
 new.statement := 'Declaro que li o documento integral deste acordo, compreendi as metas, os prazos e os compromissos registrados e assino esta revisão.';
 return new;
end; $$;
revoke all on function public.validate_performance_contract_acceptance() from public, anon, authenticated;
create trigger performance_contract_acceptance before insert on public.performance_contract_acceptances
for each row execute function public.validate_performance_contract_acceptance();

-- Keep the existing receipt / notification flow in sync with the formal contract signature.
create function public.record_performance_contract_receipt() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
 insert into public.performance_acknowledgments(agreement_id,agreement_version,signature_name)
 select c.agreement_id,c.agreement_version,new.signature_name from public.performance_agreement_contracts c where c.id=new.contract_id
 on conflict (agreement_id,agreement_version) do nothing;
 return new;
end; $$;
revoke all on function public.record_performance_contract_receipt() from public, anon, authenticated;
create trigger performance_contract_receipt after insert on public.performance_contract_acceptances
for each row execute function public.record_performance_contract_receipt();

-- Original parties keep their signed documents after a reporting-line change.
create policy performance_acknowledgments_contract_read on public.performance_acknowledgments for select to authenticated
using (exists(select 1 from public.performance_agreement_contracts c where c.agreement_id = performance_acknowledgments.agreement_id and c.agreement_version = performance_acknowledgments.agreement_version));

-- Review access must never accidentally become upload access through agreement SELECT.
drop policy performance_files_upload on storage.objects;
create policy performance_files_upload on storage.objects for insert to authenticated
with check (bucket_id = 'performance-files' and (storage.foldername(name))[2] = (select auth.uid())::text and exists (
 select 1 from public.performance_agreements a where a.id::text = (storage.foldername(name))[1]
 and public.can_access_performance_agreement(a.report_user_id)
));
do $compat$ begin
 if to_regprocedure('performance_private.notify_performance_pending()') is not null then
 execute $definition$create or replace function performance_private.notify_performance_pending() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or not public.can_access_performance_agreement(new.report_user_id)
    or new.report_user_id = auth.uid() then
   raise exception 'performance_notification_not_authorized';
 end if;
 if new.archived_at is not null then
   delete from public.user_notifications where entity_id = new.id and notification_type in ('performance_pending','performance_signed');
   return new;
 end if;
 -- An edit makes the current revision pending again, replacing the old occurrence.
 delete from public.user_notifications where entity_id = new.id and notification_type = 'performance_signed';
 insert into public.user_notifications(recipient_user_id, notification_type, entity_id, title, message, actor_user_id)
 values (new.report_user_id, 'performance_pending', new.id, 'Acordo pendente de assinatura',
   'Leia e assine o acordo de performance: ' || new.cycle || ' · Revisão ' || new.version, auth.uid())
 on conflict (recipient_user_id, notification_type, entity_id) do update
 set title = excluded.title, message = excluded.message, actor_user_id = excluded.actor_user_id,
     read_at = null, created_at = clock_timestamp();
 return new;
end; $$;
$definition$;
 end if;
end; $compat$;

do $compat$ begin
 if to_regprocedure('private.weekly_digest_sections(uuid,date)') is not null then
 execute $definition$create or replace function private.weekly_digest_sections(p_user uuid,p_day date) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare saved text:=current_setting('request.jwt.claims',true); result jsonb;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','authenticated')::text,true);
 select coalesce(jsonb_agg(to_jsonb(s) order by s.section,s.title),'[]'::jsonb) into result from (
   select 'Projetos'::text as section,p.id::text as id,p.name as title,p.status::text as detail,
     case p.category when 'governance' then '/governanca/' else '/projetos/' end||p.id as href
   from public.projects p where p.archived_at is null and public.has_project_access(p.id)
   union all
   select 'Reuniões',m.id::text,m.title,to_char(timezone('America/Sao_Paulo',m.scheduled_at),'DD/MM/YYYY HH24:MI'),'/pauta-ra'
   from public.ra_meetings m where m.archived_at is null and timezone('America/Sao_Paulo',m.scheduled_at)::date>=p_day
     and timezone('America/Sao_Paulo',m.scheduled_at)::date<p_day+7 and public.can_access_ra_meeting(m.id)
   union all
   select 'Novos negócios',b.stage::text,'Negócios · '||b.stage::text,count(*)::text||' negócio(s) nesta etapa','/novos-negocios'
   from public.businesses b where public.has_department_access('novos-negocios') and b.archived_at is null group by b.stage
   union all
   select 'Obras',c.status::text,'Obras · '||c.status::text,count(*)::text||' obra(s) neste status','/obras'
   from public.constructions c where public.has_department_access('obras') and c.archived_at is null group by c.status
   union all
   select 'Aluguéis',r.status::text,'Imóveis · '||r.status::text,count(*)::text||' imóvel(is) neste status','/alugueis'
   from public.rentals r where public.has_department_access('alugueis') group by r.status
   union all
   select 'Processos',b.id::text,b.title,b.status::text,'/processos'
   from public.business_processes b where public.has_department_access('processos')
     and b.status<>'arquivado' and (b.status='publicado' or public.can_manage_processes())
   union all
   select 'Acordo de Performance',a.id::text,a.cycle||' · '||(g.goal->>'title'),
     'Prazo: '||to_char((g.goal->>'due_date')::date,'DD/MM/YYYY')||' · Indicador: '||(g.goal->>'indicator')||' · Resultado esperado: '||(g.goal->>'expected_result'),
     '/acordo-performance'
   from public.performance_agreements a cross join lateral jsonb_array_elements(a.goals) g(goal)
   where a.archived_at is null and public.can_access_performance_agreement(a.report_user_id)
     and a.starts_on<p_day+7 and a.ends_on>=p_day
     and (g.goal->>'due_date')::date<p_day+7
   union all
   select 'Indicadores',c.area,c.area,count(*)::text||' indicador(es) disponível(is) para acompanhamento','/indicadores/'||c.area
   from public.management_metric_catalog c where public.has_indicator_area_access(c.area) group by c.area
   union all
   select 'Áreas disponíveis',d.slug,d.name,'Consulte os acompanhamentos e pendências da semana','/'||d.slug
   from public.departments d where public.has_department_access(d.slug)
 ) s;
 perform set_config('request.jwt.claims',coalesce(saved,''),true);
 return result;
exception when others then
 perform set_config('request.jwt.claims',coalesce(saved,''),true); raise;
end; $$;$definition$;
 end if;
end; $compat$;

commit;
