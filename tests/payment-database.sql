-- Run with an administrative database connection. All test data is rolled back.
begin;
do $$
declare
  v_admin uuid; v_owner uuid; v_other uuid; v_company text; v_input jsonb; v_result jsonb; v_repeat jsonb;
  v_id uuid; v_internal uuid; v_file uuid; v_token text := repeat('a',64); v_hash text := encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex');
  v_count integer; v_events integer; v_status text;
begin
  select user_id into v_admin from public.profiles where active and is_admin and deleted_at is null limit 1;
  select user_id into v_owner from public.profiles where active and not is_admin and deleted_at is null order by user_id limit 1;
  select user_id into v_other from public.profiles where active and not is_admin and deleted_at is null and user_id<>v_owner order by user_id limit 1;
  if v_admin is null or v_owner is null or v_other is null then raise exception 'Test needs an administrator and two active member profiles'; end if;
  delete from public.profile_payment_permissions where user_id in (v_owner,v_other);
  select company_key into v_company from public.enterprise_performance_companies where snapshot_id=(select id from public.enterprise_performance_snapshots order by captured_at desc,id desc limit 1) limit 1;
  v_input := jsonb_build_object('submission_id',gen_random_uuid(),'requester_name','TESTE TRANSACIONAL','requester_email','payment-test@example.invalid','requester_phone','',
    'company_key',v_company,'project_name','','title','TESTE TRANSACIONAL - ROLLBACK','description','Teste isolado, sem envio de e-mail.',
    'amount',100,'budget_max',120,'due_date','2026-09-30','beneficiary',jsonb_build_object('person_type','PF','name','Teste','tax_id','52998224725','method','pix','pix_key','test@example.invalid'),
    'details',jsonb_build_object('type','service','scope','Teste','service_date','2026-09-16','document_type','RPA'),'quotes','[]'::jsonb);
  v_result := public.create_payment_request(v_input,null,v_token,v_hash,'test-digest');
  v_id := (v_result->>'id')::uuid;
  v_repeat := public.create_payment_request(v_input,null,repeat('b',64),'another-hash','test-digest');
  if v_repeat <> v_result then raise exception 'Idempotency did not preserve the original request and token'; end if;
  begin
    perform public.create_payment_request(v_input,null,v_token,v_hash,'different-digest');
    raise exception 'Duplicate submission accepted different data';
  exception when others then if sqlerrm <> 'submission_conflict' then raise; end if; end;
  select count(*) into v_count from public.payment_request_events where request_id=v_id;
  if v_count<>1 then raise exception 'Duplicate creation event'; end if;
  begin
    perform public.payment_request_action(v_id,null,v_hash,'status','{"version":0,"status":"reviewing"}');
    raise exception 'Public requester changed status';
  exception when others then if sqlerrm <> 'payment_forbidden' then raise; end if; end;
  begin
    perform public.payment_request_action(v_id,null,'wrong-hash','reply','{"version":0,"message":"test"}');
    raise exception 'Invalid tracking token accepted';
  exception when others then if sqlerrm <> 'payment_forbidden' then raise; end if; end;
  begin
    perform public.payment_request_action(v_id,v_other,null,'reply','{"version":0,"message":"test"}');
    raise exception 'Unrelated user accessed a public request';
  exception when others then if sqlerrm <> 'payment_forbidden' then raise; end if; end;
  begin
    perform public.payment_request_action(v_id,v_admin,null,'status','{"version":0,"status":"paid"}');
    raise exception 'Approval was skipped';
  exception when others then if sqlerrm <> 'payment_invalid_transition' then raise; end if; end;
  perform public.payment_request_action(v_id,v_admin,null,'status','{"version":0,"status":"reviewing"}');
  begin
    perform public.payment_request_action(v_id,v_admin,null,'status','{"version":0,"status":"approved"}');
    raise exception 'Stale version accepted';
  exception when others then if sqlerrm <> 'payment_conflict' then raise; end if; end;
  perform public.payment_request_action(v_id,v_admin,null,'request_info','{"version":1,"message":"Envie dados adicionais."}');
  perform public.payment_request_action(v_id,null,v_hash,'reply','{"version":2,"message":"Informações complementares."}');
  select status into v_status from public.payment_requests where id=v_id;
  if v_status<>'reviewing' then raise exception 'Requester reply did not return to review'; end if;
  perform public.payment_request_action(v_id,v_admin,null,'status','{"version":3,"status":"approved"}');
  begin
    perform public.payment_request_action(v_id,v_admin,null,'status','{"version":4,"status":"finalized"}');
    raise exception 'Finalized before payment';
  exception when others then if sqlerrm <> 'payment_invalid_transition' then raise; end if; end;
  perform public.payment_request_action(v_id,v_admin,null,'status','{"version":4,"status":"scheduled","scheduled_date":"2026-09-30"}');
  begin
    perform public.payment_request_action(v_id,v_admin,null,'status','{"version":5,"status":"paid"}');
    raise exception 'Paid without receipt';
  exception when others then if sqlerrm <> 'payment_receipt_required' then raise; end if; end;
  insert into public.payment_request_files(request_id,path,name,kind,size,mime_type) values(v_id,v_id||'/receipt-test.pdf','receipt-test.pdf','receipt',100,'application/pdf') returning id into v_file;
  begin
    perform public.complete_payment_file(v_file,null,v_hash);
    raise exception 'Requester registered a receipt';
  exception when others then if sqlerrm <> 'payment_forbidden' then raise; end if; end;
  perform public.complete_payment_file(v_file,v_admin,null);
  perform public.complete_payment_file(v_file,v_admin,null);
  perform public.payment_request_action(v_id,v_admin,null,'status','{"version":5,"status":"paid"}');
  begin
    perform public.payment_request_action(v_id,v_admin,null,'reply','{"version":6,"message":"test"}');
    raise exception 'Closed request was changed';
  exception when others then if sqlerrm <> 'payment_closed' then raise; end if; end;
  begin
    perform public.payment_request_action(v_id,null,v_hash,'status','{"version":6,"status":"finalized"}');
    raise exception 'Requester finalized payment';
  exception when others then if sqlerrm <> 'payment_forbidden' then raise; end if; end;
  begin
    perform public.payment_request_action(v_id,v_admin,null,'status','{"version":5,"status":"finalized"}');
    raise exception 'Stale finalization accepted';
  exception when others then if sqlerrm <> 'payment_conflict' then raise; end if; end;
  update public.payment_request_files set ready=false where id=v_file;
  begin
    perform public.payment_request_action(v_id,v_admin,null,'status','{"version":6,"status":"finalized"}');
    raise exception 'Finalized without confirmed receipt';
  exception when others then if sqlerrm <> 'payment_receipt_required' then raise; end if; end;
  update public.payment_request_files set ready=true where id=v_file;
  update public.payment_requests set paid_at='2026-09-01T12:00:00Z' where id=v_id;
  perform public.payment_request_action(v_id,v_admin,null,'status','{"version":6,"status":"finalized","message":"Conferência concluída."}');
  if not exists(select 1 from public.payment_requests where id=v_id and status='finalized' and finalized_at is not null and paid_at='2026-09-01T12:00:00Z' and version=7) then
    raise exception 'Finalization did not preserve payment or record closure';
  end if;
  begin
    perform public.payment_request_action(v_id,v_admin,null,'status','{"version":7,"status":"reviewing"}');
    raise exception 'Finalized request reopened';
  exception when others then if sqlerrm <> 'payment_closed' then raise; end if; end;
  begin
    perform public.complete_payment_file(v_file,v_admin,null);
    raise exception 'Finalized request accepted an upload';
  exception when others then if sqlerrm <> 'payment_closed' then raise; end if; end;
  if (select count(*) from public.payment_request_events e join public.payment_email_outbox o on o.event_id=e.id where e.request_id=v_id and e.status='finalized' and e.kind='status_changed')<>1 then
    raise exception 'Finalization must enqueue exactly one status notification';
  end if;
  select count(*) into v_events from public.payment_request_events where request_id=v_id;
  select count(*) into v_count from public.payment_email_outbox where request_id=v_id;
  if v_events<>9 or v_count<>v_events then raise exception 'History / outbox mismatch: % events, % emails',v_events,v_count; end if;

  v_input := jsonb_set(v_input,'{submission_id}',to_jsonb(gen_random_uuid()));
  v_result := public.create_payment_request(v_input,v_owner,repeat('c',64),'internal-hash','internal-digest');
  v_internal := (v_result->>'id')::uuid;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.payment_requests where id in (v_id,v_internal);
  if v_count<>1 then raise exception 'Owner read scope incorrect'; end if;
  if public.can_manage_payments() then raise exception 'Member obtained management permission'; end if;
  if has_table_privilege('authenticated','public.payment_request_tokens','select') then raise exception 'Tracking token table exposed'; end if;
  if has_function_privilege('authenticated','public.payment_request_action(uuid,uuid,text,text,jsonb)','execute') then raise exception 'Service mutation RPC exposed'; end if;
  begin
    update public.payment_requests set status='paid' where id=v_internal;
    raise exception 'Direct browser update accepted';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_other,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.payment_requests where id in (v_id,v_internal);
  if v_count<>0 then raise exception 'Other member read requester records'; end if;
  execute 'reset role';
  insert into public.profile_payment_permissions(user_id,can_manage) values(v_other,true);
  execute 'set local role authenticated';
  if not public.can_manage_payments() then raise exception 'Granted manager cannot manage'; end if;
  select count(*) into v_count from public.payment_requests where id in (v_id,v_internal);
  if v_count<>2 then raise exception 'Granted manager cannot read requests'; end if;
  execute 'reset role';
  update public.profile_payment_permissions set can_manage=false where user_id=v_other;
  execute 'set local role authenticated';
  if public.can_manage_payments() then raise exception 'Revoked permission remains active'; end if;
  execute 'reset role';
  if has_table_privilege('anon','public.payment_requests','select') or has_table_privilege('anon','public.payment_request_tokens','select') then raise exception 'Anonymous direct read enabled'; end if;
  select count(*) into v_count from public.claim_payment_emails(20) where request_id in(v_id,v_internal);
  if v_count<>2 then raise exception 'Email claim did not preserve per-request ordering'; end if;
  select count(*) into v_count from public.claim_payment_emails(20) where request_id in(v_id,v_internal);
  if v_count<>0 then raise exception 'Email worker claimed an active lease twice'; end if;
  update public.payment_email_outbox set status='sent' where request_id in(v_id,v_internal) and status='sending';
  select count(*) into v_count from public.claim_payment_emails(20) where request_id in(v_id,v_internal);
  if v_count<>1 then raise exception 'Next notification did not become eligible after predecessor was sent'; end if;
end;
$$;
rollback;
select 'PASS: lifecycle, atomic outbox, idempotency, optimistic concurrency, receipt guard, public token isolation, RLS, grant/revoke and worker leases. Test records rolled back.' as result;
