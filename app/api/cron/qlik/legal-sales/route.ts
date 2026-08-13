import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  QLIK_LEGAL_SALES_APPS,
  QLIK_LEGAL_SALES_AREA,
  QLIK_LEGAL_SALES_CONNECTION_SLUG,
  QLIK_LEGAL_SALES_METRIC_KEYS,
  QLIK_LEGAL_SALES_SOURCE,
  saoPauloYearMonth,
  toLegalSalesIndicatorRows,
  validateLegalSalesSnapshots,
} from "@/lib/qlik-legal-sales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function safeError(error: unknown) {
  if (!(error instanceof Error)) return "Falha inesperada sem mensagem técnica.";
  const code = "code" in error && typeof error.code === "string" ? ` [${error.code}]` : "";
  return `${error.name}${code}: ${error.message}`.slice(0, 2_500);
}

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
    .eq("slug", QLIK_LEGAL_SALES_CONNECTION_SLUG)
    .single();
  if (connectionError) {
    return NextResponse.json({
      error: `Conexão Qlik de vendas indisponível: ${connectionError.message}. Execute a migration 20260813110000.`,
    }, { status: 503 });
  }
  if (!connection.active) {
    return NextResponse.json({ error: "A conexão Qlik de vendas está pausada no catálogo de conexões." }, { status: 409 });
  }

  const { year, month } = saoPauloYearMonth();
  const triggerSource = (request.headers.get("user-agent") || "").toLowerCase().includes("vercel-cron")
    ? "cron"
    : "api";
  const { data: run, error: runError } = await supabase.from("data_connection_runs").insert({
    connection_slug: QLIK_LEGAL_SALES_CONNECTION_SLUG,
    status: "running",
    trigger_source: triggerSource,
    details: {
      year,
      through_month: month,
      apps: QLIK_LEGAL_SALES_APPS.map((app) => ({
        app_id: new URL(app.entryUrl).pathname.split("/")[3],
        sheets: [...new Set(app.metrics.map((metric) => metric.sheetId))],
      })),
    },
  }).select("id").single();
  if (runError) {
    return NextResponse.json({ error: `Não foi possível iniciar o histórico da conexão: ${runError.message}` }, { status: 503 });
  }

  const startedAt = Date.now();
  await supabase.from("data_connections").update({ last_run_at: new Date().toISOString() })
    .eq("slug", QLIK_LEGAL_SALES_CONNECTION_SLUG);

  let phase = "load-browser-runtime";
  try {
    const { scrapeQlikCloudMetrics } = await import("@/lib/qlik-cloud");
    phase = "open-qlik-apps-and-read-indicators";
    const rawSnapshots = await scrapeQlikCloudMetrics({
      username,
      password,
      apps: QLIK_LEGAL_SALES_APPS,
      year,
      throughMonth: month,
    });
    phase = "validate-eight-indicators";
    const snapshots = validateLegalSalesSnapshots(rawSnapshots);
    const synchronizedAt = new Date().toISOString();
    const rows = toLegalSalesIndicatorRows(snapshots, synchronizedAt);

    phase = "write-supabase-indicators";
    const { data: written, error: syncError } = await supabase.rpc("sync_data_connection_indicators", {
      p_connection_slug: QLIK_LEGAL_SALES_CONNECTION_SLUG,
      p_source: QLIK_LEGAL_SALES_SOURCE,
      p_rows: rows,
      p_clear_area: QLIK_LEGAL_SALES_AREA,
      p_clear_metric_keys: QLIK_LEGAL_SALES_METRIC_KEYS,
      p_clear_from: `${year}-01-01`,
    });
    if (syncError) throw new Error(`Supabase: ${syncError.message}`);

    const finishedAt = new Date().toISOString();
    const objects = [...new Map(snapshots.map((snapshot) => [snapshot.metricKey, {
      metric_key: snapshot.metricKey,
      app_id: snapshot.appId,
      sheet_id: snapshot.sheetId,
      object_id: snapshot.objectId,
      object_title: snapshot.objectTitle,
    }])).values()];
    await Promise.all([
      supabase.from("data_connection_runs").update({
        status: "success",
        rows_read: snapshots.length,
        rows_written: Number(written) || rows.length,
        finished_at: finishedAt,
        details: {
          year,
          through_month: month,
          metrics: objects,
          duration_ms: Date.now() - startedAt,
        },
      }).eq("id", run.id),
      supabase.from("data_connections").update({
        last_success_at: finishedAt,
        last_error_at: null,
        last_error: null,
      }).eq("slug", QLIK_LEGAL_SALES_CONNECTION_SLUG),
    ]);

    const currentReference = `${year}-${String(month).padStart(2, "0")}-01`;
    return NextResponse.json({
      ok: true,
      connection: QLIK_LEGAL_SALES_CONNECTION_SLUG,
      run_id: run.id,
      year,
      through_month: month,
      current: Object.fromEntries(snapshots
        .filter((snapshot) => snapshot.referenceMonth === currentReference)
        .map((snapshot) => [snapshot.metricKey, snapshot.value])),
      series: Object.fromEntries([
        "unidades_disponiveis",
        "vendas_mes",
        "distratos_mes",
        "unidades_quitadas",
        "unidades_sem_processo",
        "unidades_autorizadas_escrituracao",
      ].map((metricKey) => [
        metricKey,
        snapshots.filter((snapshot) => snapshot.metricKey === metricKey).map((snapshot) => ({
          month: snapshot.referenceMonth,
          value: snapshot.value,
        })),
      ])),
      rows_read: snapshots.length,
      rows_written: Number(written) || rows.length,
      duration_ms: Date.now() - startedAt,
    });
  } catch (error) {
    const message = safeError(error);
    const finishedAt = new Date().toISOString();
    console.error("Falha na sincronização dos indicadores de vendas do Qlik:", {
      phase,
      message,
      stack: error instanceof Error ? error.stack : null,
    });
    await Promise.allSettled([
      supabase.from("data_connection_runs").update({
        status: "error",
        error_message: message,
        finished_at: finishedAt,
        details: { phase, year, through_month: month, duration_ms: Date.now() - startedAt },
      }).eq("id", run.id),
      supabase.from("data_connections").update({
        last_error_at: finishedAt,
        last_error: message,
      }).eq("slug", QLIK_LEGAL_SALES_CONNECTION_SLUG),
    ]);
    return NextResponse.json({
      ok: false,
      connection: QLIK_LEGAL_SALES_CONNECTION_SLUG,
      run_id: run.id,
      phase,
      error: message,
    }, { status: 502 });
  }
}
