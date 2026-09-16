import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { vgvAppsForDate, QLIK_VGV_CONNECTION, QLIK_VGV_SOURCE, vgvIndicatorRows } from "@/lib/qlik-vgv";
import { todayIso } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const headers = { "Cache-Control": "no-store, max-age=0" };
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401, headers });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const username = process.env.QLIK_USERNAME;
  const password = process.env.QLIK_PASSWORD;
  if (!url || !key || !username || !password) {
    return NextResponse.json({ error: "Configure as credenciais do Qlik e do Supabase no servidor." }, { status: 503, headers });
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: connection, error: connectionError } = await db.from("data_connections").select("active").eq("slug", QLIK_VGV_CONNECTION).single();
  if (connectionError || !connection) return NextResponse.json({ error: "A conexão de VGV ainda não está cadastrada." }, { status: 503, headers });
  if (!connection.active) return NextResponse.json({ error: "A conexão de VGV está pausada." }, { status: 409, headers });
  const referenceDate = todayIso();
  const startedAt = new Date().toISOString();
  const { data: run, error: runError } = await db.from("data_connection_runs").insert({
    connection_slug: QLIK_VGV_CONNECTION, status: "running",
    trigger_source: (request.headers.get("user-agent") || "").includes("vercel-cron") ? "cron" : "api",
    details: { reference_date: referenceDate },
  }).select("id").single();
  if (runError || !run) return NextResponse.json({ error: "Não foi possível registrar a execução do VGV." }, { status: 503, headers });
  await db.from("data_connections").update({ last_run_at: startedAt }).eq("slug", QLIK_VGV_CONNECTION);
  let phase = "read-qlik";
  try {
    const { scrapeQlikCloudMetrics } = await import("@/lib/qlik-cloud");
    const snapshots = await scrapeQlikCloudMetrics({ username, password, apps: vgvAppsForDate(referenceDate),
      year: Number(referenceDate.slice(0, 4)), throughMonth: Number(referenceDate.slice(5, 7)),
    });
    phase = "validate-projection";
    const synchronizedAt = new Date().toISOString();
    const { rows, projection } = vgvIndicatorRows(snapshots, synchronizedAt, referenceDate);
    phase = "write-indicators";
    const { error: writeError } = await db.rpc("sync_data_connection_indicators", {
      p_connection_slug: QLIK_VGV_CONNECTION, p_source: QLIK_VGV_SOURCE, p_rows: rows,
      p_clear_area: "novos-negocios", p_clear_metric_keys: ["vgv_total_receber", "vgv_inadimplencia_atual", "vgv_projetado_liquido", "vgv_saldo_anual"],
      p_clear_from: `${referenceDate.slice(0, 7)}-01`,
    });
    if (writeError) throw new Error(writeError.message);
    const finishedAt = new Date().toISOString();
    await Promise.all([
      db.from("data_connection_runs").update({ status: "success", finished_at: finishedAt, rows_read: snapshots.length, rows_written: rows.length,
        details: { reference_date: referenceDate, first_year: projection.points[0].year, last_year: projection.points.at(-1)!.year, duration_ms: Date.now() - Date.parse(startedAt) },
      }).eq("id", run.id),
      db.from("data_connections").update({ last_success_at: finishedAt, last_error_at: null, last_error: null }).eq("slug", QLIK_VGV_CONNECTION),
    ]);
    return NextResponse.json({ ok: true, rows_written: rows.length, current: { total: projection.total, delinquency_percent: projection.delinquencyPercent, adjusted_total: projection.adjustedTotal, overdue: projection.overdue }, years: projection.points, synchronized_at: synchronizedAt }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 5000) : "Falha ao atualizar o VGV.";
    await Promise.allSettled([
      db.from("data_connection_runs").update({ status: "error", finished_at: new Date().toISOString(), error_message: message, details: { phase, reference_date: referenceDate } }).eq("id", run.id),
      db.from("data_connections").update({ last_error_at: new Date().toISOString(), last_error: message }).eq("slug", QLIK_VGV_CONNECTION),
    ]);
    return NextResponse.json({ ok: false, error: message, phase }, { status: 502, headers });
  }
}
