"use client";

import { ConstructionPlanCanvas, type ConstructionPlanOverlay } from "@/components/construction-plan-canvas";
import { Button, Dialog, EmptyState, Field, ProgressBar, StatusPill } from "@/components/ui";
import {
  calibrationMetersPerCoordinate,
  planProgressMetrics,
  type PlanPath,
  type PlanPoint,
} from "@/lib/construction-plan-geometry";
import {
  CONSTRUCTION_PLAN_CATEGORIES,
  CONSTRUCTION_PLAN_DISCIPLINES,
  constructionPlanStoragePath,
  planCategoryLabel,
  planDisciplineLabel,
  planMeasure,
} from "@/lib/construction-plans";
import { dateBr } from "@/lib/format";
import { friendlyError, getSupabase, storagePath } from "@/lib/supabase";
import type {
  Construction,
  ConstructionPlanCategory,
  ConstructionPlanDiscipline,
  ConstructionPlanDocument,
  ConstructionPlanLayer,
  MacroStage,
} from "@/lib/types";
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  ImagePlus,
  Map as MapIcon,
  PencilLine,
  Plus,
  RotateCcw,
  Ruler,
  Save,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type DrawingMode = "navigate" | "calibrate" | "linear" | "area";

const emptyUpload = { name: "", category: "urbanistico" as ConstructionPlanCategory, file: null as File | null };

