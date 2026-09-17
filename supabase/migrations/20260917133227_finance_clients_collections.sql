begin;
insert into public.departments(slug,name,position) values ('financeiro','Financeiro',9),('clientes','Clientes',10),('cobranca','Cobrança',11) on conflict(slug) do nothing;

create table public.qlik_companies (
 id text primary key, name text not null, company_key text not null unique, synchronized_at timestamptz not null default now()
);
create table public.qlik_works (
 key text primary key, company_id text not null references public.qlik_companies(id), work_id text not null, name text not null,
 active boolean not null default true, synchronized_at timestamptz not null default now(), unique(company_id,work_id)
);
create index qlik_works_company_idx on public.qlik_works(company_id);
alter table public.businesses add column qlik_work_key text references public.qlik_works(key);
alter table public.constructions add column qlik_work_key text references public.qlik_works(key);
alter table public.payment_requests add column qlik_work_key text references public.qlik_works(key);
create index businesses_qlik_work_idx on public.businesses(qlik_work_key);
create index constructions_qlik_work_idx on public.constructions(qlik_work_key);
create index payment_requests_qlik_work_idx on public.payment_requests(qlik_work_key);

create table public.client_accounts (
 id text primary key, name text not null, phone text, email text,
 synchronized_at timestamptz not null default now()
);
create table public.client_contracts (
 id text primary key, client_id text not null references public.client_accounts(id), work_key text references public.qlik_works(key),
 company_id text not null references public.qlik_companies(id), contract_number text not null,
 lot text, block text, status text, synchronized_at timestamptz not null default now()
);
create index client_contracts_client_idx on public.client_contracts(client_id);
create index client_contracts_work_idx on public.client_contracts(work_key);
create index client_contracts_company_idx on public.client_contracts(company_id);
create table public.operational_cash_entries (
 id text primary key, company_id text not null references public.qlik_companies(id), work_key text references public.qlik_works(key),
 contract_id text references public.client_contracts(id), kind text not null check(kind in ('receivable','received','payable','paid')),
 title_key text, cash_date date, original_due_date date, amount numeric(20,6) not null,
 description text not null default '', counterparty text, stage_name text, source_category text,
 synchronized_at timestamptz not null default now(), active boolean not null default true
);
create index operational_cash_company_date_idx on public.operational_cash_entries(company_id,cash_date) where active;
create index operational_cash_work_idx on public.operational_cash_entries(work_key) where active;
create index operational_cash_contract_idx on public.operational_cash_entries(contract_id) where active;
create table public.collection_cases (
 contract_id text primary key references public.client_contracts(id), responsible_user_id uuid references public.profiles(user_id),
 legal_status text not null default 'unknown' check(legal_status in ('unknown','extrajudicial','judicial','suspended')),
 next_action text not null default '', next_action_date date, last_contact_at timestamptz,
 promise_date date, promise_amount numeric(20,2) check(promise_amount>0), promise_status text not null default 'none' check(promise_status in ('none','open','fulfilled','broken','cancelled')),
 receipt_entry_id text references public.operational_cash_entries(id), notes text not null default '', version integer not null default 1,
 updated_at timestamptz not null default now(), updated_by uuid references public.profiles(user_id),
 check((promise_date is null)=(promise_amount is null)),
 check(promise_status <> 'open' or promise_date is not null), check(promise_status <> 'fulfilled' or receipt_entry_id is not null)
);
create index collection_cases_owner_idx on public.collection_cases(responsible_user_id);
create index collection_cases_next_idx on public.collection_cases(next_action_date);
create index collection_cases_receipt_idx on public.collection_cases(receipt_entry_id);
create index collection_cases_updated_by_idx on public.collection_cases(updated_by);
create table public.client_events (
 id uuid primary key default gen_random_uuid(), client_id text not null references public.client_accounts(id),
 contract_id text references public.client_contracts(id), kind text not null check(kind in ('contact','renegotiation','legal','document','regularization','collection')),
 title text not null check(length(title) between 1 and 300), description text not null default '', event_date date not null default current_date,
 due_date date, status text not null default 'open' check(status in ('open','in_progress','completed','cancelled')),
 responsible_user_id uuid references public.profiles(user_id), file_path text, file_name text,
 created_by uuid not null references public.profiles(user_id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index client_events_client_idx on public.client_events(client_id,event_date desc);
create index client_events_contract_idx on public.client_events(contract_id);
create index client_events_owner_idx on public.client_events(responsible_user_id);
create index client_events_creator_idx on public.client_events(created_by);
create table public.cash_opening_balances (
 company_id text not null references public.qlik_companies(id), as_of date not null, amount numeric(20,2) not null,
 note text not null default '', updated_by uuid not null references public.profiles(user_id), updated_at timestamptz not null default now(), primary key(company_id,as_of)
);
create index cash_opening_owner_idx on public.cash_opening_balances(updated_by);
create table public.construction_commitments (
 id uuid primary key default gen_random_uuid(), construction_id uuid not null references public.constructions(id),
 macro_stage_id uuid references public.construction_macro_stages(id), supplier text not null, description text not null,
 due_date date not null, amount numeric(20,2) not null check(amount>0), status text not null default 'committed' check(status in ('committed','paid','cancelled')),
 payment_request_id uuid references public.payment_requests(id), cash_entry_id text references public.operational_cash_entries(id),
 created_by uuid not null references public.profiles(user_id), created_at timestamptz not null default now()
);
create index construction_commitments_construction_idx on public.construction_commitments(construction_id);
create index construction_commitments_stage_idx on public.construction_commitments(macro_stage_id);
create index construction_commitments_payment_idx on public.construction_commitments(payment_request_id);
create index construction_commitments_cash_idx on public.construction_commitments(cash_entry_id);
create index construction_commitments_creator_idx on public.construction_commitments(created_by);
create table public.construction_cost_estimates (
 construction_id uuid primary key references public.constructions(id), remaining_uncommitted numeric(20,2) not null check(remaining_uncommitted>=0),
 note text not null default '', updated_by uuid not null references public.profiles(user_id), updated_at timestamptz not null default now()
);
create index construction_estimates_owner_idx on public.construction_cost_estimates(updated_by);
create table public.cash_reconciliations (
 request_id uuid primary key references public.payment_requests(id), state text not null check(state in ('additional','linked')),
 cash_entry_id text references public.operational_cash_entries(id), updated_by uuid not null references public.profiles(user_id), updated_at timestamptz not null default now(),
 check((state='linked' and cash_entry_id is not null) or (state='additional' and cash_entry_id is null))
);
create index cash_reconciliations_entry_idx on public.cash_reconciliations(cash_entry_id);
create index cash_reconciliations_owner_idx on public.cash_reconciliations(updated_by);

-- Module access is controlled through the existing Administration screen.
-- New departments do not implicitly grant anyone access to customer data.
do $$
declare t text; access_expr text;
begin
 foreach t in array array['qlik_companies','qlik_works','client_accounts','client_contracts','operational_cash_entries','collection_cases','client_events','cash_opening_balances','construction_commitments','construction_cost_estimates','cash_reconciliations'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  access_expr := case
   when t in ('qlik_companies','qlik_works') then 'public.has_department_access(''financeiro'') or public.has_department_access(''clientes'') or public.has_department_access(''cobranca'') or public.has_department_access(''obras'') or public.has_department_access(''novos-negocios'')'
   when t in ('client_accounts','client_contracts','collection_cases','client_events') then 'public.has_department_access(''clientes'') or public.has_department_access(''cobranca'')'
   when t='operational_cash_entries' then 'public.has_department_access(''financeiro'') or public.has_department_access(''clientes'') or public.has_department_access(''cobranca'') or public.has_department_access(''obras'')'
   when t in ('construction_commitments','construction_cost_estimates') then 'public.has_department_access(''obras'') or public.has_department_access(''financeiro'')'
   else 'public.has_department_access(''financeiro'')' end;
  execute format('create policy %I on public.%I for select to authenticated using (%s)',t||'_read',t,access_expr);
 end loop;
end $$;

-- Keep the business and its generated construction attached to the same Qlik work.
create function public.propagate_business_qlik_work() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.constructions set qlik_work_key=new.qlik_work_key where source_business_id=new.id and qlik_work_key is distinct from new.qlik_work_key;
 return new;
end $$;
create trigger business_qlik_work_after after insert or update of qlik_work_key on public.businesses for each row execute function public.propagate_business_qlik_work();
create function public.inherit_construction_qlik_work() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.source_business_id is not null then select qlik_work_key into new.qlik_work_key from public.businesses where id=new.source_business_id; end if;
 return new;
end $$;
create trigger construction_qlik_work_before before insert or update of source_business_id on public.constructions for each row execute function public.inherit_construction_qlik_work();
revoke all on function public.propagate_business_qlik_work(),public.inherit_construction_qlik_work() from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('client-documents','client-documents',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp','application/vnd.openxmlformats-officedocument.wordprocessingml.document']) on conflict(id) do nothing;

insert into public.data_connections(slug,provider,name,description,schedule_cron,active,settings)
values('qlik-operations','qlik','Qlik • Clientes, obras e caixa','Catálogo por ID e carteira operacional de títulos.','0 10 * * *',false,'{"mapping_verified":false}'::jsonb);

create function public.save_collection_case(p_data jsonb,p_actor uuid) returns void language plpgsql security invoker set search_path='' as $$
declare r public.collection_cases%rowtype; c public.client_contracts%rowtype; receipt public.operational_cash_entries%rowtype;
begin
 perform pg_advisory_xact_lock(hashtext(p_data->>'contract_id'));
 select * into c from public.client_contracts where id=p_data->>'contract_id';
 if not found then raise exception 'contract_not_found'; end if;
 select * into r from public.collection_cases where contract_id=c.id for update;
 if coalesce(r.version,0)<>(p_data->>'version')::integer then raise exception 'collection_conflict'; end if;
 if p_data->>'promise_status'='fulfilled' then
  select * into receipt from public.operational_cash_entries where id=p_data->>'receipt_entry_id' and contract_id=c.id and kind='received' and active;
  if receipt.id is null or receipt.amount<coalesce((p_data->>'promise_amount')::numeric,0) or receipt.cash_date is null or receipt.cash_date>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'receipt_invalid'; end if;
 end if;
 insert into public.collection_cases(contract_id,responsible_user_id,legal_status,next_action,next_action_date,last_contact_at,promise_date,promise_amount,promise_status,receipt_entry_id,notes,version,updated_by)
 values(c.id,(p_data->>'responsible_user_id')::uuid,p_data->>'legal_status',p_data->>'next_action',(p_data->>'next_action_date')::date,(p_data->>'last_contact_at')::timestamptz,(p_data->>'promise_date')::date,(p_data->>'promise_amount')::numeric,p_data->>'promise_status',p_data->>'receipt_entry_id',p_data->>'notes',coalesce(r.version,0)+1,p_actor)
 on conflict(contract_id) do update set responsible_user_id=excluded.responsible_user_id,legal_status=excluded.legal_status,next_action=excluded.next_action,next_action_date=excluded.next_action_date,last_contact_at=excluded.last_contact_at,promise_date=excluded.promise_date,promise_amount=excluded.promise_amount,promise_status=excluded.promise_status,receipt_entry_id=excluded.receipt_entry_id,notes=excluded.notes,version=excluded.version,updated_by=p_actor,updated_at=now();
 insert into public.client_events(client_id,contract_id,kind,title,description,created_by) values(c.client_id,c.id,'collection','Tratativa de cobrança atualizada',jsonb_build_object('anterior',to_jsonb(r),'atual',p_data)::text,p_actor);
end $$;
revoke all on function public.save_collection_case(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_collection_case(jsonb,uuid) to service_role;
create or replace function public.create_payment_request(p_data jsonb,p_actor uuid,p_token text,p_token_hash text,p_digest text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request public.payment_requests%rowtype; v_company text; v_profile public.profiles%rowtype; v_snapshot uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_data->>'submission_id'));
  select * into v_request from public.payment_requests where submission_id=(p_data->>'submission_id')::uuid;
  if found then
    if v_request.deleted_at is not null then raise exception 'payment_not_found'; end if;
    if v_request.submission_digest <> p_digest or v_request.requester_user_id is distinct from p_actor then raise exception 'submission_conflict'; end if;
    return jsonb_build_object('id',v_request.id,'protocol',v_request.protocol,'token',(select token from public.payment_request_tokens where request_id=v_request.id));
  end if;
  if p_actor is not null then
    select * into v_profile from public.profiles where user_id=p_actor and active and deleted_at is null;
    if not found then raise exception 'payment_forbidden'; end if;
  end if;
  select id into v_snapshot from public.enterprise_performance_snapshots order by captured_at desc,id desc limit 1;
  select name into v_company from public.enterprise_performance_companies where snapshot_id=v_snapshot and company_key=p_data->>'company_key';
  if v_company is null then raise exception 'payment_company_not_found'; end if;
  insert into public.payment_requests(submission_id,submission_digest,requester_user_id,requester_name,requester_email,requester_phone,
    company_key,company_name,project_name,qlik_work_key,type,title,description,amount,budget_max,due_date,beneficiary,details,quotes,source)
  values((p_data->>'submission_id')::uuid,p_digest,p_actor,p_data->>'requester_name',p_data->>'requester_email',p_data->>'requester_phone',
    p_data->>'company_key',v_company,p_data->>'project_name',nullif(p_data->>'qlik_work_key',''),p_data->'details'->>'type',p_data->>'title',p_data->>'description',(p_data->>'amount')::numeric,
    (p_data->>'budget_max')::numeric,(p_data->>'due_date')::date,p_data->'beneficiary',p_data->'details',p_data->'quotes',case when p_actor is null then 'public' else 'internal' end)
  returning * into v_request;
  insert into public.payment_request_tokens(request_id,token,token_hash) values(v_request.id,p_token,p_token_hash);
  insert into public.payment_request_events(request_id,kind,status,message,actor_id,actor_name)
    values(v_request.id,'created','submitted','Solicitação recebida.',p_actor,v_request.requester_name);
  return jsonb_build_object('id',v_request.id,'protocol',v_request.protocol,'token',p_token);
end;
$$;

create or replace function public.manage_payment_request(p_id uuid,p_actor uuid,p_version integer,p_action text,p_data jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare
  r public.payment_requests%rowtype;
  v_after public.payment_requests%rowtype;
  v_name text; v_company text; v_snapshot uuid; v_type text;
begin
  select p.full_name into v_name from public.profiles p
    left join public.profile_payment_permissions a on a.user_id=p.user_id
    where p.user_id=p_actor and p.active and p.deleted_at is null and (p.is_admin or coalesce(a.can_manage,false));
  if not found then raise exception 'payment_forbidden'; end if;
  select * into r from public.payment_requests where id=p_id for update;
  if not found or r.deleted_at is not null then raise exception 'payment_not_found'; end if;
  if p_version is distinct from r.version then raise exception 'payment_conflict'; end if;
  if p_action='delete' then
    update public.payment_requests set deleted_at=now(),deleted_by=p_actor,version=version+1,updated_at=now() where id=p_id;
  elsif p_action='edit' then
    v_type := p_data->'details'->>'type';
    if r.status in ('paid','finalized') and v_type in ('service','termination') and not exists (
      select 1 from public.payment_request_files where request_id=p_id and kind='receipt' and ready
    ) then raise exception 'payment_receipt_required'; end if;
    if p_data->>'company_key'=r.company_key then
      v_company := r.company_name;
    else
      select id into v_snapshot from public.enterprise_performance_snapshots order by captured_at desc,id desc limit 1;
      select name into v_company from public.enterprise_performance_companies where snapshot_id=v_snapshot and company_key=p_data->>'company_key';
      if v_company is null then raise exception 'payment_company_not_found'; end if;
    end if;
    update public.payment_requests set
      requester_name=p_data->>'requester_name',requester_email=p_data->>'requester_email',
      requester_phone=p_data->>'requester_phone',company_key=p_data->>'company_key',company_name=v_company,
      project_name=p_data->>'project_name',qlik_work_key=nullif(p_data->>'qlik_work_key',''),type=v_type,title=p_data->>'title',description=p_data->>'description',
      amount=(p_data->>'amount')::numeric,budget_max=(p_data->>'budget_max')::numeric,due_date=(p_data->>'due_date')::date,
      beneficiary=p_data->'beneficiary',details=p_data->'details',quotes=p_data->'quotes',
      version=version+1,updated_at=now()
      where id=p_id;
  else raise exception 'payment_invalid_action'; end if;
  select * into v_after from public.payment_requests where id=p_id;
  insert into public.payment_request_revisions(request_id,actor_id,action,before_data,after_data)
    values(p_id,p_actor,p_action,to_jsonb(r)-'submission_digest'-'submission_id',to_jsonb(v_after)-'submission_digest'-'submission_id');
  insert into public.payment_request_events(request_id,kind,status,message,actor_id,actor_name)
    values(p_id,case when p_action='delete' then 'deleted' else 'edited' end,r.status,
      case when p_action='delete' then 'Solicitação excluída pela gestão de pagamentos.' else 'Dados da solicitação atualizados pela gestão de pagamentos.' end,
      p_actor,coalesce(v_name,'Gestão de pagamentos'));
end;
$$;
revoke all on function public.manage_payment_request(uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_payment_request(uuid,uuid,integer,text,jsonb) to service_role;

create function public.validate_payment_qlik_work() returns trigger language plpgsql security invoker set search_path='' as $$
declare v_name text; v_company text;
begin
 if new.qlik_work_key is not null then
  select w.name,c.company_key into v_name,v_company from public.qlik_works w join public.qlik_companies c on c.id=w.company_id where w.key=new.qlik_work_key;
  if v_company is distinct from new.company_key then raise exception 'payment_work_company_mismatch'; end if;
  new.project_name=v_name;
 end if;
 return new;
end $$;
create trigger payment_qlik_work_check before insert or update of company_key,qlik_work_key on public.payment_requests for each row execute function public.validate_payment_qlik_work();
revoke all on function public.validate_payment_qlik_work() from public,anon,authenticated;

-- Include the stable Qlik reference in the existing summary views, preserving columns.
do $$ declare v text; begin
 v:=regexp_replace(pg_get_viewdef('public.business_operational_summary'::regclass,true),';\s*$','');
 execute 'create or replace view public.business_operational_summary with(security_invoker=true) as select old.*,b.qlik_work_key from ('||v||') old join public.businesses b on b.id=old.id';
 v:=regexp_replace(pg_get_viewdef('public.construction_progress_summary'::regclass,true),';\s*$','');
 execute 'create or replace view public.construction_progress_summary with(security_invoker=true) as select old.*,b.qlik_work_key from ('||v||') old join public.constructions b on b.id=old.id';
end $$;
-- Customer modules only read receivables and receipts, never supplier outflows.
drop policy operational_cash_entries_read on public.operational_cash_entries;
create policy operational_cash_entries_read on public.operational_cash_entries for select to authenticated using (
 public.has_department_access('financeiro') or
 (public.has_department_access('obras') and work_key is not null) or
 (kind in ('receivable','received') and (public.has_department_access('clientes') or public.has_department_access('cobranca')))
);
-- Imports are staged by source and published atomically only after reconciliation.
create table public.operational_imports (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('catalog','receivable','received','payable','paid')),
 status text not null default 'running' check(status in ('running','success','error')),
 started_at timestamptz not null default now(), finished_at timestamptz, row_count integer, total numeric, error text
);
create unique index operational_imports_running on public.operational_imports(kind) where status='running';
create table public.operational_import_rows (
 run_id uuid not null references public.operational_imports(id) on delete cascade,
 entity text not null check(entity in ('companies','works','clients','contracts','entries')),
 id text not null, data jsonb not null, primary key(run_id,entity,id)
);
alter table public.operational_imports enable row level security;
alter table public.operational_import_rows enable row level security;
revoke all on public.operational_imports,public.operational_import_rows from anon,authenticated;
grant all on public.operational_imports,public.operational_import_rows to service_role;
create function public.begin_operational_import(p_kind text) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
 perform pg_advisory_xact_lock(hashtext('operational-'||p_kind));
 update public.operational_imports set status='error',error='Carga interrompida',finished_at=now() where kind=p_kind and status='running' and started_at<now()-interval '10 minutes';
 insert into public.operational_imports(kind) values(p_kind) returning id into v_id;
 delete from public.operational_import_rows where run_id in (select id from public.operational_imports where status<>'running' and started_at<now()-interval '2 days');
 return v_id;
end $$;
create function public.publish_operational_import(p_run uuid,p_count integer,p_total numeric) returns void language plpgsql security invoker set search_path='' as $$
declare r public.operational_imports%rowtype; n integer; v_total numeric;
begin
 select * into r from public.operational_imports where id=p_run and status='running' for update;
 if not found then raise exception 'import_not_running'; end if;
 select count(*),coalesce(sum((data->>'amount')::numeric),0) into n,v_total from public.operational_import_rows where run_id=p_run and entity='entries';
 if n<>p_count or abs(v_total-p_total)>0.01 then raise exception 'import_not_reconciled'; end if;
 if r.kind<>'catalog' and n=0 then raise exception 'empty_import'; end if;
 insert into public.qlik_companies(id,name,company_key) select data->>'id',data->>'name',data->>'company_key' from public.operational_import_rows where run_id=p_run and entity='companies'
 on conflict(id) do update set name=excluded.name,company_key=excluded.company_key,synchronized_at=now();
 if r.kind='catalog' then update public.qlik_works set active=false; end if;
 insert into public.qlik_works(key,company_id,work_id,name) select data->>'key',data->>'company_id',data->>'work_id',data->>'name' from public.operational_import_rows where run_id=p_run and entity='works'
 on conflict(key) do update set company_id=excluded.company_id,work_id=excluded.work_id,name=excluded.name,active=true,synchronized_at=now();
 insert into public.client_accounts(id,name) select data->>'id',data->>'name' from public.operational_import_rows where run_id=p_run and entity='clients'
 on conflict(id) do update set name=excluded.name,synchronized_at=now();
 insert into public.client_contracts(id,client_id,company_id,work_key,contract_number,lot,block,status)
 select data->>'id',data->>'client_id',data->>'company_id',data->>'work_key',data->>'contract_number',data->>'lot',data->>'block',data->>'status'
 from public.operational_import_rows where run_id=p_run and entity='contracts'
 on conflict(id) do update set client_id=excluded.client_id,company_id=excluded.company_id,work_key=excluded.work_key,contract_number=excluded.contract_number,lot=excluded.lot,block=excluded.block,status=excluded.status,synchronized_at=now();
 if r.kind<>'catalog' then
  if exists(select 1 from public.operational_import_rows where run_id=p_run and entity='entries' and data->>'kind'<>r.kind) then raise exception 'import_kind_mismatch'; end if;
  update public.operational_cash_entries set active=false where kind=r.kind and active;
  insert into public.operational_cash_entries(id,company_id,work_key,contract_id,kind,title_key,cash_date,original_due_date,amount,description,counterparty,stage_name,source_category)
  select data->>'id',data->>'company_id',data->>'work_key',data->>'contract_id',data->>'kind',data->>'title_key',(data->>'cash_date')::date,(data->>'original_due_date')::date,(data->>'amount')::numeric,coalesce(data->>'description',''),data->>'counterparty',data->>'stage_name',data->>'source_category'
  from public.operational_import_rows where run_id=p_run and entity='entries'
  on conflict(id) do update set company_id=excluded.company_id,work_key=excluded.work_key,contract_id=excluded.contract_id,kind=excluded.kind,title_key=excluded.title_key,cash_date=excluded.cash_date,original_due_date=excluded.original_due_date,amount=excluded.amount,description=excluded.description,counterparty=excluded.counterparty,stage_name=excluded.stage_name,source_category=excluded.source_category,active=true,synchronized_at=now();
 end if;
 update public.cash_reconciliations cr set cash_entry_id=x.next_id,updated_at=now()
 from (select old.id,min(fresh.id) next_id from public.operational_cash_entries old join public.operational_cash_entries fresh on fresh.title_key=old.title_key and fresh.company_id=old.company_id and fresh.amount=old.amount and fresh.active and fresh.kind in ('paid','payable') where not old.active group by old.id having count(*)=1) x
 where cr.cash_entry_id=x.id;
 update public.construction_commitments cc set cash_entry_id=x.next_id
 from (select old.id,min(fresh.id) next_id from public.operational_cash_entries old join public.operational_cash_entries fresh on fresh.title_key=old.title_key and fresh.company_id=old.company_id and fresh.amount=old.amount and fresh.active and fresh.kind in ('paid','payable') where not old.active group by old.id having count(*)=1) x
 where cc.cash_entry_id=x.id;
 update public.operational_imports set status='success',finished_at=now(),row_count=n,total=v_total where id=p_run;
 update public.data_connections set last_success_at=now(),last_error=null,last_error_at=null,settings=settings||jsonb_build_object(r.kind,jsonb_build_object('at',now(),'rows',n,'total',v_total),'mapping_verified',true) where slug='qlik-operations';
 delete from public.operational_import_rows where run_id=p_run;
end $$;
revoke all on function public.begin_operational_import(text),public.publish_operational_import(uuid,integer,numeric) from public,anon,authenticated;
grant execute on function public.begin_operational_import(text),public.publish_operational_import(uuid,integer,numeric) to service_role;

create view public.client_contract_financials with(security_invoker=true) as
select c.*,a.name as client_name,a.phone,a.email,
coalesce(f.overdue_amount,0) as overdue_amount,coalesce(f.overdue_count,0) as overdue_count,
f.oldest_due,f.latest_due,f.last_receipt,coalesce(f.received_amount,0) as received_amount,coalesce(f.receivable_amount,0) as receivable_amount
from public.client_contracts c join public.client_accounts a on a.id=c.client_id
left join (
 select contract_id,
 sum(amount) filter(where kind='receivable' and amount>0 and cash_date<(now() at time zone 'America/Sao_Paulo')::date) as overdue_amount,
 count(*) filter(where kind='receivable' and amount>0 and cash_date<(now() at time zone 'America/Sao_Paulo')::date) as overdue_count,
 min(coalesce(original_due_date,cash_date)) filter(where kind='receivable' and amount>0 and cash_date<(now() at time zone 'America/Sao_Paulo')::date) as oldest_due,
 max(coalesce(original_due_date,cash_date)) filter(where kind='receivable' and amount>0 and cash_date<(now() at time zone 'America/Sao_Paulo')::date) as latest_due,
 max(cash_date) filter(where kind='received') as last_receipt,
 sum(amount) filter(where kind='received') as received_amount,
 sum(amount) filter(where kind='receivable') as receivable_amount
 from public.operational_cash_entries where active and kind in ('receivable','received') group by contract_id
) f on f.contract_id=c.id;
create view public.collection_worklist with(security_invoker=true) as
select f.*,case
 when overdue_count=0 then 'current'
 when coalesce(c.legal_status,'unknown')='unknown' then 'review'
 when c.legal_status<>'extrajudicial' then 'judicial'
 when overdue_count<=2 and last_receipt>latest_due and c.promise_status<>'broken' and not(c.promise_status='open' and c.promise_date<(now() at time zone 'America/Sao_Paulo')::date) then 'easy'
 when oldest_due>=(now() at time zone 'America/Sao_Paulo')::date-90 and last_receipt is not null and c.promise_status<>'broken' and not(c.promise_status='open' and c.promise_date<(now() at time zone 'America/Sao_Paulo')::date) then 'negotiation'
 else 'difficult' end as collection_group,
 coalesce(c.promise_status='open' and c.promise_date<(now() at time zone 'America/Sao_Paulo')::date,false) as promise_overdue
from public.client_contract_financials f left join public.collection_cases c on c.contract_id=f.id;
revoke all on public.client_contract_financials,public.collection_worklist from public,anon;
grant select on public.client_contract_financials,public.collection_worklist to authenticated,service_role;
create function public.collection_worklist_totals() returns table(collection_group text,contracts bigint,amount numeric,promises bigint) language sql stable security invoker set search_path='' as $$
 select collection_group,count(*),sum(overdue_amount),count(*) filter(where promise_overdue) from public.collection_worklist group by collection_group;
$$;
revoke all on function public.collection_worklist_totals() from public,anon;
grant execute on function public.collection_worklist_totals() to authenticated,service_role;

create function public.search_operational_clients(p_query text,p_page integer)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare ids text[]; total integer; answer jsonb;
begin
 if p_page<0 or p_page>100000 or length(p_query)>200 then raise exception 'invalid_search'; end if;
 select count(*) into total from public.client_accounts a where p_query='' or a.name ilike '%'||p_query||'%' or a.id=p_query or exists(
 select 1 from public.client_contracts c left join public.qlik_works w on w.key=c.work_key where c.client_id=a.id and
 (c.contract_number ilike '%'||p_query||'%' or c.lot ilike '%'||p_query||'%' or concat(c.block,' ',c.lot) ilike '%'||p_query||'%' or w.name ilike '%'||p_query||'%'));
 select array_agg(x.id) into ids from (
 select a.id from public.client_accounts a where p_query='' or a.name ilike '%'||p_query||'%' or a.id=p_query or exists(
 select 1 from public.client_contracts c left join public.qlik_works w on w.key=c.work_key where c.client_id=a.id and
 (c.contract_number ilike '%'||p_query||'%' or c.lot ilike '%'||p_query||'%' or concat(c.block,' ',c.lot) ilike '%'||p_query||'%' or w.name ilike '%'||p_query||'%'))
 order by a.name,a.id limit 30 offset p_page*30) x;
 select jsonb_build_object('total',total,'clients',coalesce((select jsonb_agg(a order by a.name,a.id) from public.client_accounts a where id=any(ids)),'[]'::jsonb),
 'contracts',coalesce((select jsonb_agg(c) from public.client_contracts c where client_id=any(ids)),'[]'::jsonb)) into answer;
 return answer;
end $$;
revoke all on function public.search_operational_clients(text,integer) from public,anon;
grant execute on function public.search_operational_clients(text,integer) to authenticated,service_role;

create function public.operational_cash_projection(p_date date)
returns table(id text,company_id text,work_key text,contract_id text,kind text,title_key text,cash_date date,original_due_date date,amount numeric,description text,counterparty text,stage_name text,synchronized_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select 'summary:'||md5(concat(e.company_id,'|',e.work_key,'|',e.kind,'|',case when e.cash_date<p_date then p_date-1 else p_date+((e.cash_date-p_date)/7)*7 end)),
 e.company_id,e.work_key,null::text,e.kind,null::text,
 case when e.cash_date<p_date then p_date-1 else p_date+((e.cash_date-p_date)/7)*7 end,
 null::date,sum(e.amount),concat(count(*),' títulos · ',coalesce(w.name,'Sem obra')),null::text,null::text,max(e.synchronized_at)
 from public.operational_cash_entries e left join public.qlik_works w on w.key=e.work_key
 where e.active and e.kind in ('receivable','payable') and (e.cash_date is null or e.cash_date<=p_date+90)
 group by e.company_id,e.work_key,w.name,e.kind,case when e.cash_date<p_date then p_date-1 else p_date+((e.cash_date-p_date)/7)*7 end;
$$;
revoke all on function public.operational_cash_projection(date) from public,anon;
grant execute on function public.operational_cash_projection(date) to authenticated,service_role;

create table public.construction_stage_finances (
 macro_stage_id uuid primary key references public.construction_macro_stages(id),
 construction_id uuid not null references public.constructions(id),
 planned_budget numeric(20,2) not null check(planned_budget>=0),
 remaining_uncommitted numeric(20,2) check(remaining_uncommitted>=0),
 updated_by uuid not null references public.profiles(user_id),updated_at timestamptz not null default now()
);
create index construction_stage_finances_work_idx on public.construction_stage_finances(construction_id);
create index construction_stage_finances_actor_idx on public.construction_stage_finances(updated_by);
create table public.construction_stage_mappings (
 construction_id uuid not null references public.constructions(id),source_category text not null,
 macro_stage_id uuid not null references public.construction_macro_stages(id),
 updated_by uuid not null references public.profiles(user_id),updated_at timestamptz not null default now(),
 primary key(construction_id,source_category)
);
create index construction_stage_mappings_stage_idx on public.construction_stage_mappings(macro_stage_id);
create index construction_stage_mappings_actor_idx on public.construction_stage_mappings(updated_by);
alter table public.construction_stage_finances enable row level security;
alter table public.construction_stage_mappings enable row level security;
revoke all on public.construction_stage_finances,public.construction_stage_mappings from anon,authenticated;
grant select on public.construction_stage_finances,public.construction_stage_mappings to authenticated;
grant all on public.construction_stage_finances,public.construction_stage_mappings to service_role;
create policy construction_stage_finances_read on public.construction_stage_finances for select to authenticated using(public.has_department_access('obras'));
create policy construction_stage_mappings_read on public.construction_stage_mappings for select to authenticated using(public.has_department_access('obras'));
create unique index construction_commitments_one_request on public.construction_commitments(payment_request_id) where status<>'cancelled' and payment_request_id is not null;
create unique index construction_commitments_one_entry on public.construction_commitments(cash_entry_id) where status<>'cancelled' and cash_entry_id is not null;

commit;
