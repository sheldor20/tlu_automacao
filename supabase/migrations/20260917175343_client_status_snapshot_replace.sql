begin;
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('public.publish_client_property_statuses(jsonb,timestamptz)'::regprocedure);
 if strpos(definition,'delete from public.client_property_statuses;')=0 then raise exception 'status_publish_definition_changed'; end if;
 definition:=replace(definition,'delete from public.client_property_statuses;','delete from public.client_property_statuses where source_revision <= p_source_revision;');
 execute definition;
end $$;
notify pgrst,'reload schema';
commit;
