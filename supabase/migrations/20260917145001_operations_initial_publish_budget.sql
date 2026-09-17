-- Initial activation of the complete receipt history needs more time than
-- ordinary queries. Subsequent imports only activate changed entries.
alter function public.publish_operational_import(uuid,integer,numeric) set statement_timeout='180s';
notify pgrst,'reload schema';
