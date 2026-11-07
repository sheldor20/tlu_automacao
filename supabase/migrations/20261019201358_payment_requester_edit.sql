create or replace function public.manage_payment_request(p_id uuid,p_actor uuid,p_version integer,p_action text,p_data jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare
  r public.payment_requests%rowtype;
  v_after public.payment_requests%rowtype;
  v_manager boolean; v_name text; v_company text; v_snapshot uuid; v_type text;
begin
  select p.full_name,(p.is_admin or coalesce(a.can_manage,false)) into v_name,v_manager from public.profiles p
    left join public.profile_payment_permissions a on a.user_id=p.user_id
    where p.user_id=p_actor and p.active and p.deleted_at is null;
  if not found then raise exception 'payment_forbidden'; end if;
  select * into r from public.payment_requests where id=p_id for update;
  if not found or r.deleted_at is not null then raise exception 'payment_not_found'; end if;
  if not v_manager and (p_action <> 'edit' or r.requester_user_id is distinct from p_actor) then
    raise exception 'payment_forbidden';
  end if;
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
      case when p_action='delete' then 'Solicitação excluída pela gestão de pagamentos.' else case when v_manager then 'Dados da solicitação atualizados pela gestão de pagamentos.'
        else 'Dados da solicitação atualizados pelo solicitante.' end end,
      p_actor,coalesce(v_name,'Gestão de pagamentos'));
end;
$$;
revoke all on function public.manage_payment_request(uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_payment_request(uuid,uuid,integer,text,jsonb) to service_role;
