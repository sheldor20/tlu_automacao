begin;

-- Missing material prices are unknown, not zero. Other request types retain a positive amount.
alter table public.payment_requests alter column amount drop not null;
alter table public.payment_requests drop constraint payment_requests_amount_check;
alter table public.payment_requests add constraint payment_requests_amount_check check (
  (type='materials' and (amount is null or (amount >= 0 and amount <= 999999999.99)))
  or (type<>'materials' and amount is not null and amount > 0 and amount <= 999999999.99)
);

-- Receipt requirements apply only to services and contract terminations.
create or replace function public.payment_request_action(p_id uuid,p_actor uuid,p_token_hash text,p_action text,p_payload jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare r public.payment_requests%rowtype; v_manager boolean := false; v_name text; v_status text; v_kind text; v_message text;
begin
  select * into r from public.payment_requests where id=p_id for update;
  if not found then raise exception 'payment_not_found'; end if;
  if p_actor is not null then
    select p.full_name,(p.is_admin or coalesce(a.can_manage,false)) into v_name,v_manager from public.profiles p
      left join public.profile_payment_permissions a on a.user_id=p.user_id where p.user_id=p_actor and p.active and p.deleted_at is null;
    if not found or (not v_manager and r.requester_user_id is distinct from p_actor) then raise exception 'payment_forbidden'; end if;
  else
    if not exists(select 1 from public.payment_request_tokens where request_id=p_id and token_hash=p_token_hash) then raise exception 'payment_forbidden'; end if;
    v_name := r.requester_name;
  end if;
  if (p_payload->>'version')::integer is distinct from r.version then raise exception 'payment_conflict'; end if;
  if r.status in ('finalized','rejected','cancelled') or (r.status='paid' and (p_action is distinct from 'status' or p_payload->>'status' is distinct from 'finalized')) then raise exception 'payment_closed'; end if;
  v_message := btrim(coalesce(p_payload->>'message',''));
  v_status := r.status;
  if p_action='reply' then
    if length(v_message) not between 1 and 5000 then raise exception 'payment_message_required'; end if;
    v_kind := 'reply';
    if r.status='awaiting_information' and not v_manager then v_status := 'reviewing'; end if;
  elsif p_action in ('request_info','status') then
    if not v_manager then raise exception 'payment_forbidden'; end if;
    v_status := case when p_action='request_info' then 'awaiting_information' else p_payload->>'status' end;
    if not coalesce(case r.status
      when 'submitted' then v_status in ('reviewing','awaiting_information','rejected','cancelled')
      when 'reviewing' then v_status in ('awaiting_information','approved','rejected','cancelled')
      when 'awaiting_information' then v_status in ('reviewing','rejected','cancelled')
      when 'approved' then v_status in ('scheduled','paid','awaiting_information','cancelled')
      when 'scheduled' then v_status in ('paid','awaiting_information','cancelled')
      when 'paid' then v_status='finalized' else false end,false) then raise exception 'payment_invalid_transition'; end if;
    if v_status in ('awaiting_information','rejected','cancelled') and length(v_message)=0 then raise exception 'payment_message_required'; end if;
    if v_status='scheduled' and nullif(p_payload->>'scheduled_date','') is null then raise exception 'payment_schedule_required'; end if;
    if v_status in ('paid','finalized') and r.type in ('service','termination') and not exists(select 1 from public.payment_request_files where request_id=p_id and kind='receipt' and ready) then raise exception 'payment_receipt_required'; end if;
    v_kind := case when v_status='awaiting_information' then 'information_requested' else 'status_changed' end;
  else raise exception 'payment_invalid_action'; end if;
  update public.payment_requests set status=v_status,version=version+1,updated_at=now(),
    scheduled_date=case when v_status='scheduled' then (p_payload->>'scheduled_date')::date else scheduled_date end,
    paid_at=case when v_status='paid' then now() else paid_at end,
    finalized_at=case when v_status='finalized' then now() else finalized_at end where id=p_id;
  insert into public.payment_request_events(request_id,kind,status,message,actor_id,actor_name) values(p_id,v_kind,v_status,v_message,p_actor,coalesce(v_name,'Usuário'));
end;
$$;

revoke all on function public.payment_request_action(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.payment_request_action(uuid,uuid,text,text,jsonb) to service_role;

commit;
