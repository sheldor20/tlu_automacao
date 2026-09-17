begin;
set local statement_timeout='120s';
-- Qlik rolls late titles onto today's financial date. Keep their actual due
-- date for collection and exclude them from today's expected receipts.
update public.operational_cash_entries
set cash_date=original_due_date
where kind='receivable' and original_due_date<(now() at time zone 'America/Sao_Paulo')::date
 and cash_date=(now() at time zone 'America/Sao_Paulo')::date;
analyze public.operational_cash_entries;
commit;
