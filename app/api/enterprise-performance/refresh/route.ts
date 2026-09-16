import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { syncEnterprisePerformance } from "@/lib/enterprise-performance-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token) return NextResponse.json({ error: "Entre novamente para atualizar os dados." }, { status: 401 });
  if (!url || !key) return NextResponse.json({ error: "Conexão financeira indisponível." }, { status: 503 });
  const session = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await session.auth.getUser(token);
  if (authError || !auth.user) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  const { data: allowed, error: accessError } = await session.rpc("has_department_access", { p_department_slug: "novos-negocios" });
  if (accessError) return NextResponse.json({ error: "Não foi possível verificar sua permissão." }, { status: 503 });
  if (!allowed) return NextResponse.json({ error: "Você não possui acesso a Novos negócios." }, { status: 403 });
  const response = await syncEnterprisePerformance("manual");
  response.headers.set("Cache-Control", "no-store");
  return response;
}
