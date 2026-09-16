begin;
alter table public.payment_email_outbox add column sequence bigint generated always as identity;
create unique index payment_outbox_sequence_idx on public.payment_email_outbox(sequence);
create index payment_outbox_request_sequence_idx on public.payment_email_outbox(request_id,sequence) where status<>'sent';
grant usage,select on sequence public.payment_email_outbox_sequence_seq to service_role;
create or replace function public.claim_payment_emails(p_limit integer default 10) returns setof public.payment_email_outbox language sql security invoker set search_path='' as $$
  with candidates as (
    select o.id from public.payment_email_outbox o
    where o.attempts < 12 and ((o.status in ('pending','failed') and o.available_at <= now()) or (o.status='sending' and o.locked_until < now()))
      and not exists(select 1 from public.payment_email_outbox earlier where earlier.request_id=o.request_id and earlier.sequence<o.sequence and earlier.status<>'sent')
    order by o.sequence for update of o skip locked limit least(greatest(p_limit,1),20)
  ) update public.payment_email_outbox o set status='sending',attempts=attempts+1,locked_until=now()+interval '10 minutes',lease_id=gen_random_uuid()
    from candidates c where o.id=c.id returning o.*;
$$;
commit;
