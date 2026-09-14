-- The sync RPC is called only by authenticated server routes using service_role.
revoke execute on function public.sync_data_connection_indicators(text, text, jsonb, text, text[], date) from public, anon, authenticated;
grant execute on function public.sync_data_connection_indicators(text, text, jsonb, text, text[], date) to service_role;