export function ConstructionProgressMap({
  construction,
  macros,
  onChanged,
}: {
  construction: Construction;
  macros: MacroStage[];
  onChanged(): Promise<void>;
}) {
  const supabase = getSupabase();
  const micros = useMemo(() => macros.flatMap((macro) => (macro.micro_stages || []).map((micro) => ({ ...micro, macroName: macro.name }))), [macros]);
  const [documents, setDocuments] = useState<ConstructionPlanDocument[]>([]);
  const [layers, setLayers] = useState<ConstructionPlanLayer[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [layerOpen, setLayerOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState(emptyUpload);
  const [layerForm, setLayerForm] = useState({
    name: "",
    discipline: "vias_asfalto" as ConstructionPlanDiscipline,
    measurement_type: "linear" as ConstructionPlanLayer["measurement_type"],
    micro_stage_id: "",
    color: "#b7655b",
  });
  const [mode, setMode] = useState<DrawingMode>("navigate");
  const [resetKey, setResetKey] = useState(0);
  const [pageAspectRatio, setPageAspectRatio] = useState(0.65);
  const [calibrationPoints, setCalibrationPoints] = useState<PlanPoint[]>([]);
  const [calibrationDistance, setCalibrationDistance] = useState("");
  const [plannedDraft, setPlannedDraft] = useState<PlanPath[]>([]);
  const [progressPaths, setProgressPaths] = useState<PlanPath[]>([]);
  const [progressNote, setProgressNote] = useState("");
  const [progressPhoto, setProgressPhoto] = useState<File | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [documentResult, layerResult] = await Promise.all([
      supabase.from("construction_plan_documents").select("*").eq("construction_id", construction.id).order("created_at"),
      supabase.from("construction_plan_layers").select("*").eq("construction_id", construction.id).order("created_at"),
    ]);
    if (documentResult.error || layerResult.error) {
      setMessage({ text: friendlyError(documentResult.error || layerResult.error), error: true });
      setLoading(false);
      return;
    }
    const signed = await Promise.all(((documentResult.data || []) as ConstructionPlanDocument[]).map(async (document) => {
      const result = await supabase.storage.from("construction-plans").createSignedUrl(document.file_path, 3600);
      return { ...document, signed_url: result.data?.signedUrl };
    }));
    const layerRows = ((layerResult.data || []) as ConstructionPlanLayer[]).map((layer) => ({
      ...layer,
      micro_stage: micros.find((micro) => micro.id === layer.micro_stage_id),
    }));
    setDocuments(signed);
    setLayers(layerRows);
    setSelectedDocumentId((current) => current && signed.some((document) => document.id === current) ? current : signed[0]?.id || null);
    setSelectedLayerId((current) => current && layerRows.some((layer) => layer.id === current) ? current : layerRows[0]?.id || null);
    setLoading(false);
  }, [construction.id, micros, supabase]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const selectedDocument = useMemo(() => documents.find((document) => document.id === selectedDocumentId) || null, [documents, selectedDocumentId]);
  const documentLayers = useMemo(() => layers.filter((layer) => layer.document_id === selectedDocumentId), [layers, selectedDocumentId]);
  const selectedLayer = useMemo(() => documentLayers.find((layer) => layer.id === selectedLayerId) || documentLayers[0] || null, [documentLayers, selectedLayerId]);

  useEffect(() => {
    if (!selectedDocument) return;
    const timeout = window.setTimeout(() => {
      setCalibrationPoints(selectedDocument.calibration_points || []);
      setCalibrationDistance(selectedDocument.calibration_distance_m ? String(selectedDocument.calibration_distance_m) : "");
      setPageAspectRatio(Number(selectedDocument.page_aspect_ratio || 0.65));
      setMode("navigate");
      setProgressPaths([]);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [selectedDocument]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSelectedLayerId((current) => current && documentLayers.some((layer) => layer.id === current) ? current : documentLayers[0]?.id || null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [documentLayers]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPlannedDraft(selectedLayer ? (selectedLayer.planned_paths || []).map((path) => path.map((point) => ({ ...point }))) : []);
      setProgressPaths([]);
      setProgressPhoto(null);
      setProgressNote("");
      setMode("navigate");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [selectedLayer]);

  const metersPerCoordinate = useMemo(() => calibrationMetersPerCoordinate(calibrationPoints, Number(calibrationDistance || 0)), [calibrationDistance, calibrationPoints]);
  const overlays = useMemo<ConstructionPlanOverlay[]>(() => documentLayers.map((layer) => ({
    id: layer.id,
    color: layer.color,
    measurementType: layer.measurement_type,
    plannedPaths: layer.id === selectedLayer?.id && selectedDocument?.status === "draft" ? plannedDraft : layer.planned_paths,
    executedPaths: layer.id === selectedLayer?.id ? [...layer.executed_paths, ...progressPaths] : layer.executed_paths,
    active: layer.id === selectedLayer?.id,
  })), [documentLayers, plannedDraft, progressPaths, selectedDocument?.status, selectedLayer?.id]);

  const previewMetrics = useMemo(() => {
    if (!selectedLayer || !metersPerCoordinate) return null;
    return planProgressMetrics({
      plannedPaths: selectedDocument?.status === "draft" ? plannedDraft : selectedLayer.planned_paths,
      executedPaths: [...selectedLayer.executed_paths, ...progressPaths],
      measurementType: selectedLayer.measurement_type,
      metersPerCoordinate,
    });
  }, [metersPerCoordinate, plannedDraft, progressPaths, selectedDocument?.status, selectedLayer]);

  async function uploadDocument(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !uploadForm.file) return;
    if (uploadForm.file.type !== "application/pdf" && !uploadForm.file.name.toLocaleLowerCase().endsWith(".pdf")) return setMessage({ text: "Selecione um arquivo PDF.", error: true });
    if (uploadForm.file.size > 50 * 1024 * 1024) return setMessage({ text: "O PDF deve ter até 50 MB.", error: true });
    setSaving(true);
    const documentId = crypto.randomUUID();
    const filePath = constructionPlanStoragePath(documentId, uploadForm.file.name);
    const insert = await supabase.from("construction_plan_documents").insert({
      id: documentId,
      business_id: construction.source_business_id,
      construction_id: construction.id,
      name: uploadForm.name.trim(),
      category: uploadForm.category,
      file_path: filePath,
      file_name: uploadForm.file.name.slice(0, 240),
      mime_type: "application/pdf",
    });
    if (insert.error) {
      setSaving(false);
      return setMessage({ text: friendlyError(insert.error), error: true });
    }
    const upload = await supabase.storage.from("construction-plans").upload(filePath, uploadForm.file, { contentType: "application/pdf", upsert: false });
    if (upload.error) {
      await supabase.from("construction_plan_documents").delete().eq("id", documentId);
      setSaving(false);
      return setMessage({ text: friendlyError(upload.error), error: true });
    }
    setUploadForm(emptyUpload);
    setUploadOpen(false);
    setSelectedDocumentId(documentId);
    setMessage({ text: "Planta enviada. Faça a calibração antes de criar as camadas." });
    setSaving(false);
    await load();
  }

  async function deleteDocument(document: ConstructionPlanDocument) {
    const hasProgress = layers.some((layer) => layer.document_id === document.id && Number(layer.executed_measure || 0) > 0);
    if (!supabase || document.status === "approved" || hasProgress || !window.confirm(`Excluir “${document.name}” e suas camadas ainda não executadas?`)) return;
    setSaving(true);
    const result = await supabase.from("construction_plan_documents").delete().eq("id", document.id).eq("status", "draft");
    if (!result.error) await supabase.storage.from("construction-plans").remove([document.file_path]);
    setSaving(false);
    if (result.error) return setMessage({ text: friendlyError(result.error), error: true });
    setMessage({ text: "Planta excluída." });
    await load();
  }

  function addCalibrationPoint(point: PlanPoint) {
    setCalibrationPoints((current) => current.length >= 2 ? [point] : [...current, point]);
  }

  async function saveCalibration() {
    if (!supabase || !selectedDocument || calibrationPoints.length !== 2 || Number(calibrationDistance) <= 0) return;
    setSaving(true);
    const result = await supabase.from("construction_plan_documents").update({
      calibration_points: calibrationPoints,
      calibration_distance_m: Number(calibrationDistance),
      page_aspect_ratio: pageAspectRatio,
    }).eq("id", selectedDocument.id).eq("status", "draft");
    setSaving(false);
    if (result.error) return setMessage({ text: friendlyError(result.error), error: true });
    setMode("navigate");
    setMessage({ text: "Escala calibrada. Agora desenhe os totais previstos de cada camada." });
    await load();
  }

  function openLayerDialog() {
    const discipline = CONSTRUCTION_PLAN_DISCIPLINES[0];
    setLayerForm({ name: discipline.label, discipline: discipline.value, measurement_type: discipline.measurementType, micro_stage_id: "", color: discipline.color });
    setLayerOpen(true);
  }

  async function addLayer(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !selectedDocument) return;
    setSaving(true);
    const result = await supabase.from("construction_plan_layers").insert({
      document_id: selectedDocument.id,
      construction_id: construction.id,
      micro_stage_id: layerForm.micro_stage_id,
      name: layerForm.name.trim(),
      discipline: layerForm.discipline,
      measurement_type: layerForm.measurement_type,
      unit: layerForm.measurement_type === "area" ? "m2" : "m",
      color: layerForm.color,
    }).select("id").single();
    setSaving(false);
    if (result.error) return setMessage({ text: friendlyError(result.error), error: true });
    setSelectedLayerId(result.data.id);
    setLayerOpen(false);
    setMessage({ text: "Camada criada. Trace sobre a planta todo o escopo previsto." });
    await load();
  }

  async function deleteLayer(layer: ConstructionPlanLayer) {
    if (!supabase || Number(layer.executed_measure || 0) > 0 || !window.confirm(`Excluir a camada “${layer.name}”?`)) return;
    setSaving(true);
    const result = await supabase.from("construction_plan_layers").delete().eq("id", layer.id).eq("executed_measure", 0);
    setSaving(false);
    if (result.error) return setMessage({ text: friendlyError(result.error), error: true });
    setMessage({ text: "Camada excluída." });
    await load();
  }

  async function savePlannedBase() {
    if (!supabase || !selectedLayer || !previewMetrics || !plannedDraft.length) return;
    setSaving(true);
    const result = await supabase.from("construction_plan_layers").update({
      planned_paths: plannedDraft,
      planned_measure: previewMetrics.plannedMeasure,
      executed_measure: previewMetrics.executedMeasure,
      progress_percent: previewMetrics.progressPercent,
    }).eq("id", selectedLayer.id);
    setSaving(false);
    if (result.error) return setMessage({ text: friendlyError(result.error), error: true });
    setMode("navigate");
    setMessage({ text: `Base salva: ${planMeasure(previewMetrics.plannedMeasure, selectedLayer.unit)} previstos.` });
    await load();
  }

  async function changeApproval(status: ConstructionPlanDocument["status"]) {
    if (!supabase || !selectedDocument) return;
    if (status === "approved" && (!metersPerCoordinate || !documentLayers.length || documentLayers.some((layer) => Number(layer.planned_measure || 0) <= 0))) {
      return setMessage({ text: "Calibre a planta e salve o total previsto de todas as camadas antes de aprovar.", error: true });
    }
    setSaving(true);
    const result = await supabase.from("construction_plan_documents").update({ status }).eq("id", selectedDocument.id);
    setSaving(false);
    if (result.error) return setMessage({ text: friendlyError(result.error), error: true });
    setMode("navigate");
    setMessage({ text: status === "approved" ? "Base aprovada. As medições de campo estão liberadas." : "Base reaberta para ajustes. O avanço já registrado foi preservado." });
    await load();
  }

  async function saveProgress(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !selectedDocument || !selectedLayer || !previewMetrics || !progressPhoto || !progressPaths.length || !selectedLayer.micro_stage) return;
    setSaving(true);
    const path = storagePath(construction.id, progressPhoto.name, selectedLayer.micro_stage_id);
    const upload = await supabase.storage.from("construction-evidence").upload(path, progressPhoto, { cacheControl: "3600", upsert: false });
    if (upload.error) {
      setSaving(false);
      return setMessage({ text: friendlyError(upload.error), error: true });
    }
    const evidence = await supabase.from("construction_evidence").insert({
      construction_id: construction.id,
      micro_stage_id: selectedLayer.micro_stage_id,
      file_path: path,
      file_name: progressPhoto.name.slice(0, 240),
      note: progressNote.trim() || null,
      submission_source: "authenticated",
    }).select("id").single();
    if (evidence.error) {
      await supabase.storage.from("construction-evidence").remove([path]);
      setSaving(false);
      return setMessage({ text: friendlyError(evidence.error), error: true });
    }
    const executedPaths = [...selectedLayer.executed_paths, ...progressPaths];
    const result = await supabase.rpc("apply_construction_plan_progress", {
      p_layer_id: selectedLayer.id,
      p_evidence_id: evidence.data.id,
      p_base_layer_updated_at: selectedLayer.updated_at,
      p_base_micro_updated_at: selectedLayer.micro_stage.updated_at,
      p_executed_paths: executedPaths,
      p_added_paths: progressPaths,
      p_executed_measure: previewMetrics.executedMeasure,
      p_progress_percent: previewMetrics.progressPercent,
      p_note: progressNote,
      p_submission_source: "authenticated",
    });
    if (result.error) {
      await supabase.from("construction_evidence").delete().eq("id", evidence.data.id);
      await supabase.storage.from("construction-evidence").remove([path]);
      setSaving(false);
      return setMessage({ text: friendlyError(result.error), error: true });
    }
    setSaving(false);
    setMode("navigate");
    setProgressPaths([]);
    setProgressNote("");
    setProgressPhoto(null);
    setMessage({ text: `Execução registrada: ${planMeasure(previewMetrics.executedMeasure, selectedLayer.unit)} · ${previewMetrics.progressPercent.toLocaleString("pt-BR")}%.` });
    await Promise.all([load(), onChanged()]);
  }

  function finishPath(path: PlanPath) {
    if (!selectedLayer) return;
    if (selectedDocument?.status === "draft") setPlannedDraft((current) => [...current, path]);
    else setProgressPaths((current) => [...current, path]);
  }

  function undoLastPath() {
    if (selectedDocument?.status === "draft") setPlannedDraft((current) => current.slice(0, -1));
    else setProgressPaths((current) => current.slice(0, -1));
    setResetKey((value) => value + 1);
  }

  if (loading) return <section className="content-card detail-tab-panel"><div className="plan-module-loading">Carregando plantas da obra…</div></section>;

  return <section className="content-card detail-tab-panel construction-plan-module">
    <div className="content-card-head"><div><h2>Mapa de avanço físico</h2><p>Calibre a prancha, defina o escopo previsto e trace o que foi executado em campo.</p></div><Button variant="secondary" onClick={() => setUploadOpen(true)}><Upload size={16} /> Enviar planta</Button></div>
    {message ? <div className={`construction-plan-message ${message.error ? "error" : "success"}`}>{message.error ? null : <CheckCircle2 size={17} />}{message.text}</div> : null}
    {!documents.length ? <EmptyState icon={<MapIcon size={24} />} title="Nenhuma planta vinculada" description="Envie um PDF aqui ou adicione o documento em Novos Negócios antes de transformar a oportunidade em obra." action={<Button onClick={() => setUploadOpen(true)}><Upload size={16} /> Enviar primeira planta</Button>} /> : <div className="construction-plan-workspace">
      <aside className="construction-plan-sidebar">
        <div className="plan-sidebar-section"><span>Pranchas</span>{documents.map((document) => <button type="button" key={document.id} className={document.id === selectedDocumentId ? "active" : ""} onClick={() => setSelectedDocumentId(document.id)}><FileText size={17} /><div><strong>{document.name}</strong><small>{planCategoryLabel(document.category)}</small></div><StatusPill tone={document.status === "approved" ? "success" : "neutral"}>{document.status === "approved" ? "Aprovada" : "Base"}</StatusPill></button>)}</div>
        {selectedDocument ? <div className="plan-sidebar-section"><div className="plan-sidebar-title"><span>Camadas de medição</span>{selectedDocument.status === "draft" ? <button type="button" onClick={openLayerDialog} title="Adicionar camada"><Plus size={15} /></button> : null}</div>{documentLayers.length ? documentLayers.map((layer) => <button type="button" key={layer.id} className={layer.id === selectedLayer?.id ? "active" : ""} onClick={() => setSelectedLayerId(layer.id)}><i style={{ background: layer.color }} /><div><strong>{layer.name}</strong><small>{planMeasure(layer.executed_measure, layer.unit)} / {planMeasure(layer.planned_measure, layer.unit)}</small></div><b>{Number(layer.progress_percent).toFixed(0)}%</b></button>) : <small className="plan-sidebar-empty">Crie uma camada e vincule-a à microetapa correspondente.</small>}</div> : null}
      </aside>
      {selectedDocument?.signed_url ? <div className="construction-plan-main">
        <div className="construction-plan-context"><div><StatusPill tone={selectedDocument.status === "approved" ? "success" : "warning"}>{selectedDocument.status === "approved" ? "Medição liberada" : "Preparação da base"}</StatusPill><strong>{selectedDocument.name}</strong><span>{dateBr(selectedDocument.created_at)} · página {selectedDocument.page_number}</span></div><div>{selectedDocument.signed_url ? <a href={selectedDocument.signed_url} target="_blank" rel="noreferrer"><ExternalLink size={15} /> PDF original</a> : null}{selectedDocument.status === "approved" ? <Button variant="ghost" onClick={() => void changeApproval("draft")} disabled={saving}><RotateCcw size={15} /> Reabrir base</Button> : <Button onClick={() => void changeApproval("approved")} disabled={saving || !documentLayers.length}><CheckCircle2 size={15} /> Aprovar base</Button>}<button type="button" className="plan-delete-document" disabled={selectedDocument.status === "approved" || saving} onClick={() => void deleteDocument(selectedDocument)}><Trash2 size={15} /></button></div></div>
        {selectedDocument.status === "draft" && (!selectedDocument.calibration_distance_m || mode === "calibrate") ? <div className="plan-calibration-panel"><div><Ruler size={20} /><span><strong>1. Calibrar escala</strong>Marque dois pontos de uma medida conhecida na planta e informe a distância real.</span></div><Field label="Distância real (m)"><input type="number" min="0.01" step="0.01" value={calibrationDistance} onChange={(event) => setCalibrationDistance(event.target.value)} /></Field><Button variant="secondary" onClick={() => { setCalibrationPoints([]); setMode("calibrate"); setResetKey((value) => value + 1); }}><PencilLine size={15} /> {calibrationPoints.length ? "Marcar novamente" : "Marcar pontos"}</Button><Button onClick={() => void saveCalibration()} loading={saving} disabled={calibrationPoints.length !== 2 || Number(calibrationDistance) <= 0}><Save size={15} /> Salvar escala</Button></div> : null}
        {selectedLayer ? <div className="plan-layer-summary"><div><i style={{ background: selectedLayer.color }} /><span><strong>{selectedLayer.name}</strong>{planDisciplineLabel(selectedLayer.discipline)} · {selectedLayer.micro_stage?.name || "Microetapa não encontrada"}</span></div><div><span>Previsto<strong>{planMeasure(previewMetrics?.plannedMeasure ?? selectedLayer.planned_measure, selectedLayer.unit)}</strong></span><span>Executado<strong>{planMeasure(previewMetrics?.executedMeasure ?? selectedLayer.executed_measure, selectedLayer.unit)}</strong></span><span>Avanço<strong>{Number(previewMetrics?.progressPercent ?? selectedLayer.progress_percent).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</strong></span></div></div> : null}
        <ConstructionPlanCanvas documentUrl={selectedDocument.signed_url} pageNumber={selectedDocument.page_number} overlays={overlays} mode={mode} drawingColor={selectedLayer?.color} calibrationPoints={calibrationPoints} onCalibrationPoint={addCalibrationPoint} onFinishPath={finishPath} onAspectRatio={setPageAspectRatio} resetKey={resetKey} />
        {selectedLayer ? <div className="construction-plan-actions">
          {selectedDocument.status === "draft" ? <><div><span>2. Desenhar total previsto</span><small>{selectedLayer.measurement_type === "area" ? "Contorne uma ou mais áreas." : "Trace um ou mais eixos sobre o projeto."}</small></div><Button variant="secondary" onClick={() => setMode(selectedLayer.measurement_type)} disabled={!metersPerCoordinate}><PencilLine size={15} /> Desenhar {selectedLayer.measurement_type === "area" ? "área" : "trecho"}</Button><Button variant="ghost" onClick={undoLastPath} disabled={!plannedDraft.length}><Undo2 size={15} /> Desfazer</Button><Button onClick={() => void savePlannedBase()} loading={saving} disabled={!plannedDraft.length || !metersPerCoordinate}><Save size={15} /> Salvar total</Button><button type="button" className="plan-delete-layer" disabled={Number(selectedLayer.executed_measure || 0) > 0 || saving} onClick={() => void deleteLayer(selectedLayer)}><Trash2 size={15} /> Excluir camada</button></> : <><div><span>Atualização de campo</span><small>O traçado é encaixado ao total planejado e não conta sobreposições duas vezes.</small></div><Button variant="secondary" onClick={() => setMode(selectedLayer.measurement_type)}><PencilLine size={15} /> Marcar executado</Button><Button variant="ghost" onClick={undoLastPath} disabled={!progressPaths.length}><Undo2 size={15} /> Desfazer</Button></>}
        </div> : null}
        {selectedDocument.status === "approved" && selectedLayer && progressPaths.length ? <form className="plan-progress-submit" onSubmit={saveProgress}><div><strong>Confirmar medição</strong><span>{progressPaths.length} novo(s) traçado(s) · avanço calculado em {previewMetrics?.progressPercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span></div><Field label="Evidência fotográfica"><label className="file-drop"><ImagePlus size={18} /><span>{progressPhoto?.name || "Selecionar foto"}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setProgressPhoto(event.target.files?.[0] || null)} required /></label></Field><Field label="Comentário"><textarea value={progressNote} onChange={(event) => setProgressNote(event.target.value)} maxLength={1500} placeholder="Descreva o serviço executado" /></Field><Button type="submit" loading={saving} disabled={!progressPhoto}><Save size={16} /> Registrar avanço</Button></form> : null}
        {selectedLayer ? <ProgressBar value={Number(previewMetrics?.progressPercent ?? selectedLayer.progress_percent)} label={`Avanço medido · ${selectedLayer.name}`} /> : null}
      </div> : <div className="mini-empty">Não foi possível gerar o acesso temporário ao PDF.</div>}
    </div>}

    <Dialog open={uploadOpen} onClose={() => setUploadOpen(false)} title="Enviar planta técnica" description="O PDF fica privado e disponível apenas para usuários autorizados e no link de campo desta obra." wide><form className="form-grid" onSubmit={uploadDocument}><Field label="Nome"><input value={uploadForm.name} onChange={(event) => setUploadForm({ ...uploadForm, name: event.target.value })} required maxLength={160} /></Field><Field label="Tipo"><select value={uploadForm.category} onChange={(event) => setUploadForm({ ...uploadForm, category: event.target.value as ConstructionPlanCategory })}>{CONSTRUCTION_PLAN_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field><Field label="PDF" className="form-span-2"><label className="file-drop"><Upload size={20} /><span>{uploadForm.file?.name || "Selecionar PDF"}</span><input type="file" accept="application/pdf,.pdf" onChange={(event) => setUploadForm({ ...uploadForm, file: event.target.files?.[0] || null })} required /></label></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setUploadOpen(false)}>Cancelar</Button><Button type="submit" loading={saving} disabled={!uploadForm.file}>Enviar planta</Button></div></form></Dialog>

    <Dialog open={layerOpen} onClose={() => setLayerOpen(false)} title="Nova camada de medição" description="Cada camada controla automaticamente uma microetapa da obra." wide><form className="form-grid" onSubmit={addLayer}><Field label="Disciplina"><select value={layerForm.discipline} onChange={(event) => { const discipline = CONSTRUCTION_PLAN_DISCIPLINES.find((item) => item.value === event.target.value)!; setLayerForm({ ...layerForm, discipline: discipline.value, name: discipline.label, measurement_type: discipline.measurementType, color: discipline.color }); }}>{CONSTRUCTION_PLAN_DISCIPLINES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field><Field label="Nome da camada"><input value={layerForm.name} onChange={(event) => setLayerForm({ ...layerForm, name: event.target.value })} required maxLength={140} /></Field><Field label="Forma de medição"><select value={layerForm.measurement_type} onChange={(event) => setLayerForm({ ...layerForm, measurement_type: event.target.value as ConstructionPlanLayer["measurement_type"] })}><option value="linear">Metros lineares</option><option value="area">Área em m²</option></select></Field><Field label="Microetapa vinculada"><select value={layerForm.micro_stage_id} onChange={(event) => setLayerForm({ ...layerForm, micro_stage_id: event.target.value })} required><option value="">Selecione a microetapa</option>{micros.filter((micro) => !layers.some((layer) => layer.micro_stage_id === micro.id)).map((micro) => <option key={micro.id} value={micro.id}>{micro.macroName} · {micro.name}</option>)}</select></Field><Field label="Cor"><input type="color" value={layerForm.color} onChange={(event) => setLayerForm({ ...layerForm, color: event.target.value })} /></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setLayerOpen(false)}>Cancelar</Button><Button type="submit" loading={saving} disabled={!layerForm.micro_stage_id}>Criar camada</Button></div></form></Dialog>
  </section>;
}
