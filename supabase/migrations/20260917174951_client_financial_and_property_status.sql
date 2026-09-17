begin;
set local lock_timeout = '3s';
insert into public.data_connections(slug,provider,name,description,schedule_cron,settings)
values ('qlik-client-status','qlik-cloud','Qlik — Situação dos clientes',
 'Quitação, escritura e registro por contrato, vinculados pelos IDs do Qlik.', '50 8 * * *',
 '{"app_id":"465cc478-f1b4-4969-b057-d80a623b6de8"}'::jsonb);
create unique index client_status_one_running_idx on public.data_connection_runs(connection_slug)
 where connection_slug='qlik-client-status' and status='running';

-- Sales/registry facts are kept separate from the financial imports, which
-- refresh client_contracts independently throughout the day.
create table public.client_property_statuses (
 contract_id text primary key references public.client_contracts(id),
 paid_off boolean not null check(paid_off=(sale_status='Quitada')),
 sale_status text not null check(sale_status in ('Normal','Quitada','Cancelado')),
 deed_status text,
 registration_status text,
 source_revision timestamptz not null,
 synchronized_at timestamptz not null default now()
);
alter table public.client_property_statuses enable row level security;
revoke all on public.client_property_statuses from anon, authenticated;
grant select on public.client_property_statuses to authenticated;
grant all on public.client_property_statuses to service_role;
create policy client_property_statuses_read on public.client_property_statuses
 for select to authenticated using (
  (select public.has_department_access('clientes')) or
  (select public.has_department_access('cobranca'))
 );

create function public.client_status_summary(p_client_ids text[])
returns table(contract_id text, overdue_amount numeric, receivable_amount numeric,
 financial_status text, deed_status text, registration_status text, status_synced_at timestamptz, sale_status text)
language plpgsql stable security invoker set search_path = '' as $$
begin
 if coalesce(cardinality(p_client_ids),0)>30 then raise exception 'too_many_clients'; end if;
 return query
 with publication as (
  select exists(select 1 from public.operational_publications p where p.kind='receivable') as ready
 ), balances as (
  select c.id,
   coalesce(sum(e.amount) filter(where e.amount>0),0) as outstanding,
   coalesce(sum(e.amount) filter(where e.amount>0 and e.cash_date<(now() at time zone 'America/Sao_Paulo')::date),0) as overdue,
   count(*) filter(where e.amount>0 and e.cash_date is null) as undated
  from public.client_contracts c
  left join public.operational_cash_entries e on e.contract_id=c.id and e.active and e.kind='receivable'
  where c.client_id=any(p_client_ids)
  group by c.id
 )
 select b.id,b.overdue,b.outstanding,
  case when not p.ready then 'unknown'
   when b.overdue>=0.01 then 'overdue'
   when b.undated>0 then 'unknown'
   when b.outstanding>=0.01 then 'current'
   when s.paid_off then 'paid'
   when s.sale_status='Normal' then 'current'
   else 'unknown' end,
  s.deed_status,s.registration_status,s.synchronized_at,s.sale_status
 from balances b cross join publication p
 left join public.client_property_statuses s on s.contract_id=b.id;
end $$;
revoke all on function public.client_status_summary(text[]) from public,anon;
grant execute on function public.client_status_summary(text[]) to authenticated,service_role;

-- Replace only after a complete, validated Qlik read. Readers see a single
-- consistent snapshot; failed imports leave the previous one intact.
create function public.publish_client_property_statuses(p_rows jsonb,p_source_revision timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare matched integer; total integer;
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or p_source_revision is null then
  raise exception 'empty_status_import';
 end if;
 perform pg_advisory_xact_lock(hashtext('client_property_statuses'));
 if exists(select 1 from public.client_property_statuses where source_revision>p_source_revision) then
  raise exception 'stale_status_import';
 end if;
 select count(*) into total from jsonb_to_recordset(p_rows) as x(contract_id text);
 if exists(select 1 from jsonb_to_recordset(p_rows) as x(contract_id text) where nullif(x.contract_id,'') is null)
  or (select count(distinct x.contract_id) from jsonb_to_recordset(p_rows) as x(contract_id text))<>total then
  raise exception 'invalid_status_keys';
 end if;
 select count(*) into matched from jsonb_to_recordset(p_rows) as x(contract_id text)
 join public.client_contracts c on c.id=x.contract_id;
 if matched=0 then raise exception 'no_matching_contracts'; end if;
 if exists(select 1 from jsonb_to_recordset(p_rows) as x(contract_id text,company_id text,work_key text)
  join public.client_contracts c on c.id=x.contract_id
  where c.company_id is distinct from x.company_id or c.work_key is distinct from x.work_key) then
  raise exception 'contract_identity_mismatch';
 end if;
 delete from public.client_property_statuses;
 insert into public.client_property_statuses(contract_id,paid_off,sale_status,deed_status,registration_status,source_revision)
 select c.id,x.paid_off,x.sale_status,x.deed_status,x.registration_status,p_source_revision
 from jsonb_to_recordset(p_rows) as x(contract_id text,paid_off boolean,sale_status text,deed_status text,registration_status text)
 join public.client_contracts c on c.id=x.contract_id;
 return jsonb_build_object('source_rows',total,'matched_contracts',matched,'unmatched_contracts',total-matched);
end $$;
revoke all on function public.publish_client_property_statuses(jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.publish_client_property_statuses(jsonb,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
