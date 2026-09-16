import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { parseRentalReceiptSnapshots, rentalReceiptApps, RENTAL_RECEIPTS_CONNECTION } from "./qlik-rental-receipts";

export async function syncRentalQlikReceipts() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Conexão de recebimentos indisponível." }, { status: 503 });
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: connection, error } = await db.from("data_connections").select("active,settings").eq("slug", RENTAL_RECEIPTS_CONNECTION).single();
  if (error) return NextResponse.json({ error: "Configuração dos recebimentos indisponível." }, { status: 503 });
  if (!connection.active) return NextResponse.json({ ok: false, paused: true, reason: "Aguardando validação do vínculo dos recebimentos com a carteira." });
  let apps;
  try { apps = rentalReceiptApps(connection.settings); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Mapeamento pendente." }, { status: 409 }); }
  const username = process.env.QLIK_USERNAME, password = process.env.QLIK_PASSWORD;
  if (!username || !password) return NextResponse.json({ error: "Credenciais do Qlik não configuradas." }, { status: 503 });
  const started = new Date();
  const { data: run, error: runError } = await db.from("data_connection_runs").insert({ connection_slug: RENTAL_RECEIPTS_CONNECTION, status: "running", trigger_source: "cron" }).select("id").single();
  if (runError) return NextResponse.json({ error: "Não foi possível iniciar a atualização." }, { status: 503 });
  await db.from("data_connections").update({ last_run_at: started.toISOString() }).eq("slug", RENTAL_RECEIPTS_CONNECTION);
  try {
    const { scrapeQlikCloudMetrics } = await import("./qlik-cloud");
    const snapshots = await scrapeQlikCloudMetrics({ username, password, apps, year: started.getUTCFullYear(), throughMonth: started.getUTCMonth() + 1 });
    const parsed = parseRentalReceiptSnapshots(snapshots);
    const { data: result, error: writeError } = await db.rpc("sync_qlik_rental_receipts", { p_rows: parsed.rows, p_started_at: started.toISOString() });
    if (writeError) throw new Error(writeError.message);
    const finished = new Date().toISOString();
    const { error: auditError } = await db.from("data_connection_runs").update({ status: "success", rows_read: parsed.dailyRows, rows_written: result.matched_rows, finished_at: finished, details: { ...result, source_total: parsed.sourceTotal } }).eq("id", run.id);
    if (auditError) throw new Error("Os recebimentos foram atualizados, mas o histórico da execução falhou.");
    return NextResponse.json({ ok: true, ...result, synchronized_at: finished });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0,1500) : "Falha na carga dos recebimentos.";
    const finished = new Date().toISOString();
    await Promise.all([
      db.from("data_connection_runs").update({ status: "error", finished_at: finished, error_message: message }).eq("id",run.id),
      db.from("data_connections").update({ last_error: message, last_error_at: finished }).eq("slug",RENTAL_RECEIPTS_CONNECTION),
    ]);
    return NextResponse.json({ error: "Não foi possível concluir a atualização dos recebimentos. Consulte o histórico da conexão." }, { status: 502 });
  }
}
