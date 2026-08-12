import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { scrapeQlikCloudTable } from "@/lib/qlik-cloud";
import {
  currentMonthKey,
  parseDelinquencySnapshot,
  QLIK_DELINQUENCY_CONNECTION_SLUG,
  QLIK_DELINQUENCY_FILTERS,
  QLIK_DELINQUENCY_SOURCE,
  toDelinquencyIndicatorRows,
} from "@/lib/qlik-delinquency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_SHEET_URL = "https://terralotusurbanismo.us.qlikcloud.com/sense/app/ce523abd-dce7-40f5-bd1c-93a23ffa4faa/sheet/d70dcedc-9e36-4de1-bf01-71776b690a63/state/analysis/hubUrl/%2Fanalytics%2Fcatalog";
const DEFAULT_OBJECT_ID = "jJTqUzF";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const username = process.env.QLIK_USERNAME;
  const password = process.env.QLIK_PASSWORD;
  if (!supabaseUrl || !serviceRoleKey || !username || !password) {
    return NextResponse.json({
      error: "Configure QLIK_USERNAME, QLIK_PASSWORD e as variáveis do Supabase no ambiente do servidor.",
    }, { status: 503 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: connection, error: connectionError } = await supabase
    .from("data_connections")
    .select("active")
    .eq("slug", QLIK_DELINQUENCY_CONNECTION_SLUG)
    .single();
  if (connectionError) {
    return NextResponse.json({
      error: `Base de conexões indisponível: ${connectionError.message}. Execute a migration 20260812250000.`,
    }, { status: 503 });
  }
  if (!connection.active) {
    return NextResponse.json({ error: "A conexão Qlik está pausada no catálogo de conexões." }, { status: 409 });
  }

  const triggerSource = (request.headers.get("user-agent") || "").toLowerCase().includes("vercel-cron")
    ? "cron"
    : "api";
  const { data: run, error: runError } = await supabase.from("data_connection_runs").insert({
    connection_slug: QLIK_DELINQUENCY_CONNECTION_SLUG,
    status: "running",
    trigger_source: triggerSource,
    details: { object_id: process.env.QLIK_DELINQUENCY_TABLE_OBJECT_ID || DEFAULT_OBJECT_ID },
  }).select("id").single();
  if (runError) {
    return NextResponse.json({ error: `Não foi possível iniciar o histórico da conexão: ${runError.message}` }, { status: 503 });
  }

  const startedAt = Date.now();
  await supabase.from("data_connections").update({ last_run_at: new Date().toISOString() })
    .eq("slug", QLIK_DELINQUENCY_CONNECTION_SLUG);

  try {
    const objectId = process.env.QLIK_DELINQUENCY_TABLE_OBJECT_ID || DEFAULT_OBJECT_ID;
    const snapshot = await scrapeQlikCloudTable({
      username,
      password,
      sheetUrl: process.env.QLIK_DELINQUENCY_SHEET_URL || DEFAULT_SHEET_URL,
      objectId,
      filters: QLIK_DELINQUENCY_FILTERS,
    });
    const months = parseDelinquencySnapshot(snapshot);
    const synchronizedAt = new Date().toISOString();
    const rows = toDelinquencyIndicatorRows(months, synchronizedAt);
    const { data: written, error: syncError } = await supabase.rpc("sync_data_connection_indicators", {
      p_connection_slug: QLIK_DELINQUENCY_CONNECTION_SLUG,
      p_source: QLIK_DELINQUENCY_SOURCE,
      p_rows: rows,
      p_clear_area: "juridico-vendas-cobranca",
      p_clear_metric_keys: ["inadimplencia_total", "eficiencia_cobranca"],
      p_clear_from: currentMonthKey(),
    });
    if (syncError) throw new Error(`Supabase: ${syncError.message}`);

    const latest = months.at(-1)!;
    const finishedAt = new Date().toISOString();
    await Promise.all([
      supabase.from("data_connection_runs").update({
        status: "success",
        rows_read: snapshot.rows.length,
        rows_written: Number(written) || rows.length,
        finished_at: finishedAt,
        details: {
          object_id: objectId,
          first_month: months[0].referenceMonth,
          latest_month: latest.referenceMonth,
          months_written: months.length,
          duration_ms: Date.now() - startedAt,
        },
      }).eq("id", run.id),
      supabase.from("data_connections").update({
        last_success_at: finishedAt,
        last_error_at: null,
        last_error: null,
      }).eq("slug", QLIK_DELINQUENCY_CONNECTION_SLUG),
    ]);

    return NextResponse.json({
      ok: true,
      connection: QLIK_DELINQUENCY_CONNECTION_SLUG,
      latest: {
        month: latest.referenceMonth,
        delinquency_total: latest.delinquencyBalance,
        reduction_percent: latest.reductionPercent,
      },
      history: months.map((month) => ({
        month: month.referenceMonth,
        delinquency_total: month.delinquencyBalance,
        reduction_percent: month.reductionPercent,
      })),
      rows_read: snapshot.rows.length,
      rows_written: Number(written) || rows.length,
      duration_ms: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada na sincronização do Qlik.";
    const finishedAt = new Date().toISOString();
    console.error("Falha na sincronização de inadimplência do Qlik:", message);
    await Promise.all([
      supabase.from("data_connection_runs").update({
        status: "error",
        error_message: message,
        finished_at: finishedAt,
        details: { duration_ms: Date.now() - startedAt },
      }).eq("id", run.id),
      supabase.from("data_connections").update({
        last_error_at: finishedAt,
        last_error: message,
      }).eq("slug", QLIK_DELINQUENCY_CONNECTION_SLUG),
    ]);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
