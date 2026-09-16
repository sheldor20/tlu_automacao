begin;
-- Explicit deny policies document the service-only tables. Service-role clients
-- still bypass RLS; browser roles have neither table privileges nor row access.
create policy payment_tokens_deny_browser on public.payment_request_tokens for all to anon,authenticated using(false) with check(false);
create policy payment_outbox_deny_browser on public.payment_email_outbox for all to anon,authenticated using(false) with check(false);
create policy payment_limits_deny_browser on public.payment_rate_limits for all to anon,authenticated using(false) with check(false);
commit;
