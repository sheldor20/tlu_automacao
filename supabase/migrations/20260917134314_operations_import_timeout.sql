alter function public.publish_operational_import(uuid,integer,numeric) set statement_timeout='55s';
notify pgrst,'reload schema';
