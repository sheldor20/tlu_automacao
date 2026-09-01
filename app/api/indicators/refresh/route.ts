import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  indicatorRefreshJobsForArea,
  type IndicatorRefreshJob,
  type ManagementIndicatorArea,
} from "@/lib/indicator-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RefreshJobResult = {
  key: IndicatorRefreshJob["key"];
  label: string;
  ok: boolean;
  status: number;
  duration_ms: number;
  error?: string;
};

type AccessContext = {
  service: SupabaseClient;
};

function noStoreHeaders() {
  return { "Cache-Control": "no-store, max-age=0" };
}

async function requireAreaAccess(
  request: Request,
  area: ManagementIndicatorArea,
): Promise<AccessContext | NextResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Configure as variáveis do Supabase no ambiente do servidor." },
      { status: 503, headers: noStoreHeaders() },
    );
  }
  if (!token) {
    return NextResponse.json(
      { error: "Sessão inválida." },
      { status: 401, headers: noStoreHeaders() },
    );
  }

  const sessionClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await sessionClient.auth.getUser(token);
  if (authError || !authData.user) {
    return NextResponse.json(
      { error: "Sessão expirada. Entre novamente." },
      { status: 401, headers: noStoreHeaders() },
    );
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("active,is_admin")
    .eq("user_id", authData.user.id)
    .single();

  if (profileError || !profile?.active) {
    return NextResponse.json(
      { error: "Seu usuário não está ativo para atualizar os indicadores." },
      { status: 403, headers: noStoreHeaders() },
    );
  }

  if (!profile.is_admin) {
    const { data: access, error: accessError } = await service
      .from("profile_indicator_areas")
      .select("area")
      .eq("user_id", authData.user.id)
      .eq("area", area)
      .maybeSingle();

    if (accessError) {
      return NextResponse.json(
        { error: "Não foi possível validar o acesso à área de indicadores." },
        { status: 503, headers: noStoreHeaders() },
      );
    }
    if (!access) {
      return NextResponse.json(
        { error: "Esta área de indicadores não está liberada para o seu usuário." },
        { status: 403, headers: noStoreHeaders() },
      );
    }
  }

  return { service };
}

function internalOrigin(request: Request) {
  const deploymentUrl = process.env.VERCEL_URL?.trim();
  if (deploymentUrl) {
    const hostname = deploymentUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    return `https://${hostname}`;
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.hostname === "localhost" || requestUrl.hostname === "127.0.0.1") {
    return requestUrl.origin;
  }

  throw new Error("A URL interna da implantação não está disponível no ambiente da Vercel.");
}

function responseError(payload: unknown, status: number) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const value = (payload as { error?: unknown }).error;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return `A fonte respondeu com status ${status}.`;
}

async function runJob(
  origin: string,
  cronSecret: string,
  job: IndicatorRefreshJob,
): Promise<RefreshJobResult> {
  const startedAt = Date.now();
  try {
    const response = await fetch(new URL(job.path, origin), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "User-Agent": "terra-lotus-manual-indicator-refresh/1.0",
      },
      cache: "no-store",
      redirect: "error",
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    const ok = response.ok && payload?.ok !== false;
    return {
      key: job.key,
      label: job.label,
      ok,
      status: response.status,
      duration_ms: Date.now() - startedAt,
      ...(ok ? {} : { error: responseError(payload, response.status) }),
    };
  } catch (error) {
    return {
      key: job.key,
      label: job.label,
      ok: false,
      status: 0,
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Falha inesperada ao executar a fonte.",
    };
  }
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null) as { area?: unknown } | null;
  const jobs = indicatorRefreshJobsForArea(payload?.area);
  if (!jobs) {
    return NextResponse.json(
      { error: "Área de indicadores inválida." },
      { status: 400, headers: noStoreHeaders() },
    );
  }
  const area = payload!.area as ManagementIndicatorArea;

  const access = await requireAreaAccess(request, area);
  if (access instanceof NextResponse) return access;

  if (jobs.length === 0) {
    return NextResponse.json({
      ok: true,
      area,
      message: "Os indicadores operacionais foram relidos da base.",
      results: [],
    }, { headers: noStoreHeaders() });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "Configure CRON_SECRET no ambiente da Vercel para executar as atualizações manuais." },
      { status: 503, headers: noStoreHeaders() },
    );
  }

  let origin: string;
  try {
    origin = internalOrigin(request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível localizar a implantação atual." },
      { status: 503, headers: noStoreHeaders() },
    );
  }

  const results = await Promise.all(jobs.map((job) => runJob(origin, cronSecret, job)));
  const failed = results.filter((result) => !result.ok);
  const succeeded = results.length - failed.length;
  const status = failed.length === 0 ? 200 : succeeded > 0 ? 207 : 502;
  const message = failed.length === 0
    ? `${results.length} fonte(s) atualizada(s) com sucesso.`
    : succeeded > 0
      ? `${succeeded} fonte(s) atualizada(s); ${failed.length} apresentou(aram) falha.`
      : "Nenhuma fonte externa foi atualizada.";

  return NextResponse.json({
    ok: failed.length === 0,
    area,
    message,
    results,
    ...(failed.length > 0 ? { error: failed.map((result) => `${result.label}: ${result.error}`).join(" | ") } : {}),
  }, { status, headers: noStoreHeaders() });
}
