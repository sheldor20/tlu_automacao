import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { rentalCreateSchema } from "@/lib/rental-create";

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token) return NextResponse.json({ error: "Entre novamente no sistema." }, { status: 401 });
  if (!url || !key || !serviceKey) return NextResponse.json({ error: "Cadastro indisponível." }, { status: 503 });
  const session = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await session.auth.getUser(token);
  if (authError || !auth.user) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  const { data: allowed, error: accessError } = await session.rpc("has_department_access", { p_department_slug: "alugueis" });
  if (accessError) return NextResponse.json({ error: "Não foi possível verificar sua permissão." }, { status: 503 });
  if (allowed !== true) return NextResponse.json({ error: "Você não possui acesso a Aluguéis." }, { status: 403 });
  const parsed = rentalCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Confira os campos obrigatórios e o código do imóvel no Qlik." }, { status: 400 });
  // The existing schema reserves inventory writes for the server. Authorize with
  // the user's session before using the privileged client and whitelist all fields.
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.from("rentals").insert({ ...parsed.data, created_by: auth.user.id, status: "desocupado", qlik_present: null, qlik_synced_at: null }).select("id").single();
  if (error?.code === "23505") return NextResponse.json({ error: "Este código do Qlik já está cadastrado. Localize o imóvel pelo código em Cadastro geral e abra sua ficha." }, { status: 409 });
  if (error || !data) return NextResponse.json({ error: "Não foi possível cadastrar o imóvel. Tente novamente." }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
