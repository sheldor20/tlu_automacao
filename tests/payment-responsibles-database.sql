begin;
do $$
declare
 admin_id uuid:='11111111-1111-4111-8111-111111111111';
 owner_id uuid:='22222222-2222-4222-8222-222222222222';
 responsible_id uuid:='33333333-3333-4333-8333-333333333333';
 input jsonb; first_id uuid; second_id uuid; result jsonb; amount_seen integer;
begin
 input:=jsonb_build_object('submission_id',gen_random_uuid(),'requester_name','Owner','requester_email','owner@example.test','requester_phone','',
 'company_key','TEST','project_name','','title','Assigned payment','description','Responsibility test','amount',null,'budget_max',120,
 'due_date',current_date,'beneficiary','{}'::jsonb,'details',jsonb_build_object('type','materials','delivery_address','Obra','items','[]'::jsonb),'quotes','[]'::jsonb);
 result:=public.create_payment_request(input,owner_id,repeat('b',64),repeat('c',64),'responsibles-test'); first_id:=(result->>'id')::uuid;
 input:=input||jsonb_build_object('submission_id',gen_random_uuid());
 result:=public.create_payment_request(input,owner_id,repeat('d',64),repeat('e',64),'responsibles-test-2'); second_id:=(result->>'id')::uuid;
 begin
 perform public.assign_payment_responsible(first_id,responsible_id,responsible_id,false,0);
 raise exception 'Self assignment accepted';
 exception when others then if sqlerrm <> 'payment_forbidden' then raise; end if; end;
 perform public.assign_payment_responsible(first_id,admin_id,responsible_id,false,0);
 if not public.is_payment_responsible(first_id,responsible_id) then raise exception 'Assignment missing'; end if;
 perform public.payment_request_action(first_id,responsible_id,null,'status','{"version":1,"status":"reviewing"}');
 insert into public.payment_request_files(id,request_id,path,name,kind,size,mime_type) values('44444444-4444-4444-8444-444444444444',first_id,first_id||'/receipt.pdf','receipt.pdf','receipt',100,'application/pdf');
 perform public.complete_payment_file('44444444-4444-4444-8444-444444444444',responsible_id,null);
 if not exists(select 1 from public.payment_request_files where request_id=first_id and ready) then raise exception 'Responsible receipt failed'; end if;
 perform public.manage_payment_request(first_id,responsible_id,2,'edit',input||'{"title":"Handled by responsible"}'::jsonb);
 begin
 perform public.manage_payment_request(first_id,responsible_id,3,'delete','{}');
 raise exception 'Responsible deletion accepted';
 exception when others then if sqlerrm <> 'payment_forbidden' then raise; end if; end;
 begin
 perform public.payment_request_action(second_id,responsible_id,null,'status','{"version":0,"status":"reviewing"}');
 raise exception 'Unrelated payment action accepted';
 exception when others then if sqlerrm <> 'payment_forbidden' then raise; end if; end;
 begin
 perform public.assign_payment_responsible(second_id,responsible_id,responsible_id,false,0);
 raise exception 'Responsible can delegate';
 exception when others then if sqlerrm <> 'payment_forbidden' then raise; end if; end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',responsible_id,'role','authenticated')::text,true);
 set local role authenticated;
 select count(*) into amount_seen from public.payment_requests;
 if amount_seen<>1 or not exists(select 1 from public.payment_requests where id=first_id) then raise exception 'RLS leaked unrelated payments'; end if;
 if not exists(select 1 from public.payment_request_events where request_id=first_id) then raise exception 'Responsible cannot read history'; end if;
 begin
 insert into public.payment_request_responsibles(request_id,user_id) values(second_id,responsible_id);
 raise exception 'Browser assignment accepted';
 exception when insufficient_privilege then null; end;
 reset role;
 update public.profiles set active=false where user_id=responsible_id;
 if public.is_payment_responsible(first_id,responsible_id) then raise exception 'Inactive responsible retained access'; end if;
 update public.profiles set active=true where user_id=responsible_id;
 perform public.assign_payment_responsible(first_id,admin_id,responsible_id,true,3);
 begin
 perform public.payment_request_action(first_id,responsible_id,null,'status','{"version":4,"status":"approved"}');
 raise exception 'Removed responsible retained access';
 exception when others then if sqlerrm <> 'payment_forbidden' then raise; end if; end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',responsible_id,'role','authenticated')::text,true);
 set local role authenticated;
 if exists(select 1 from public.payment_requests) then raise exception 'Removed responsible retained RLS access'; end if;
 reset role;
end $$;
rollback;
