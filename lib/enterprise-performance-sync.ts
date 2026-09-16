import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { PERFORMANCE_CONNECTION, performanceMetricApps, validatedPerformanceSnapshot } from "./qlik-enterprise-performance";

export async function syncEnterprisePerformance(trigger: "cron" | "manual", inspectOnly = false) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "A conexão financeira não está configurada no servidor." }, { status: 503 });
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: connection, error } = await db.from("data_connections").select("active,settings").eq("slug", PERFORMANCE_CONNECTION).single();
  if (error) return NextResponse.json({ error: "A base de performance ainda não está disponível." }, { status: 503 });
  if (!inspectOnly && !connection.active) return NextResponse.json({ ok: false, paused: true, error: "A primeira carga aguarda a validação das três fontes do Qlik. Nenhum dado demonstrativo será exibido." }, { status: trigger === "cron" ? 200 : 409 });
  let apps;
  try { apps = performanceMetricApps(connection.settings, inspectOnly); }
  catch (configError) { return NextResponse.json({ error: configError instanceof Error ? configError.message : "Configuração financeira pendente." }, { status: 409 }); }
  const username = process.env.QLIK_USERNAME, password = process.env.QLIK_PASSWORD;
  if (!username || !password) return NextResponse.json({ error: "As credenciais do Qlik não estão configuradas no servidor." }, { status: 503 });
  const started = new Date();
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(started);
  const collect = async () => {
    const { scrapeQlikCloudMetrics } = await import("./qlik-cloud");
    const rows = await scrapeQlikCloudMetrics({ username, password, apps, year: Number(localDate.slice(0, 4)), throughMonth: Number(localDate.slice(5, 7)) });
    return { rows, snapshot: validatedPerformanceSnapshot(rows) };
  };
  // Protected cron inspection validates a candidate mapping without enabling it
  // or changing financial snapshots and synchronization audit state.
  if (inspectOnly) {
    try {
      const { snapshot } = await collect();
      return NextResponse.json({ ok: true, inspection_only: true, metadata: snapshot.metadata,
        companies: snapshot.companies.map((company) => {
          const rows = snapshot.flows.filter((row) => row.company_key === company.company_key);
          const totals = { received: 0, paid: 0, receivable: 0, payable: 0 };
          for (const row of rows) totals[row.kind] += row.amount;
          const dates = rows.map((row) => row.cash_date).filter((date): date is string => date !== null).sort();
          return { ...company, totals, flows: rows.length, first_date: dates[0], last_date: dates.at(-1), undated: rows.filter((row) => !row.cash_date).length };
        }),
      }, { headers: { "Cache-Control": "no-store" } });
    } catch (inspectionError) {
      return NextResponse.json({ error: inspectionError instanceof Error ? inspectionError.message.slice(0, 3000) : "Falha na conferência financeira." }, { status: 502 });
    }
  }
  const { data: running, error: lockError } = await db.from("data_connection_runs").select("id").eq("connection_slug", PERFORMANCE_CONNECTION).eq("status", "running").gte("started_at", new Date(started.getTime() - 330_000).toISOString()).limit(1);
  if (lockError) return NextResponse.json({ error: "Não foi possível verificar o estado da sincronização." }, { status: 503 });
  if (running?.length) return NextResponse.json({ error: "Já existe uma atualização em andamento. Aguarde sua conclusão." }, { status: 409 });
  const { data: run, error: runError } = await db.from("data_connection_runs").insert({ connection_slug: PERFORMANCE_CONNECTION, status: "running", trigger_source: trigger === "cron" ? "cron" : "api", details: { all_companies: true, all_source_dates: true } }).select("id").single();
  if (runError) return NextResponse.json({ error: "Não foi possível iniciar a sincronização financeira." }, { status: 503 });
  await db.from("data_connections").update({ last_run_at: started.toISOString() }).eq("slug", PERFORMANCE_CONNECTION);
  try {
    const { rows: snapshots, snapshot } = await collect();
    const { data: id, error: writeError } = await db.rpc("sync_enterprise_performance", { p_as_of: localDate, p_companies: snapshot.companies, p_flows: snapshot.flows, p_metadata: { ...snapshot.metadata, extraction_started_at: started.toISOString() } });
    if (writeError) throw new Error("Não foi possível salvar a carga financeira conciliada.");
    const finished = new Date().toISOString();
    await Promise.all([
      db.from("data_connection_runs").update({ status: "success", rows_read: snapshots.length, rows_written: snapshot.flows.length, finished_at: finished, details: { snapshot_id: id, company_count: snapshot.companies.length, source_totals: snapshot.metadata.sources } }).eq("id", run.id),
      db.from("data_connections").update({ last_success_at: finished, last_error: null, last_error_at: null }).eq("slug", PERFORMANCE_CONNECTION),
    ]);
    return NextResponse.json({ ok: true, companies: snapshot.companies.length, flows: snapshot.flows.length, synchronized_at: finished });
  } catch (syncError) {
    const message = syncError instanceof Error ? syncError.message.slice(0, 3000) : "Falha inesperada na origem financeira.";
    const finished = new Date().toISOString();
    await Promise.all([
      db.from("data_connection_runs").update({ status: "error", finished_at: finished, error_message: message }).eq("id", run.id),
      db.from("data_connections").update({ last_error_at: finished, last_error: message }).eq("slug", PERFORMANCE_CONNECTION),
    ]);
    return NextResponse.json({ error: "Não foi possível concluir a atualização do Qlik. A última carga válida foi preservada." }, { status: 502 });
  }
}
