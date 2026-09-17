begin;
-- Reconciliation must inspect the complete import. A full aggregate avoids an
-- optimistic early-exit plan that randomly reads both large indexes.
do $migration$ declare def text; old_sql text; new_sql text; begin
 def:=pg_get_functiondef('public.publish_operational_import(uuid,integer,numeric)'::regprocedure);
 old_sql:='if exists(select 1 from public.operational_import_rows s left join public.operational_cash_entries e on e.id=s.id where s.run_id=p_run and s.entity=''entries'' and (e.id is null or e.amount<>(s.data->>''amount'')::numeric)) then raise exception ''import_page_missing''; end if;';
 new_sql:='if (select count(*) from public.operational_import_rows s left join public.operational_cash_entries e on e.id=s.id where s.run_id=p_run and s.entity=''entries'' and (e.id is null or e.amount<>(s.data->>''amount'')::numeric))>0 then raise exception ''import_page_missing''; end if;';
 if strpos(def,old_sql)=0 then raise exception 'publish_definition_changed'; end if;
 execute replace(def,old_sql,new_sql);
end $migration$;
-- Reading the checkpoint can exceed the ordinary API limit on a full history.
alter function public.operational_import_progress(uuid) set statement_timeout='55s';
notify pgrst,'reload schema';
commit;
