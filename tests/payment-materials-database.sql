-- All fixtures and notifications are rolled back; no email is dispatched.
begin;
do $$
declare
  v_admin uuid; v_company text; v_type text; v_input jsonb; v_result jsonb; v_id uuid; v_file uuid;
begin
  select user_id into v_admin from public.profiles where active and is_admin and deleted_at is null limit 1;
  if v_admin is null then raise exception 'Test needs an active administrator'; end if;
  select company_key into v_company from public.enterprise_performance_companies where snapshot_id=(select id from public.enterprise_performance_snapshots order by captured_at desc,id desc limit 1) limit 1;
  foreach v_type in array array['materials','bills','service','termination'] loop
    v_input := jsonb_build_object('submission_id',gen_random_uuid(),'requester_name','TESTE TRANSACIONAL','requester_email','payment-test@example.invalid','requester_phone','',
      'company_key',v_company,'project_name','','title','TESTE TRANSACIONAL - ROLLBACK','description','Validação por tipo, sem envio de e-mail.',
      'amount',case when v_type='materials' then null else 100 end,'budget_max',120,'due_date',current_date,
      'beneficiary',case when v_type='materials' then '{}'::jsonb else jsonb_build_object('person_type','PF','name','Teste','tax_id','52998224725','method','pix','pix_key','test@example.invalid') end,
      'details',case v_type
        when 'materials' then jsonb_build_object('type',v_type,'delivery_address','Almoxarifado','items',jsonb_build_array(jsonb_build_object('description','Cimento','quantity',2,'unit','saco','unit_price',null)))
        when 'bills' then jsonb_build_object('type',v_type,'issuer','Fornecedor','document_type','Boleto','reference','Teste')
        when 'service' then jsonb_build_object('type',v_type,'scope','Serviço de teste','service_date',current_date,'document_type','RPA')
        else jsonb_build_object('type',v_type,'cancellation_date',current_date,'reason','Teste','customer_name','Cliente','contract','','construction_delay',false,'iptu_responsibility','company','restitution',100,'iptu',0,'legal_fees',0,'court_costs',0,'damages',0,'document_type','Distrato') end,
      'quotes','[]'::jsonb);
    if v_type<>'materials' then
      begin
        perform public.create_payment_request(jsonb_set(v_input,'{amount}','null'::jsonb),v_admin,gen_random_uuid()::text,gen_random_uuid()::text,'missing-amount');
        raise exception 'Non-material request accepted a missing amount';
      exception when check_violation then null; end;
    end if;
    v_result := public.create_payment_request(v_input,v_admin,gen_random_uuid()::text,gen_random_uuid()::text,'type-matrix');
    v_id := (v_result->>'id')::uuid;
    if v_type='materials' and not exists(select 1 from public.payment_requests where id=v_id and amount is null and beneficiary='{}'::jsonb) then
      raise exception 'Missing material price or beneficiary was not preserved';
    end if;
    perform public.payment_request_action(v_id,v_admin,null,'status','{"version":0,"status":"reviewing"}');
    perform public.payment_request_action(v_id,v_admin,null,'status','{"version":1,"status":"approved"}');
    if v_type in ('service','termination') then
      begin
        perform public.payment_request_action(v_id,v_admin,null,'status','{"version":2,"status":"paid"}');
        raise exception 'Receipt guard was removed for %',v_type;
      exception when others then if sqlerrm <> 'payment_receipt_required' then raise; end if; end;
      insert into public.payment_request_files(request_id,path,name,kind,size,mime_type,ready)
        values(v_id,v_id||'/receipt.pdf','receipt.pdf','receipt',100,'application/pdf',true) returning id into v_file;
    end if;
    perform public.payment_request_action(v_id,v_admin,null,'status','{"version":2,"status":"paid"}');
    if v_type in ('service','termination') then
      update public.payment_request_files set ready=false where id=v_file;
      begin
        perform public.payment_request_action(v_id,v_admin,null,'status','{"version":3,"status":"finalized"}');
        raise exception 'Finalization receipt guard was removed for %',v_type;
      exception when others then if sqlerrm <> 'payment_receipt_required' then raise; end if; end;
      update public.payment_request_files set ready=true where id=v_file;
    end if;
    perform public.payment_request_action(v_id,v_admin,null,'status','{"version":3,"status":"finalized"}');
    if not exists(select 1 from public.payment_requests where id=v_id and status='finalized' and paid_at is not null and finalized_at is not null) then
      raise exception 'Payment type % did not finalize',v_type;
    end if;
    if (select count(*) from public.payment_email_outbox o join public.payment_request_events e on e.id=o.event_id where o.request_id=v_id and e.status='finalized')<>1 then
      raise exception 'Finalization email missing for %',v_type;
    end if;
  end loop;
end;
$$;
rollback;
select 'PASS: optional material amount/beneficiary, positive amounts for other types, receipt matrix and finalization notifications; fixtures rolled back.' as result;
