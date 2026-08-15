"use client";

import { ConstructionPlanCanvas, type ConstructionPlanOverlay } from "@/components/construction-plan-canvas";
import { ProgressBar } from "@/components/ui";
import { calibrationMetersPerCoordinate, planProgressMetrics, type PlanPath } from "@/lib/construction-plan-geometry";
import { planCategoryLabel, planMeasure } from "@/lib/construction-plans";
import type { PublicWorkMicro, PublicWorkPlanDocument, PublicWorkPlanLayer, PublicWorkStage } from "@/lib/public-work-offline";
import { Camera, CheckCircle2, Map as MapIcon, PencilLine, Save, Undo2, Upload } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

export type PublicMapProgressInput = {
  layer: PublicWorkPlanLayer;
  micro: PublicWorkMicro;
  paths: PlanPath[];
  executedMeasure: number;
  progressPercent: number;
  note: string;
  photo: File;
};

export function PublicConstructionProgressMap({
  plans,
  stages,
  saving,
  onSubmit,
}: {
  plans: PublicWorkPlanDocument[];
  stages: PublicWorkStage[];
  saving: boolean;
  onSubmit(input: PublicMapProgressInput): Promise<void>;
}) {
  const [selectedPlanId, setSelectedPlanId] = useState(plans[0]?.id || "");
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) || plans[0] || null;
  const [selectedLayerId, setSelectedLayerId] = useState(selectedPlan?.layers[0]?.id || "");
  const selectedLayer = selectedPlan?.layers.find((layer) => layer.id === selectedLayerId) || selectedPlan?.layers[0] || null;
  const [drawing, setDrawing] = useState(false);
  const [paths, setPaths] = useState<PlanPath[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [resetKey, setResetKey] = useState(0);

  function resetDrawing() {
    setDrawing(false);
    setPaths([]);
    setPhoto(null);
    setNote("");
    setResetKey((value) => value + 1);
  }

  function selectPlan(plan: PublicWorkPlanDocument) {
    setSelectedPlanId(plan.id);
    setSelectedLayerId(plan.layers[0]?.id || "");
    resetDrawing();
  }

  function selectLayer(layerId: string) {
    setSelectedLayerId(layerId);
    resetDrawing();
  }

  const micro = useMemo(() => stages.flatMap((stage) => stage.micro_stages).find((item) => item.id === selectedLayer?.micro_stage_id) || null, [selectedLayer?.micro_stage_id, stages]);
  const metersPerCoordinate = selectedPlan ? calibrationMetersPerCoordinate(selectedPlan.calibration_points, selectedPlan.calibration_distance_m) : 0;
  const metrics = selectedLayer ? planProgressMetrics({
    plannedPaths: selectedLayer.planned_paths,
    executedPaths: [...selectedLayer.executed_paths, ...paths],
    measurementType: selectedLayer.measurement_type,
    metersPerCoordinate,
  }) : null;
  const overlays = useMemo<ConstructionPlanOverlay[]>(() => selectedPlan?.layers.map((layer) => ({
    id: layer.id,
    color: layer.color,
    measurementType: layer.measurement_type,
    plannedPaths: layer.planned_paths,
    executedPaths: layer.id === selectedLayer?.id ? [...layer.executed_paths, ...paths] : layer.executed_paths,
    active: layer.id === selectedLayer?.id,
  })) || [], [paths, selectedLayer?.id, selectedPlan]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedLayer || !micro || !metrics || !photo || !paths.length) return;
    await onSubmit({ layer: selectedLayer, micro, paths, executedMeasure: metrics.executedMeasure, progressPercent: metrics.progressPercent, note, photo });
    setPaths([]);
    setPhoto(null);
    setNote("");
    setDrawing(false);
  }

  if (!plans.length || !selectedPlan || !selectedLayer) return null;

  return <section className="public-map-module">
    <div className="public-map-head"><div><span><MapIcon size={16} /> Medição sobre projeto</span><h2>Mapa de avanço físico</h2><p>Selecione a infraestrutura e trace exatamente o trecho executado.</p></div><strong>{plans.length} prancha(s)</strong></div>
    <div className="public-map-plan-tabs">{plans.map((plan) => <button type="button" key={plan.id} className={plan.id === selectedPlan.id ? "active" : ""} onClick={() => selectPlan(plan)}><strong>{plan.name}</strong><span>{planCategoryLabel(plan.category)}</span></button>)}</div>
    <div className="public-map-layer-tabs">{selectedPlan.layers.map((layer) => <button type="button" key={layer.id} className={layer.id === selectedLayer.id ? "active" : ""} style={{ "--layer-color": layer.color } as React.CSSProperties} onClick={() => selectLayer(layer.id)}><i /><span>{layer.name}<small>{planMeasure(layer.executed_measure, layer.unit)} de {planMeasure(layer.planned_measure, layer.unit)}</small></span><strong>{Number(layer.progress_percent).toFixed(0)}%</strong></button>)}</div>
    <div className="public-map-summary"><div><span style={{ background: selectedLayer.color }} /><strong>{selectedLayer.name}</strong><small>{micro?.name || "Microetapa vinculada"}</small></div><div><span>Executado<strong>{planMeasure(metrics?.executedMeasure ?? selectedLayer.executed_measure, selectedLayer.unit)}</strong></span><span>Avanço<strong>{Number(metrics?.progressPercent ?? selectedLayer.progress_percent).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</strong></span></div></div>
    <ConstructionPlanCanvas documentUrl={selectedPlan.signed_url} pageNumber={selectedPlan.page_number} overlays={overlays} mode={drawing ? selectedLayer.measurement_type : "navigate"} drawingColor={selectedLayer.color} onFinishPath={(path) => setPaths((current) => [...current, path])} resetKey={resetKey} compact />
    <div className="public-map-actions"><div><strong>{drawing ? "Trace sobre a planta" : "Pronto para atualizar"}</strong><span>O sistema considera somente o que coincide com a base planejada.</span></div><button type="button" onClick={() => setDrawing(true)}><PencilLine size={16} /> Marcar executado</button><button type="button" disabled={!paths.length} onClick={() => { setPaths((current) => current.slice(0, -1)); setResetKey((value) => value + 1); }}><Undo2 size={16} /> Desfazer</button></div>
    {paths.length ? <form className="public-map-confirm" onSubmit={submit}><div><CheckCircle2 size={19} /><span><strong>{paths.length} traçado(s) pronto(s)</strong>O avanço passará para {metrics?.progressPercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% após a sincronização.</span></div><label><span>Foto obrigatória</span><div className="file-drop"><Upload size={19} /><b>{photo?.name || "Selecionar foto"}</b><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => setPhoto(event.target.files?.[0] || null)} required /></div></label><label><span>Comentário</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1500} placeholder="Descreva o serviço executado" /></label><button type="submit" className="button button-primary" disabled={saving || !photo}><Save size={16} /> {saving ? "Salvando…" : "Salvar medição"}</button></form> : null}
    <ProgressBar value={metrics?.progressPercent ?? selectedLayer.progress_percent} label={`Avanço medido · ${selectedLayer.name}`} />
    <div className="public-map-hint"><Camera size={15} /> O mapa, a foto e o comentário ficam salvos juntos no histórico da obra.</div>
  </section>;
}
