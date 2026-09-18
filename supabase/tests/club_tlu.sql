-- Run as postgres. Synthetic fixtures only; every fixture is rolled back.
-- No invitation emails or real-account modifications.
begin;
create temp table club_test_results(label text primary key);
create function pg_temp.assert_club(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAILED: %',label; end if;
 insert into club_test_results values(label); end; $$;
create function pg_temp.club_throws(statement text,expected text,label text) returns void language plpgsql as $$
declare actual text;
begin
 begin execute statement; exception when others then actual:=sqlerrm; end;
 if actual is distinct from expected then raise exception 'FAILED: %, expected %, got %',label,expected,actual; end if;
 insert into club_test_results values(label);
end; $$;
do $$
declare
 manager uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); partner_user uuid:=gen_random_uuid(); other_partner uuid:=gen_random_uuid();
 client_user uuid:=gen_random_uuid(); alias_user uuid:=gen_random_uuid(); client_two uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid();
 p1 uuid; p2 uuid; o1 uuid; o2 uuid; m1 uuid; request_key uuid:=gen_random_uuid(); c1 text:='club-test-'||gen_random_uuid(); c2 text:='club-test-'||gen_random_uuid();
 payload jsonb; response jsonb; voucher jsonb; second jsonb; workspace jsonb; code text; i integer;
