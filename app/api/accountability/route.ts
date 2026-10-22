import { createClient } from "@supabase/supabase-js";
import { NextResponse, after } from "next/server";
import { z } from "zod";
import { canGenerateBook } from "@/lib/accountability/policy";
import { exportConfigured } from "@/lib/accountability/book";
import { sendAccountabilityDispatch } from "@/lib/accountability/send";
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
  const year = Number(new URL(request.url).searchParams.get("year"));
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
    dispatches: dispatches.data,
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
    .object({
      enterpriseId: z.string().uuid(),
      year: z.number().int(),
      month: z.number().int().min(1).max(12),
    })
    .strict()
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
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
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
  const values = {
    enterprise_id: enterpriseId,
    year,
    month,
    status: "processing",
    requested_by: ctx.user.id,
    error: null,
  };
  let job = await service
    .from("accountability_dispatches")
    .insert(values)
    .select("id")
    .single();
  if (job.error?.code === "23505")
    job = await service
      .from("accountability_dispatches")
      .update({ status: "processing", requested_by: ctx.user.id, error: null })
      .eq("enterprise_id", enterpriseId)
      .eq("year", year)
      .eq("month", month)
      .in("status", ["historical", "failed"])
      .select("id")
      .single();
  if (job.error || !job.data)
    return NextResponse.json(
      {
        error:
          "Este período já está em processamento ou já foi enviado no BETA.",
      },
      { status: 409 },
    );
  const id = job.data.id;
  after(async () => {
    await sendAccountabilityDispatch(
      service,
      id,
      enterprise.data.qlik_value,
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
