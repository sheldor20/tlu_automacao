import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { scrapeNpsYear } from "@/lib/asc-nps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function saoPauloYear() {
  return Number(new Intl.DateTimeFormat("en", {
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date()));
}

function requestedYear(request: Request) {
  const value = new URL(request.url).searchParams.get("year");
  if (!value) return saoPauloYear();
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return null;
  return year;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const year = requestedYear(request);
  if (!year) return NextResponse.json({ error: "Ano inválido." }, { status: 400 });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const username = process.env.ASCSAC_USERNAME;
  const password = process.env.ASCSAC_PASSWORD;
  const surveyId = process.env.ASCSAC_SURVEY_ID || "1";
  if (!supabaseUrl || !serviceRoleKey || !username || !password) {
    return NextResponse.json(
      { error: "Configure as variáveis do Supabase e do ASCSAC no ambiente do servidor." },
      { status: 503 },
    );
  }

  const startedAt = Date.now();
  try {
    const results = await scrapeNpsYear({ username, password, surveyId }, year);
    const populated = results.filter((result) => result.average !== null && result.responseCount > 0);
    const synchronizedAt = new Date().toISOString();
    const rows = populated.map((result) => ({
      area: "rh-marketing-clientes",
      metric_key: "nps_clientes",
      reference_month: result.referenceMonth,
      dimension_key: "total",
      dimension_label: null,
      value: result.average!,
      source: "ASCSAC - Pesquisa de atendimento",
      notes: `Média de ${result.responseCount} resposta(s), escala de 0 a 5.`,
      metadata: {
        response_count: result.responseCount,
        scale_min: 0,
        scale_max: 5,
        distribution: result.distribution,
        synchronized_at: synchronizedAt,
      },
    }));

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (rows.length > 0) {
      const { error } = await supabase.from("management_indicator_values").upsert(rows, {
        onConflict: "area,metric_key,reference_month,dimension_key",
      });
      if (error) throw new Error(`Supabase: ${error.message}`);
    }

    const emptyMonths = results
      .filter((result) => result.responseCount === 0)
      .map((result) => result.referenceMonth);
    if (emptyMonths.length > 0) {
      const { error } = await supabase
        .from("management_indicator_values")
        .delete()
        .eq("area", "rh-marketing-clientes")
        .eq("metric_key", "nps_clientes")
        .eq("dimension_key", "total")
        .in("reference_month", emptyMonths);
      if (error) throw new Error(`Supabase: ${error.message}`);
    }

    return NextResponse.json({
      ok: true,
      year,
      updated: populated.map((result) => ({
        month: result.referenceMonth,
        average: result.average,
        responses: result.responseCount,
      })),
      empty_months: emptyMonths,
      duration_ms: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada na sincronização.";
    console.error("Falha na sincronização mensal do NPS:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