begin
 perform pg_temp.assert_club(not has_function_privilege('authenticated','public.club_command(uuid,text,jsonb)','execute'),'RPC rejects browser role');
 perform pg_temp.assert_club(not has_function_privilege('anon','public.club_workspace(uuid,text,integer,text,text,uuid)','execute'),'Workspace rejects anonymous role');
 perform pg_temp.assert_club(not has_function_privilege('authenticated','club_private.actor(uuid)','execute'),'Private identity lookup inaccessible');
 perform pg_temp.assert_club(not has_column_privilege('authenticated','public.profiles','is_admin','UPDATE'),'Profile admin flag cannot be self-edited');
 perform pg_temp.assert_club(not has_column_privilege('authenticated','public.profiles','active','UPDATE'),'Profile cannot be self-reactivated');
 insert into public.client_accounts(id,name) values(c1,'CLUB TEST Customer One'),(c2,'CLUB TEST Customer Two');
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at,aud,role)
 values(manager,manager||'@example.invalid',now(),now(),now(),'authenticated','authenticated'),
       (viewer,viewer||'@example.invalid',now(),now(),now(),'authenticated','authenticated'),
       (stranger,stranger||'@example.invalid',now(),now(),now(),'authenticated','authenticated');
 update public.profiles set is_admin=true where user_id=manager;
 insert into public.profile_departments(user_id,department_slug,access_level) values(viewer,'clientes','viewer');
 perform pg_temp.assert_club(public.club_context(manager)->>'role'='manager','Admin role identified');
 perform pg_temp.assert_club(public.club_context(viewer)->>'role'='viewer','Viewer role retained');
 perform pg_temp.club_throws(format('select public.club_context(%L)',stranger),'club_forbidden','Unapproved account denied');
 response:=public.club_command(manager,'partner','{"name":"CLUB TEST One","category":"Geral","city":"Teste","contact_email":"","contact_phone":"","active":true}'); p1:=(response->>'id')::uuid;
 response:=public.club_command(manager,'partner','{"name":"CLUB TEST Two","category":"Geral","city":"Teste","contact_email":"","contact_phone":"","active":true}'); p2:=(response->>'id')::uuid;
 perform public.club_command(manager,'member',jsonb_build_object('email',partner_user||'@example.invalid','kind','partner','partner_id',p1,'client_id',null));
 perform public.club_command(manager,'member',jsonb_build_object('email',other_partner||'@example.invalid','kind','partner','partner_id',p2,'client_id',null));
 response:=public.club_command(manager,'member',jsonb_build_object('email',client_user||'@example.invalid','kind','client','client_id',c1,'partner_id',null)); m1:=(response->>'id')::uuid;
 perform public.club_command(manager,'member',jsonb_build_object('email',alias_user||'@example.invalid','kind','client','client_id',c1,'partner_id',null));
 perform public.club_command(manager,'member',jsonb_build_object('email',client_two||'@example.invalid','kind','client','client_id',c2,'partner_id',null));
 insert into auth.users(id,email,email_confirmed_at,created_at,updated_at,aud,role)
 select id,id||'@example.invalid',now(),now(),now(),'authenticated','authenticated' from unnest(array[partner_user,other_partner,client_user,alias_user,client_two]) id;
 perform pg_temp.assert_club((select bool_and(not active and not is_admin) from public.profiles where user_id=any(array[partner_user,other_partner,client_user,alias_user,client_two])),'New external profiles inactive and non-admin');
 perform pg_temp.assert_club(public.club_context(partner_user)->>'role'='partner','Approved partner can enter club');
 perform pg_temp.assert_club(public.club_context(client_user)->>'client_id'=c1,'Client linked to authoritative account');
 perform pg_temp.club_throws(format('select public.club_workspace(%L,''members'')',partner_user),'club_forbidden','Partner cannot enumerate membership emails');
 perform pg_temp.club_throws(format('select public.club_workspace(%L,''clients'')',client_user),'club_forbidden','Client cannot search the internal client base');
 perform pg_temp.club_throws(format('select public.club_command(%L,''partner'',''{}'')',viewer),'club_forbidden','Viewer cannot mutate partner');
 payload:=jsonb_build_object('partner_id',p1,'title','CLUB TEST Discount','benefit','20% de desconto','description','Oferta de teste',
  'rules','Apresente o cupom antes do pagamento.','status','active','starts_at',now()-interval '1 hour','ends_at',now()+interval '10 days',
  'redemption_days',2,'max_issues',2,'per_client_limit',1);
 response:=public.club_command(partner_user,'offer',payload); o1:=(response->>'id')::uuid;
 perform pg_temp.assert_club(o1 is not null,'Partner creates own offer');
 perform pg_temp.club_throws(format('select public.club_command(%L,''offer'',%L::jsonb)',other_partner,payload),'club_forbidden','Other partner cannot create under foreign owner');
 perform pg_temp.club_throws(format('select public.club_command(%L,''offer'',%L::jsonb)',viewer,payload),'club_forbidden','Viewer cannot create discounts');
 response:=public.club_command(partner_user,'offer',payload||jsonb_build_object('status','draft')); o2:=(response->>'id')::uuid;
 workspace:=public.club_workspace(client_user);
 perform pg_temp.assert_club(not exists(select 1 from jsonb_array_elements(workspace->'items') item where item->>'id'=o2::text),'Draft hidden from client catalog');
 perform pg_temp.assert_club(public.club_workspace(other_partner)->>'total'='0','Partner cannot see foreign offers');
 voucher:=public.club_command(client_user,'claim',jsonb_build_object('offer_id',o1,'request_id',request_key)); code:=voucher->>'code';
 perform pg_temp.assert_club(code~'^TLU[0-9A-F]{20}$','Cryptographic code shape');
 perform pg_temp.assert_club((voucher->>'expires_at')::timestamptz=now()+interval '2 days','Relative voucher expiry');
 response:=public.club_command(client_user,'claim',jsonb_build_object('offer_id',o1,'request_id',request_key));
 perform pg_temp.assert_club(response->>'id'=voucher->>'id','Idempotent withdrawal retry');
 perform pg_temp.club_throws(format('select public.club_command(%L,''claim'',%L::jsonb)',client_user,jsonb_build_object('offer_id',o2,'request_id',request_key)),'club_request_conflict','Idempotency cannot be reused for another offer');
 perform pg_temp.club_throws(format('select public.club_command(%L,''claim'',%L::jsonb)',alias_user,jsonb_build_object('offer_id',o1,'request_id',gen_random_uuid())),'club_client_limit','Per-client quota shared by all client logins');
 perform pg_temp.club_throws(format('select public.club_command(%L,''claim'',%L::jsonb)',partner_user,jsonb_build_object('offer_id',o1,'request_id',gen_random_uuid())),'club_forbidden','Partner cannot manufacture withdrawals');
 second:=public.club_command(client_two,'claim',jsonb_build_object('offer_id',o1,'request_id',gen_random_uuid()));
 perform pg_temp.assert_club(second->>'code'<>code,'Distinct withdrawals have distinct codes');
 perform pg_temp.club_throws(format('select public.club_command(%L,''claim'',%L::jsonb)',client_user,jsonb_build_object('offer_id',o1,'request_id',gen_random_uuid())),'club_sold_out','Capacity stops further withdrawals');
 perform pg_temp.club_throws(format('select public.club_command(%L,''offer'',%L::jsonb)',partner_user,payload||jsonb_build_object('id',o1,'version',1,'max_issues',1)),'club_limit_below_issued','Capacity cannot be reduced below withdrawn count');
 response:=public.club_command(partner_user,'offer',payload||jsonb_build_object('id',o1,'version',1,'rules','Novas regras apenas para cupons futuros.','status','paused'));
 perform pg_temp.assert_club(response->>'version'='2','Offer uses optimistic version');
 perform pg_temp.club_throws(format('select public.club_command(%L,''offer'',%L::jsonb)',partner_user,payload||jsonb_build_object('id',o1,'version',1)),'club_conflict','Stale editor cannot overwrite newer rules');
 perform pg_temp.assert_club((select snapshot->>'rules' from public.club_vouchers where id=(voucher->>'id')::uuid)=payload->>'rules','Issued rules immutable after offer edit');
 perform pg_temp.club_throws(format('select public.club_command(%L,''claim'',%L::jsonb)',client_two,jsonb_build_object('offer_id',o1,'request_id',gen_random_uuid())),'club_unavailable','Paused discount blocks new withdrawals');
 perform pg_temp.club_throws(format('select public.club_command(%L,''check'',%L::jsonb)',other_partner,jsonb_build_object('code',code)),'club_not_found','Foreign partner cannot look up code');
 perform pg_temp.club_throws(format('select public.club_command(%L,''redeem'',%L::jsonb)',client_user,jsonb_build_object('code',code)),'club_forbidden','Client cannot confirm own redemption');
 response:=public.club_command(partner_user,'check',jsonb_build_object('code',lower('TLU-'||substr(code,4))));
 perform pg_temp.assert_club(response->>'state'='available','Code validation accepts separators and casing');
 perform pg_temp.assert_club(not response?'client_id' and not response?'code','Validation does not reveal customer data');
 workspace:=public.club_workspace(partner_user,'vouchers');
 perform pg_temp.assert_club(not exists(select 1 from jsonb_array_elements(workspace->'items') item where item->>'code' is not null or item?'client_id'),'Partner ledger does not expose unused bearer codes or customer IDs');
 perform pg_temp.assert_club(public.club_workspace(client_user,'vouchers')->>'total'='1','Client sees only their vouchers');
 response:=public.club_command(partner_user,'redeem',jsonb_build_object('code',code));
 perform pg_temp.assert_club(response->>'state'='used','Previously issued coupon redeemable after pause');
 perform pg_temp.club_throws(format('select public.club_command(%L,''redeem'',%L::jsonb)',partner_user,jsonb_build_object('code',code)),'club_already_used','Second redemption is rejected');
 update public.club_vouchers set issued_at=now()-interval '3 days',expires_at=now()-interval '1 day' where id=(second->>'id')::uuid;
 perform pg_temp.club_throws(format('select public.club_command(%L,''redeem'',%L::jsonb)',partner_user,jsonb_build_object('code',second->>'code')),'club_expired','Expired coupon cannot be redeemed');
 update public.club_vouchers set issued_at=now()-interval '3 days',expires_at=now()-interval '1 day' where id=(voucher->>'id')::uuid;
 workspace:=public.club_workspace(partner_user,'vouchers');
 perform pg_temp.assert_club(workspace->'stats'='{"issued":2,"used":1,"available":0,"expired":1}'::jsonb,'Used coupons stay used after validity; counters reconcile');
 perform pg_temp.assert_club((select count(*) from public.club_events where action='claim' and entity_id in ((voucher->>'id')::uuid,(second->>'id')::uuid))=2,'One audit entry per actual withdrawal');
 perform pg_temp.assert_club((select count(*) from public.club_events where action='redeem' and entity_id=(voucher->>'id')::uuid)=1,'One audit entry per actual redemption');
 for i in 1..30 loop perform public.club_rate_limit(partner_user,'check'); end loop;
 perform pg_temp.assert_club(not public.club_rate_limit(partner_user,'check'),'Validation attempt throttling');
 perform public.club_command(manager,'member',jsonb_build_object('id',m1,'active',false));
 perform pg_temp.club_throws(format('select public.club_context(%L)',client_user),'club_forbidden','Deactivation invalidates ongoing club access');
 update public.club_partners set active=false where id=p1;
 perform pg_temp.club_throws(format('select public.club_context(%L)',partner_user),'club_forbidden','Deactivated partner loses access');
 perform set_config('club.test_manager',manager::text,true);
 perform set_config('club.test_external',client_two::text,true);
end; $$;
-- Exercise the actual API role and the real browser RLS policies.
set local role service_role;
select public.club_context(current_setting('club.test_manager')::uuid)->>'role' as expected_manager;
reset role;
select set_config('request.jwt.claim.sub',current_setting('club.test_external'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('club.test_external'),'role','authenticated')::text,true);
set local role authenticated;
select set_config('club.test_visible_profiles',(select count(*)::text from public.profiles),true);
reset role;
select pg_temp.assert_club(current_setting('club.test_visible_profiles')='1','External account cannot enumerate employee profiles');
select count(*) as passed_assertions from club_test_results;
rollback;
