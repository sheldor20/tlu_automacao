-- All changes and queued notifications are rolled back; no messages are dispatched.
begin;
do $$
declare
  v_admin uuid; v_nonmanager uuid; v_company text; v_input jsonb; v_edit jsonb; v_result jsonb; v_id uuid; v_file uuid;
  v_before public.payment_requests%rowtype; v_after public.payment_requests%rowtype;
  v_token text := repeat('a',64); v_hash text := gen_random_uuid()::text;
begin
  select user_id into v_admin from public.profiles where active and is_admin and deleted_at is null limit 1;
  select company_key into v_company from public.enterprise_performance_companies where snapshot_id=(select id from public.enterprise_performance_snapshots order by captured_at desc,id desc limit 1) limit 1;
  if v_admin is null or v_company is null then raise exception 'Test requires an administrator and a Qlik company'; end if;
  v_input := jsonb_build_object('submission_id',gen_random_uuid(),'requester_name','TESTE TRANSACIONAL','requester_email','payment-test@example.invalid','requester_phone','',
    'company_key',v_company,'project_name','','title','TESTE EDIÇÃO - ROLLBACK','description','Validação sem envio de e-mail.',
    'amount',null,'budget_max',120,'due_date',current_date,'beneficiary','{}'::jsonb,
    'details',jsonb_build_object('type','materials','delivery_address','Obra','items',jsonb_build_array(jsonb_build_object('description','Cimento','quantity',2,'unit','saco','unit_price',null))), 'quotes','[]'::jsonb);
  v_result := public.create_payment_request(v_input,null,v_token,v_hash,'edit-delete-test');
  v_id := (v_result->>'id')::uuid;
  select * into v_before from public.payment_requests where id=v_id;
  insert into public.payment_request_files(request_id,path,name,kind,size,mime_type,ready)
    values(v_id,v_id||'/support.pdf','support.pdf','support',100,'application/pdf',true) returning id into v_file;
  v_edit := v_input || '{"title":"Solicitação corrigida","description":"Descrição corrigida","requester_name":"Solicitante corrigido","requester_email":"corrected@example.invalid","status":"paid","source":"whatsapp"}'::jsonb;
  begin
    perform public.manage_payment_request(v_id,null,0,'edit',v_edit);
    raise exception 'Anonymous edit accepted';
  exception when others then if sqlerrm <> 'payment_forbidden' then raise; end if; end;
  begin
    perform public.manage_payment_request(v_id,null,0,'delete','{}');
    raise exception 'Anonymous deletion accepted';
  exception when others then if sqlerrm <> 'payment_forbidden' then raise; end if; end;
  select p.user_id into v_nonmanager from public.profiles p where p.active and p.deleted_at is null and not p.is_admin
    and not exists(select 1 from public.profile_payment_permissions a where a.user_id=p.user_id and a.can_manage) limit 1;
  if v_nonmanager is not null then
    begin
      perform public.manage_payment_request(v_id,v_nonmanager,0,'edit',v_edit);
      raise exception 'Unprivileged user edit accepted';
    exception when others then if sqlerrm <> 'payment_forbidden' then raise; end if; end;
    begin
      perform public.manage_payment_request(v_id,v_nonmanager,0,'delete','{}');
      raise exception 'Unprivileged user deletion accepted';
    exception when others then if sqlerrm <> 'payment_forbidden' then raise; end if; end;
  end if;
  -- Service role RPCs cannot be invoked directly from a browser with a forged actor.
  if has_function_privilege('anon','public.manage_payment_request(uuid,uuid,integer,text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.manage_payment_request(uuid,uuid,integer,text,jsonb)','EXECUTE') then
    raise exception 'Browser can invoke privileged management function';
  end if;
  perform public.manage_payment_request(v_id,v_admin,0,'edit',v_edit);
  select * into v_after from public.payment_requests where id=v_id;
  if v_after.title <> 'Solicitação corrigida' or v_after.requester_email <> 'corrected@example.invalid' or v_after.version<>1
    or v_after.protocol<>v_before.protocol or v_after.status<>v_before.status or v_after.source<>v_before.source
    or v_after.requester_user_id is distinct from v_before.requester_user_id or v_after.created_at<>v_before.created_at
    or not exists(select 1 from public.payment_request_tokens where request_id=v_id and token=v_token)
    or not exists(select 1 from public.payment_request_files where id=v_file and ready) then
    raise exception 'Edit did not preserve protected metadata, token or files';
  end if;
  if not exists(select 1 from public.payment_request_revisions where request_id=v_id and action='edit'
    and before_data->>'title'=v_before.title and after_data->>'title'=v_after.title and not before_data ? 'submission_digest') then
    raise exception 'Audit missing or includes idempotency metadata';
  end if;
  begin
    perform public.manage_payment_request(v_id,v_admin,0,'edit',v_edit);
    raise exception 'Stale edit accepted';
  exception when others then if sqlerrm <> 'payment_conflict' then raise; end if; end;
  begin
    perform public.manage_payment_request(v_id,v_admin,0,'delete','{}');
    raise exception 'Stale delete accepted';
  exception when others then if sqlerrm <> 'payment_conflict' then raise; end if; end;
  begin
    perform public.manage_payment_request(v_id,v_admin,1,'edit',v_edit || '{"company_key":"missing-company"}'::jsonb);
    raise exception 'Invalid company accepted';
  exception when others then if sqlerrm <> 'payment_company_not_found' then raise; end if; end;
  perform public.payment_request_action(v_id,v_admin,null,'status','{"version":1,"status":"reviewing"}');
  perform public.payment_request_action(v_id,v_admin,null,'status','{"version":2,"status":"approved"}');
  perform public.payment_request_action(v_id,v_admin,null,'status','{"version":3,"status":"paid"}');
  perform public.payment_request_action(v_id,v_admin,null,'status','{"version":4,"status":"finalized"}');
  begin
    perform public.manage_payment_request(v_id,v_admin,5,'edit',v_edit || '{"amount":100,"details":{"type":"service"}}'::jsonb);
    raise exception 'Edit bypassed receipt requirement';
  exception when others then if sqlerrm <> 'payment_receipt_required' then raise; end if; end;
  perform public.manage_payment_request(v_id,v_admin,5,'edit',v_edit);
  if not exists(select 1 from public.payment_requests where id=v_id and status='finalized' and finalized_at is not null) then
    raise exception 'Editing final request changed status';
  end if;
  perform public.manage_payment_request(v_id,v_admin,6,'delete','{}');
  if not exists(select 1 from public.payment_requests where id=v_id and deleted_at is not null and deleted_by=v_admin and version=7) then
    raise exception 'Deletion missing';
  end if;
  if (select count(*) from public.payment_request_revisions where request_id=v_id)<>3 then raise exception 'Missing revisions'; end if;
  if (select count(*) from public.payment_email_outbox o join public.payment_request_events e on e.id=o.event_id where o.request_id=v_id and e.kind in ('edited','deleted'))<>3 then
    raise exception 'Missing edit/delete notification';
  end if;
  begin
    perform public.manage_payment_request(v_id,v_admin,7,'edit',v_edit);
    raise exception 'Removed request can be edited';
  exception when others then if sqlerrm <> 'payment_not_found' then raise; end if; end;
  begin
    perform public.payment_request_action(v_id,v_admin,null,'reply','{"version":7,"message":"Replay"}');
    raise exception 'Removed request can be updated';
  exception when others then if sqlerrm <> 'payment_not_found' then raise; end if; end;
  begin
    perform public.complete_payment_file(v_file,v_admin,null);
    raise exception 'Removed request accepts file completion';
  exception when others then if sqlerrm <> 'payment_not_found' then raise; end if; end;
  begin
    perform public.create_payment_request(v_input,null,v_token,v_hash,'edit-delete-test');
    raise exception 'Replayed creation returns removed request';
  exception when others then if sqlerrm <> 'payment_not_found' then raise; end if; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  set local role authenticated;
  if exists(select 1 from public.payment_requests where id=v_id)
    or exists(select 1 from public.payment_request_files where request_id=v_id)
    or exists(select 1 from public.payment_request_events where request_id=v_id) then
    raise exception 'Removed request visible through RLS';
  end if;
  begin
    perform 1 from public.payment_request_revisions;
    raise exception 'Browser can read private revisions';
  exception when insufficient_privilege then null; end;
  reset role;
end;
$$;
rollback;
select 'PASS: manager-only edits/deletion, preserved metadata/files, conflicts, receipt guard, audit, email queue, deleted access and RLS; fixtures rolled back.' as result;
