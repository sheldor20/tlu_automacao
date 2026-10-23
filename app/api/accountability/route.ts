import { createClient } from "@supabase/supabase-js";
import { NextResponse, after } from "next/server";
import { z } from "zod";
import { canGenerateBook } from "@/lib/accountability/policy";
import { exportConfigured } from "@/lib/accountability/book";
import { sendAccountabilityDispatch } from "@/lib/accountability/send";
import {
  claimDispatch,
  recoverDispatch,
  processingExpired,
  safeToRetry,
  DispatchConflict,
  type DispatchRecord,
} from "@/lib/accountability/dispatch";
export const runtime = "nodejs";
export const maxDuration = 800;
async function context(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !key) return null;
  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  const permission = await client.rpc("has_department_access", {
    p_department_slug: "prestacao-contas",
  });
  if (permission.error || permission.data !== true) return null;
  return { client, user: data.user };
}
export async function GET(request: Request) {
  const ctx = await context(request);
  if (!ctx)
    return NextResponse.json(
      { error: "Acesso não autorizado." },
      { status: 403 },
    );
  const params = new URL(request.url).searchParams;
  if (params.has("artifact")) {
    const artifact = z
      .object({
        dispatchId: z.string().uuid(),
        artifact: z.enum(["pdf", "excel"]),
      })
      .safeParse(Object.fromEntries(params));
    if (!artifact.success)
      return NextResponse.json({ error: "Arquivo inválido." }, { status: 400 });
    const record = await ctx.client
      .from("accountability_dispatches")
      .select("id,pdf_path,excel_path")
      .eq("id", artifact.data.dispatchId)
      .maybeSingle();
    const path =
      artifact.data.artifact === "pdf"
        ? record.data?.pdf_path
        : record.data?.excel_path;
    if (
      record.error ||
      !path ||
      !path.startsWith(`${artifact.data.dispatchId}/`)
    )
      return NextResponse.json(
        { error: "Arquivo indisponível." },
        { status: 404 },
      );
    const signed = await ctx.client.storage
      .from("accountability-books")
      .createSignedUrl(path, 120);
    if (signed.error || !signed.data?.signedUrl)
      return NextResponse.json(
        { error: "Não foi possível abrir o arquivo." },
        { status: 503 },
      );
    return NextResponse.json(
      { url: signed.data.signedUrl },
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
  const year = Number(params.get("year"));
  if (!Number.isInteger(year) || year < 2026 || year > 2100)
    return NextResponse.json({ error: "Ano inválido." }, { status: 400 });
  const [enterprises, dispatches, periods, admin] = await Promise.all([
    ctx.client
      .from("accountability_enterprises")
      .select("*")
      .eq("active", true)
      .order("name"),
    ctx.client.from("accountability_dispatches").select("*").eq("year", year),
    ctx.client.from("accountability_periods").select("*").eq("year", year),
    ctx.client.rpc("is_system_admin"),
  ]);
  if (enterprises.error || dispatches.error || periods.error || admin.error)
    return NextResponse.json(
      { error: "Não foi possível carregar a prestação de contas." },
      { status: 503 },
    );
  return NextResponse.json({
    enterprises: enterprises.data,
    dispatches: dispatches.data.map((d) => ({
      ...d,
      needs_review:
        d.status === "uncertain" ||
        (d.status === "processing" && processingExpired(d)) ||
        (d.status === "failed" && !safeToRetry(d as DispatchRecord)),
    })),
    periods: periods.data,
    isAdmin: admin.data === true,
    configured:
      exportConfigured() &&
      Boolean(
        process.env.RESEND_API_KEY &&
        process.env.RESEND_FROM_EMAIL &&
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      ),
  });
}
export async function POST(request: Request) {
  const ctx = await context(request);
  if (!ctx)
    return NextResponse.json(
      { error: "Acesso não autorizado." },
      { status: 403 },
    );
  const parsed = z
    .union([
      z
        .object({
          enterpriseId: z.string().uuid(),
          year: z.number().int(),
          month: z.number().int().min(1).max(12),
        })
        .strict(),
      z
        .object({ action: z.literal("recover"), dispatchId: z.string().uuid() })
        .strict(),
    ])
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return NextResponse.json(
      { error: "Serviço indisponível." },
      { status: 503 },
    );
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
  if ("action" in parsed.data) {
    try {
      return NextResponse.json(
        await recoverDispatch(service, parsed.data.dispatchId),
      );
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Falha na conferência.",
        },
        { status: error instanceof DispatchConflict ? 409 : 503 },
      );
    }
  }
  const { enterpriseId, year, month } = parsed.data;
  const [enterprise, period] = await Promise.all([
    ctx.client
      .from("accountability_enterprises")
      .select("*")
      .eq("id", enterpriseId)
      .eq("active", true)
      .single(),
    ctx.client
      .from("accountability_periods")
      .select("closed")
      .eq("year", year)
      .eq("month", month)
      .maybeSingle(),
  ]);
  if (
    enterprise.error ||
    period.error ||
    !enterprise.data ||
    !canGenerateBook(year, month, period.data?.closed === true)
  )
    return NextResponse.json(
      {
        error:
          "Selecione um empreendimento válido e um mês fechado do ano vigente.",
      },
      { status: 422 },
    );
  if (
    !exportConfigured() ||
    !process.env.RESEND_API_KEY ||
    !process.env.RESEND_FROM_EMAIL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  )
    return NextResponse.json(
      {
        error:
          "A integração de exportação e envio ainda precisa ser configurada.",
      },
      { status: 503 },
    );
  let job: { id: string; token: string };
  try {
    job = await claimDispatch(service, enterpriseId, year, month, ctx.user.id);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha no processamento.",
      },
      { status: error instanceof DispatchConflict ? 409 : 503 },
    );
  }
  after(async () => {
    await sendAccountabilityDispatch(
      service,
      job.id,
      job.token,
      { name: enterprise.data.name, qlik_value: enterprise.data.qlik_value },
      year,
      month,
      async () => {
        const permission = await ctx.client.rpc("has_department_access", {
          p_department_slug: "prestacao-contas",
        });
        return !permission.error && permission.data === true;
      },
    );
  });
  return NextResponse.json({ processing: true }, { status: 202 });
}
