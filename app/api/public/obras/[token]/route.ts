import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { calibrationMetersPerCoordinate, planProgressMetrics, validPlanPaths, type PlanPath } from "@/lib/construction-plan-geometry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tokenSchema = z.string().regex(/^[a-f0-9]{48}$/);
type MapLayerRow = {
  id: string;
  document_id: string;
  micro_stage_id: string;
  measurement_type: "linear" | "area";
  planned_paths: PlanPath[];
  executed_paths: PlanPath[];
  planned_measure: number;
  updated_at: string;
};
type MapDocumentRow = {
  calibration_points: Array<{ x: number; y: number }>;
  calibration_distance_m: number;
  status: string;
};
type MapApplyRow = {
  layer_updated_at: string;
  micro_stage_updated_at: string;
  progress_percent: number;
  executed_measure: number;
};
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
  map_layer_id: z.string().uuid().optional(),
  map_base_updated_at: z.string().datetime({ offset: true }).optional(),
  map_paths: z.string().optional().transform((value, context) => {
    if (!value) return undefined;
    try {
      const paths = JSON.parse(value) as unknown;
      if (!validPlanPaths(paths)) throw new Error("invalid_paths");
      return paths;
    } catch {
      context.addIssue({ code: "custom", message: "Traçado do mapa inválido." });
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

  const [constructionResult, macroResult, planResult] = await Promise.all([
    access.service.from("construction_progress_summary").select("id,name,address,status,progress_percent,updated_at").eq("id", access.constructionId).single(),
    access.service.from("construction_macro_stage_progress").select("id,name,description,start_date,end_date,position,progress_percent").eq("construction_id", access.constructionId).order("position"),
    access.service.from("construction_plan_documents").select("id,name,category,file_path,page_number,page_aspect_ratio,calibration_points,calibration_distance_m").eq("construction_id", access.constructionId).eq("status", "approved").order("created_at"),
  ]);
  if (constructionResult.error || macroResult.error || planResult.error) {
    return NextResponse.json({ error: "Não foi possível carregar esta obra." }, { status: 502 });
  }
  const macroIds = (macroResult.data || []).map((macro) => macro.id);
  const microResult = macroIds.length
    ? await access.service.from("construction_micro_stages").select("id,macro_stage_id,name,description,start_date,end_date,progress_percent,position,supplies,updated_at").in("macro_stage_id", macroIds).order("position")
    : { data: [], error: null };
  if (microResult.error) return NextResponse.json({ error: "Não foi possível carregar as microetapas." }, { status: 502 });
  const planIds = (planResult.data || []).map((plan) => plan.id);
  const layerResult = planIds.length
    ? await access.service.from("construction_plan_layers").select("id,document_id,construction_id,micro_stage_id,name,discipline,measurement_type,unit,color,planned_paths,executed_paths,planned_measure,executed_measure,progress_percent,updated_at").in("document_id", planIds).order("created_at")
    : { data: [], error: null };
  if (layerResult.error) return NextResponse.json({ error: "Não foi possível carregar as medições da obra." }, { status: 502 });
  const signedPlans = (planResult.data || []).map((plan) => {
    return {
      id: plan.id,
      name: plan.name,
      category: plan.category,
      page_number: plan.page_number,
      page_aspect_ratio: plan.page_aspect_ratio,
      calibration_points: plan.calibration_points,
      calibration_distance_m: plan.calibration_distance_m,
      signed_url: `/api/public/obras/${token}/plans/${plan.id}`,
      layers: (layerResult.data || []).filter((layer) => layer.document_id === plan.id),
    };
  });

  return NextResponse.json({
    construction: constructionResult.data,
    stages: (macroResult.data || []).map((macro) => ({
      ...macro,
      micro_stages: (microResult.data || []).filter((micro) => micro.macro_stage_id === macro.id),
    })),
    plans: signedPlans.filter(Boolean),
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
    map_layer_id: form.get("map_layer_id") || undefined,
    map_base_updated_at: form.get("map_base_updated_at") || undefined,
    map_paths: form.get("map_paths") || undefined,
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

  const isMapSubmission = Boolean(parsed.data.map_layer_id || parsed.data.map_base_updated_at || parsed.data.map_paths);
  if (isMapSubmission && (!parsed.data.map_layer_id || !parsed.data.map_base_updated_at || !parsed.data.map_paths?.length)) {
    return NextResponse.json({ error: "Informe a camada, a versão da base e o traçado executado." }, { status: 400 });
  }
  let mapLayer: MapLayerRow | null = null;
  let mapDocument: MapDocumentRow | null = null;
  if (isMapSubmission) {
    const layerResult = await access.service.from("construction_plan_layers").select("id,document_id,micro_stage_id,measurement_type,planned_paths,executed_paths,planned_measure,updated_at").eq("id", parsed.data.map_layer_id!).eq("construction_id", access.constructionId).maybeSingle();
    mapLayer = layerResult.data as MapLayerRow | null;
    if (layerResult.error || !mapLayer || mapLayer.micro_stage_id !== parsed.data.micro_stage_id) return NextResponse.json({ error: "Camada de medição inválida." }, { status: 403 });
    if (mapLayer.measurement_type === "area" && parsed.data.map_paths!.some((path) => path.length < 3)) {
      return NextResponse.json({ error: "Contorne a área executada com pelo menos três pontos." }, { status: 400 });
    }
    const documentResult = await access.service.from("construction_plan_documents").select("calibration_points,calibration_distance_m,status").eq("id", mapLayer.document_id).eq("construction_id", access.constructionId).maybeSingle();
    mapDocument = documentResult.data as MapDocumentRow | null;
    if (documentResult.error || !mapDocument || mapDocument.status !== "approved") return NextResponse.json({ error: "A base de medição não está aprovada." }, { status: 409 });
    if (new Date(parsed.data.map_base_updated_at!).getTime() !== new Date(mapLayer.updated_at).getTime()) {
      return NextResponse.json({ error: "O mapa recebeu outra atualização. Revise o traçado antes de enviar.", code: "STALE_MAP_LAYER", current_updated_at: mapLayer.updated_at }, { status: 409 });
    }
  }

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
    return NextResponse.json({ ok: true, duplicate: true, micro_stage_updated_at: micro.updated_at, map_layer_updated_at: mapLayer?.updated_at });
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

  if (isMapSubmission && mapLayer && mapDocument) {
    const executedPaths = [...(mapLayer.executed_paths || []), ...(parsed.data.map_paths || [])];
    const metersPerCoordinate = calibrationMetersPerCoordinate(mapDocument.calibration_points, Number(mapDocument.calibration_distance_m));
    const metrics = planProgressMetrics({
      plannedPaths: mapLayer.planned_paths,
      executedPaths,
      measurementType: mapLayer.measurement_type,
      metersPerCoordinate,
    });
    const applied = await access.service.rpc("apply_construction_plan_progress", {
      p_layer_id: mapLayer.id,
      p_evidence_id: existingEvidence.id,
      p_base_layer_updated_at: mapLayer.updated_at,
      p_base_micro_updated_at: micro.updated_at,
      p_executed_paths: executedPaths,
      p_added_paths: parsed.data.map_paths,
      p_executed_measure: metrics.executedMeasure,
      p_progress_percent: metrics.progressPercent,
      p_note: parsed.data.note,
      p_submission_source: "public_link",
    }).single();
    if (applied.error) {
      const stale = /stale_(map_layer|micro_stage)/i.test(applied.error.message);
      await access.service.from("construction_evidence").delete().eq("id", existingEvidence.id);
      await access.service.storage.from("construction-evidence").remove([existingEvidence.file_path]);
      return NextResponse.json({ error: stale ? "A obra foi atualizada durante a sincronização. Revise o traçado." : "Não foi possível consolidar a medição no mapa.", code: stale ? "STALE_UPDATE" : "MAP_UPDATE_FAILED" }, { status: stale ? 409 : 502 });
    }
    const appliedRow = applied.data as MapApplyRow;
    return NextResponse.json({
      ok: true,
      micro_stage_updated_at: appliedRow.micro_stage_updated_at,
      map_layer_updated_at: appliedRow.layer_updated_at,
      map_executed_measure: appliedRow.executed_measure,
      map_progress_percent: appliedRow.progress_percent,
    });
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
