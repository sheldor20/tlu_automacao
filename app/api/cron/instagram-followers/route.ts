import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { fetchInstagramFollowers } from "@/lib/instagram-followers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function currentMonthSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new Error("Não foi possível determinar a competência atual.");
  return `${year}-${month}-01`;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const expectedUsername = process.env.INSTAGRAM_USERNAME || "terralotusurbanismo";
  if (!supabaseUrl || !serviceRoleKey || !accountId || !accessToken) {
    return NextResponse.json(
      { error: "Configure as variáveis do Supabase e da Instagram Graph API no ambiente do servidor." },
      { status: 503 },
    );
  }

  try {
    const profile = await fetchInstagramFollowers({
      accountId,
      accessToken,
      expectedUsername,
      baseUrl: process.env.INSTAGRAM_GRAPH_BASE_URL,
      apiVersion: process.env.INSTAGRAM_GRAPH_API_VERSION,
    });
    const referenceMonth = currentMonthSaoPaulo();
    const synchronizedAt = new Date().toISOString();
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await supabase.from("management_indicator_values").upsert({
      area: "rh-marketing-clientes",
      metric_key: "instagram_seguidores",
      reference_month: referenceMonth,
      dimension_key: "total",
      dimension_label: null,
      value: profile.followersCount,
      source: "Instagram Graph API",
      notes: `Seguidores do perfil @${profile.username}.`,
      metadata: {
        account_id: profile.id,
        username: profile.username,
        synchronized_at: synchronizedAt,
      },
    }, {
      onConflict: "area,metric_key,reference_month,dimension_key",
    });
    if (error) throw new Error(`Supabase: ${error.message}`);

    return NextResponse.json({
      ok: true,
      month: referenceMonth,
      username: profile.username,
      followers: profile.followersCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada na sincronização do Instagram.";
    console.error("Falha na sincronização de seguidores do Instagram:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
