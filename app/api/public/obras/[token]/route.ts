import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tokenSchema = z.string().regex(/^[a-f0-9]{48}$/);
const updateSchema = z.object({
  client_submission_id: z.string().uuid(),
  micro_stage_id: z.string().uuid(),
  progress_percent: z.coerce.number().min(0).max(100),
  base_updated_at: z.string().datetime({ offset: true }),
  note: z.string().trim().max(1500).default(""),
  supplies: z.string().transform((value, context) => {
    try {
      return z.array(z.object({
        name: z.string().trim().min(1).max(140),
        total_value: z.coerce.number().min(0),
        total_quantity: z.coerce.number().min(0),
        used_quantity: z.coerce.number().min(0),
      })).parse(JSON.parse(value));
    } catch {
      context.addIssue({ code: "custom", message: "Insumos inválidos." });
      return z.NEVER;
    }
  }),
});

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function publicConstruction(token: string) {
  const service = serviceClient();
  if (!service) return { error: "Configuração do servidor indisponível.", status: 503 } as const;
  const { data: link, error } = await service
    .from("construction_public_links")
    .select("construction_id")
    .eq("token", token)
    .eq("active", true)
    .maybeSingle();
  if (error || !link) return { error: "Link inválido, desativado ou expirado.", status: 404 } as const;
  return { service, constructionId: link.construction_id } as const;
}

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!tokenSchema.safeParse(token).success) return NextResponse.json({ error: "Link inválido." }, { status: 404 });
  const access = await publicConstruction(token);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const [constructionResult, macroResult] = await Promise.all([
    access.service.from("construction_progress_summary").select("id,name,address,status,progress_percent,updated_at").eq("id", access.constructionId).single(),
    access.service.from("construction_macro_stage_progress").select("id,name,description,start_date,end_date,position,progress_percent").eq("construction_id", access.constructionId).order("position"),
  ]);
  if (constructionResult.error || macroResult.error) {
    return NextResponse.json({ error: "Não foi possível carregar esta obra." }, { status: 502 });
  }
  const macroIds = (macroResult.data || []).map((macro) => macro.id);
  const microResult = macroIds.length
    ? await access.service.from("construction_micro_stages").select("id,macro_stage_id,name,description,start_date,end_date,progress_percent,position,supplies,updated_at").in("macro_stage_id", macroIds).order("position")
    : { data: [], error: null };
  if (microResult.error) return NextResponse.json({ error: "Não foi possível carregar as microetapas." }, { status: 502 });

  return NextResponse.json({
    construction: constructionResult.data,
    stages: (macroResult.data || []).map((macro) => ({
      ...macro,
      micro_stages: (microResult.data || []).filter((micro) => micro.macro_stage_id === macro.id),
    })),
  });
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!tokenSchema.safeParse(token).success) return NextResponse.json({ error: "Link inválido." }, { status: 404 });
  const access = await publicConstruction(token);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Envio inválido." }, { status: 400 });
  const parsed = updateSchema.safeParse({
    client_submission_id: form.get("client_submission_id"),
    micro_stage_id: form.get("micro_stage_id"),
    progress_percent: form.get("progress_percent"),
    base_updated_at: form.get("base_updated_at"),
    note: form.get("note") || "",
    supplies: form.get("supplies") || "[]",
  });
  const photo = form.get("photo");
  if (!parsed.success || !(photo instanceof File) || photo.size === 0) {
    return NextResponse.json({ error: "Informe percentual, estoque e uma foto válida." }, { status: 400 });
  }
  if (photo.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(photo.type)) {
    return NextResponse.json({ error: "A foto deve ser JPG, PNG ou WEBP e ter até 10 MB." }, { status: 400 });
  }

  const { data: micro } = await access.service
    .from("construction_micro_stages")
    .select("id,macro_stage_id,updated_at,last_evidence_id,construction_macro_stages!inner(construction_id)")
    .eq("id", parsed.data.micro_stage_id)
    .eq("construction_macro_stages.construction_id", access.constructionId)
    .maybeSingle();
  if (!micro) return NextResponse.json({ error: "Microetapa não pertence a esta obra." }, { status: 403 });

  const existingResult = await access.service
    .from("construction_evidence")
    .select("id,construction_id,micro_stage_id,file_path,submission_completed_at")
    .eq("client_submission_id", parsed.data.client_submission_id)
    .maybeSingle();
  if (existingResult.error) return NextResponse.json({ error: "Não foi possível validar o envio." }, { status: 502 });
  let existingEvidence = existingResult.data;
  if (existingEvidence && (existingEvidence.construction_id !== access.constructionId || existingEvidence.micro_stage_id !== parsed.data.micro_stage_id)) {
    return NextResponse.json({ error: "Esta atualização já foi utilizada em outro registro.", code: "SUBMISSION_ID_REUSED" }, { status: 409 });
  }
  if (existingEvidence && (existingEvidence.submission_completed_at || existingEvidence.id === micro.last_evidence_id)) {
    if (!existingEvidence.submission_completed_at) {
      await access.service.from("construction_evidence").update({
        used_at: new Date().toISOString(),
        submission_completed_at: new Date().toISOString(),
      }).eq("id", existingEvidence.id);
    }
    return NextResponse.json({ ok: true, duplicate: true, micro_stage_updated_at: micro.updated_at });
  }

  if (new Date(parsed.data.base_updated_at).getTime() !== new Date(micro.updated_at).getTime()) {
    return NextResponse.json({
      error: "Esta microetapa foi alterada depois que a página ficou offline. Revise os dados antes de enviar.",
      code: "STALE_UPDATE",
      current_updated_at: micro.updated_at,
    }, { status: 409 });
  }

  const extension = photo.type === "image/png" ? "png" : photo.type === "image/webp" ? "webp" : "jpg";
  const filePath = `${access.constructionId}/public/${parsed.data.micro_stage_id}/${parsed.data.client_submission_id}.${extension}`;
  if (!existingEvidence) {
    const upload = await access.service.storage.from("construction-evidence").upload(filePath, photo, { contentType: photo.type, upsert: true });
    if (upload.error) return NextResponse.json({ error: "Não foi possível enviar a foto." }, { status: 502 });

    const evidence = await access.service.from("construction_evidence").insert({
      construction_id: access.constructionId,
      micro_stage_id: parsed.data.micro_stage_id,
      client_submission_id: parsed.data.client_submission_id,
      file_path: filePath,
      file_name: photo.name.slice(0, 240),
      note: parsed.data.note || null,
      uploaded_by: null,
      submission_source: "public_link",
    }).select("id,construction_id,micro_stage_id,file_path,submission_completed_at").single();
    if (evidence.error) {
      const duplicate = await access.service
        .from("construction_evidence")
        .select("id,construction_id,micro_stage_id,file_path,submission_completed_at")
        .eq("client_submission_id", parsed.data.client_submission_id)
        .maybeSingle();
      if (!duplicate.data) {
        await access.service.storage.from("construction-evidence").remove([filePath]);
        return NextResponse.json({ error: "Não foi possível registrar a evidência." }, { status: 502 });
      }
      existingEvidence = duplicate.data;
    } else {
      existingEvidence = evidence.data;
    }
  }

  const update = await access.service.from("construction_micro_stages").update({
    progress_percent: parsed.data.progress_percent,
    last_evidence_id: existingEvidence.id,
    supplies: parsed.data.supplies,
  })
    .eq("id", parsed.data.micro_stage_id)
    .eq("updated_at", micro.updated_at)
    .select("updated_at")
    .maybeSingle();
  if (update.error) {
    return NextResponse.json({ error: "Não foi possível atualizar o avanço." }, { status: 502 });
  }
  if (!update.data) {
    return NextResponse.json({
      error: "Esta microetapa foi alterada durante a sincronização. Revise os dados antes de enviar.",
      code: "STALE_UPDATE",
    }, { status: 409 });
  }

  await access.service.from("construction_evidence").update({
    used_at: new Date().toISOString(),
    submission_completed_at: new Date().toISOString(),
  }).eq("id", existingEvidence.id);

  return NextResponse.json({ ok: true, micro_stage_updated_at: update.data.updated_at });
}
