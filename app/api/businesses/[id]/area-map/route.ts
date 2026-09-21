import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { readBusinessGeometry, staticMapParameters } from "@/lib/business-map";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authorization = request.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const failure = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
  if (!authorization?.startsWith("Bearer ")) return failure("Entre no sistema para continuar.", 401);
  if (!url || !anon) return failure("Conexão indisponível.", 503);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return failure("Negócio inválido.", 400);
  const db = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const user = await db.auth.getUser(authorization.slice(7));
  if (user.error || !user.data.user) return failure("Sessão expirada.", 401);
  // The caller's token applies the same row permissions used by the business screen.
  const result = await db.from("businesses").select("latitude,longitude,location_file_path").eq("id", id).maybeSingle();
  if (result.error || !result.data) return failure("Negócio não encontrado ou sem acesso.", 404);
  const business = result.data;
  if (business.latitude === null || business.longitude === null) return failure("Adicione o KMZ para localizar a área.", 422);
  const key = process.env.GOOGLE_MAPS_STATIC_API_KEY;
  if (!key) return failure("Para incluir a imagem de satélite, envie uma imagem do Google Maps/Earth em Editar negócio. A captura automática ainda não está configurada.", 503);
  try {
    let geometry = null;
    if (business.location_file_path) {
      const file = await db.storage.from("business-locations").download(business.location_file_path);
      if (file.data) geometry = await readBusinessGeometry(file.data).catch(() => null);
    }
    const query = staticMapParameters(geometry, { latitude: Number(business.latitude), longitude: Number(business.longitude) });
    query.set("key", key);
    const map = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${query}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!map.ok || !map.headers.get("content-type")?.startsWith("image/") || map.headers.has("x-staticmap-api-warning")) {
      return failure("A imagem do Google não está disponível. Envie uma imagem da área em Editar negócio.", 502);
    }
    return new Response(await map.arrayBuffer(), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
  } catch {
    return failure("Não foi possível obter a imagem do Google. Tente novamente ou envie a imagem da área.", 502);
  }
}
