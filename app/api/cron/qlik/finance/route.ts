import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  QLIK_FINANCE_APPS,
  QLIK_FINANCE_CONNECTION_SLUG,
  QLIK_FINANCE_SOURCE,
  toFinanceIndicatorRows,
  validateFinanceSnapshots,
} from "@/lib/qlik-finance";
import { saoPauloYearMonth } from "@/lib/qlik-legal-sales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function safeError(error: unknown) {
  if (!(error instanceof Error)) return "Falha inesperada sem mensagem técnica.";
  const code = "code" in error && typeof error.code === "string" ? ` [${error.code}]` : "";
  return `${error.name}${code}: ${error.message}`.slice(0, 5_000);
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
    .eq("slug", QLIK_FINANCE_CONNECTION_SLUG)
    .single();
  if (connectionError) {
    return NextResponse.json({
      error: `Conexão Qlik Financeiro indisponível: ${connectionError.message}. Execute a migration 20260813150000.`,
    }, { status: 503 });
  }
  if (!connection.active) {
    return NextResponse.json({ error: "A conexão Qlik Financeiro está pausada no catálogo de conexões." }, { status: 409 });
  }

  const { year, month } = saoPauloYearMonth();
  const triggerSource = (request.headers.get("user-agent") || "").toLowerCase().includes("vercel-cron") ? "cron" : "api";
  const { data: run, error: runError } = await supabase.from("data_connection_runs").insert({
    connection_slug: QLIK_FINANCE_CONNECTION_SLUG,
    status: "running",
    trigger_source: triggerSource,
    details: {
      year,
      through_month: month,
      apps: QLIK_FINANCE_APPS.map((app) => ({
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
    .eq("slug", QLIK_FINANCE_CONNECTION_SLUG);

  let phase = "load-browser-runtime";
  try {
    const { scrapeQlikCloudMetrics } = await import("@/lib/qlik-cloud");
    phase = "open-finance-app-and-read-indicators";
    const rawSnapshots = await scrapeQlikCloudMetrics({
      username,
      password,
      apps: QLIK_FINANCE_APPS,
      year,
      throughMonth: month,
    });
    phase = "validate-finance-indicators";
    const snapshots = validateFinanceSnapshots(rawSnapshots);
    const synchronizedAt = new Date().toISOString();
    const rows = toFinanceIndicatorRows(snapshots, synchronizedAt);
    const companyRows = rows.filter((row) => row.area === "empresa");
    const rentalRows = rows.filter((row) => row.area === "financas-compras");

    phase = "write-supabase-indicators";
    const clearFrom = `${year}-01-01`;
    const { data: rowsWritten, error: syncError } = await supabase.rpc("sync_qlik_finance_indicators", {
      p_rows: rows,
      p_source: QLIK_FINANCE_SOURCE,
      p_clear_from: clearFrom,
    });
    if (syncError) throw new Error(`Supabase: ${syncError.message}`);
    const written = Number(rowsWritten) || rows.length;

    const finishedAt = new Date().toISOString();
    await Promise.all([
      supabase.from("data_connection_runs").update({
        status: "success",
        rows_read: rawSnapshots.length,
        rows_written: written,
        finished_at: finishedAt,
        details: {
          year,
          through_month: month,
          company_rows: companyRows.length,
          finance_purchases_rows: rentalRows.length,
          duration_ms: Date.now() - startedAt,
        },
      }).eq("id", run.id),
      supabase.from("data_connections").update({
        last_success_at: finishedAt,
        last_error_at: null,
        last_error: null,
      }).eq("slug", QLIK_FINANCE_CONNECTION_SLUG),
    ]);

    const currentReference = `${year}-${String(month).padStart(2, "0")}-01`;
    return NextResponse.json({
      ok: true,
      connection: QLIK_FINANCE_CONNECTION_SLUG,
      run_id: run.id,
      year,
      through_month: month,
      current: Object.fromEntries(snapshots
        .filter((snapshot) => snapshot.referenceMonth === currentReference && !snapshot.dimensionKey)
        .map((snapshot) => [snapshot.metricKey, snapshot.value])),
      rows_read: rawSnapshots.length,
      rows_written: written,
      duration_ms: Date.now() - startedAt,
    });
  } catch (error) {
    const message = safeError(error);
    const finishedAt = new Date().toISOString();
    console.error("Falha na sincronização dos indicadores financeiros do Qlik:", {
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
      }).eq("slug", QLIK_FINANCE_CONNECTION_SLUG),
    ]);
    return NextResponse.json({
      ok: false,
      connection: QLIK_FINANCE_CONNECTION_SLUG,
      run_id: run.id,
      phase,
      error: message,
    }, { status: 502 });
  }
}
