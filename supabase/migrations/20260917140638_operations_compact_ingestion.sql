begin;
-- The financial entry is already materialized inactive; the publication audit
-- only needs its identity, source kind and amount, not a second complete copy.
do $migration$ declare def text; begin
 def:=pg_get_functiondef('public.stage_operational_entries(uuid,jsonb)'::regprocedure);
 def:=replace(def,'end $function$', $replacement$
 insert into public.operational_import_rows(run_id,entity,id,data)
 select p_run,'entries',r->>'id',jsonb_build_object('kind',r->'data'->'kind','amount',r->'data'->'amount')
 from jsonb_array_elements(p_rows) r where r->>'entity'='entries'
 on conflict(run_id,entity,id) do update set data=excluded.data
 where public.operational_import_rows.data is distinct from excluded.data;
end $function$$replacement$);
 if strpos(def,'jsonb_build_object(''kind''')=0 then raise exception 'stage_definition_changed'; end if;
 execute def;
 def:=pg_get_functiondef('public.begin_operational_import(text)'::regprocedure);
 def:=replace(def,'''10 minutes''','''20 minutes''');
 def:=replace(def,'status <> ''running'' AND started_at < (now() - ''2 days''::interval)','(status = ''error'' or (status = ''success'' AND started_at < (now() - ''2 days''::interval)))');
 -- pg_get_functiondef retains PL/pgSQL body formatting.
 def:=replace(def,'status<>''running'' and started_at<now()-interval ''2 days''','(status=''error'' or (status=''success'' and started_at<now()-interval ''2 days''))');
 execute def;
end $migration$;
alter function public.begin_operational_import(text) set statement_timeout='55s';
notify pgrst,'reload schema';
commit;
