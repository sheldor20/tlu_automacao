begin;
insert into public.departments (slug,name,position) values ('prestacao-contas','Prestação de contas',12) on conflict(slug) do nothing;
create table public.accountability_enterprises (
 id uuid primary key default gen_random_uuid(),
 name text not null unique,
 qlik_value text not null unique,
 active boolean not null default true
);
create table public.accountability_dispatches (
 id uuid primary key default gen_random_uuid(),
 enterprise_id uuid not null references public.accountability_enterprises(id),
 year integer not null check(year between 2026 and 2100),
 month integer not null check(month between 1 and 12),
 historical_sent boolean not null default false,
 status text not null check(status in ('historical','processing','sent_beta','failed','uncertain')),
 recipient text not null default 'rosangela@terralotusurbanismo.com.br' check(recipient='rosangela@terralotusurbanismo.com.br'),
 requested_by uuid references auth.users(id),
 provider_id text,
 error text,
 sent_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(enterprise_id,year,month),
 check(status <> 'sent_beta' or (provider_id is not null and sent_at is not null))
);
create table public.accountability_periods (
 year integer not null,
 month integer not null check(month between 1 and 12),
 closed boolean not null default false,
 confirmed_by uuid references auth.users(id),
 confirmed_at timestamptz not null default now(),
 primary key(year,month)
);
insert into public.accountability_enterprises(name,qlik_value)
select name,name from unnest(array[
 'Condomínio Porto Fino','Residencial Alfredo Abrahão | JM','Residencial Alfredo Abrahão | Master',
 'Residencial Jardim Araguaia | Master','Residencial Vale das Águas','Residencial Vale das Águas | Master',
 'Residencial Vale das Águas | Parceiros','SCP Res Parque dos Buritis',
 'SCP Res Pq dos Lírios | Além do Horizonte','SCP Res Pq dos Lírios | Mª Auxiliadora',
 'SCP Res Pq dos Lírios | Mª Auxiliadora | Master','SPE Residencial Beira Rio I Etapa',
 'SPE Residencial Beira Rio II Etapa','SPE Residencial Roma','SPE Residencial Roma | Master'
]) as name;
-- Closed and sent through September, as explicitly confirmed by the owner.
insert into public.accountability_periods(year,month,closed) select 2026,m,true from generate_series(1,9) m;
insert into public.accountability_dispatches(enterprise_id,year,month,status,historical_sent)
select e.id,2026,m,'historical',true from public.accountability_enterprises e cross join generate_series(1,9) m;
alter table public.accountability_enterprises enable row level security;
alter table public.accountability_dispatches enable row level security;
alter table public.accountability_periods enable row level security;
revoke all on public.accountability_enterprises,public.accountability_dispatches,public.accountability_periods from anon,authenticated;
grant select on public.accountability_enterprises,public.accountability_dispatches,public.accountability_periods to authenticated;
grant insert,update on public.accountability_periods to authenticated;
grant all on public.accountability_enterprises,public.accountability_dispatches,public.accountability_periods to service_role;
create policy accountability_enterprises_read on public.accountability_enterprises for select to authenticated using(public.has_department_access('prestacao-contas'));
create policy accountability_dispatches_read on public.accountability_dispatches for select to authenticated using(public.has_department_access('prestacao-contas'));
create policy accountability_periods_read on public.accountability_periods for select to authenticated using(public.has_department_access('prestacao-contas'));
create policy accountability_periods_admin_insert on public.accountability_periods for insert to authenticated with check(public.is_system_admin() and confirmed_by=auth.uid());
create policy accountability_periods_admin_update on public.accountability_periods for update to authenticated using(public.is_system_admin()) with check(public.is_system_admin() and confirmed_by=auth.uid());
create trigger accountability_dispatches_updated_at before update on public.accountability_dispatches for each row execute function public.set_updated_at();
commit;
