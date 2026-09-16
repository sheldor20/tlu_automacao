import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { parseRentalInventory, rentalInventoryMapping, RENTAL_INVENTORY_CONNECTION, RENTAL_INVENTORY_URL } from "./qlik-rental-inventory";

export async function syncRentalInventory() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Conexão de imóveis não configurada." }, { status: 503 });
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: connection, error } = await db.from("data_connections").select("active,settings").eq("slug", RENTAL_INVENTORY_CONNECTION).single();
  if (error) return NextResponse.json({ error: "Configuração da carteira indisponível." }, { status: 503 });
  // No external access until the actual source columns and legacy links are validated.
  if (!connection.active) return NextResponse.json({ ok: false, paused: true, reason: "Aguardando validação da fonte de imóveis do Qlik." });
  let mapping;
  try { mapping = rentalInventoryMapping(connection.settings); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Mapeamento pendente." }, { status: 409 }); }
  const username = process.env.QLIK_USERNAME, password = process.env.QLIK_PASSWORD;
  if (!username || !password) return NextResponse.json({ error: "Credenciais do Qlik indisponíveis no servidor." }, { status: 503 });
  const started = new Date().toISOString();
  const { data: run, error: runError } = await db.from("data_connection_runs").insert({ connection_slug: RENTAL_INVENTORY_CONNECTION, status: "running", trigger_source: "cron" }).select("id").single();
  if (runError) return NextResponse.json({ error: "Não foi possível iniciar a atualização dos imóveis." }, { status: 503 });
  await db.from("data_connections").update({ last_run_at: started }).eq("slug", RENTAL_INVENTORY_CONNECTION);
  try {
    const { scrapeQlikCloudTable } = await import("./qlik-cloud");
    const snapshot = await scrapeQlikCloudTable({ username, password, sheetUrl: RENTAL_INVENTORY_URL, objectId: mapping.object_id, filters: [] });
    const rows = parseRentalInventory(snapshot, mapping);
    const { data: result, error: syncError } = await db.rpc("sync_qlik_rental_inventory", { p_rows: rows, p_started_at: started });
    if (syncError) throw new Error(syncError.message);
    const finished = new Date().toISOString();
    const { error: auditError } = await db.from("data_connection_runs").update({ status: "success", rows_read: snapshot.rows.length, rows_written: rows.length, finished_at: finished, details: result }).eq("id", run.id);
    if (auditError) throw new Error("Os imóveis foram atualizados, mas o registro da execução falhou.");
    return NextResponse.json({ ok: true, ...result, synchronized_at: finished });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1500) : "Falha na sincronização de imóveis.";
    const finished = new Date().toISOString();
    await Promise.all([
      db.from("data_connection_runs").update({ status: "error", finished_at: finished, error_message: message }).eq("id", run.id),
      db.from("data_connections").update({ last_error: message, last_error_at: finished }).eq("slug", RENTAL_INVENTORY_CONNECTION),
    ]);
    return NextResponse.json({ error: "A atualização dos imóveis não foi concluída. Consulte o histórico da conexão." }, { status: 502 });
  }
}
