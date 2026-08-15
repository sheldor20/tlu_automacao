import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tokenSchema = z.string().regex(/^[a-f0-9]{48}$/);
const documentSchema = z.string().uuid();

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(_request: Request, context: { params: Promise<{ token: string; documentId: string }> }) {
  const { token, documentId } = await context.params;
  if (!tokenSchema.safeParse(token).success || !documentSchema.safeParse(documentId).success) return NextResponse.json({ error: "Documento inválido." }, { status: 404 });
  const service = serviceClient();
  if (!service) return NextResponse.json({ error: "Configuração do servidor indisponível." }, { status: 503 });
  const { data: link } = await service.from("construction_public_links").select("construction_id").eq("token", token).eq("active", true).maybeSingle();
  if (!link) return NextResponse.json({ error: "Link inválido ou desativado." }, { status: 404 });
  const { data: document } = await service.from("construction_plan_documents").select("file_path,file_name").eq("id", documentId).eq("construction_id", link.construction_id).eq("status", "approved").maybeSingle();
  if (!document) return NextResponse.json({ error: "Planta indisponível." }, { status: 404 });
  const downloaded = await service.storage.from("construction-plans").download(document.file_path);
  if (downloaded.error) return NextResponse.json({ error: "Não foi possível abrir a planta." }, { status: 502 });
  return new NextResponse(await downloaded.data.arrayBuffer(), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${document.file_name.replace(/["\\]/g, "-")}"`,
      "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
