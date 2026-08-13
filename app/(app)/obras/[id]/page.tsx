"use client";

import { Button, Dialog, EmptyState, Field, KpiCard, ProgressBar, StatusPill, Toast } from "@/components/ui";
import { DetailTabs } from "@/components/detail-tabs";
import { SupplyEditor } from "@/components/supply-editor";
import { generateConstructionReport } from "@/lib/construction-report";
import { remainingSupplyQuantity, supplyWithRemainingQuantity } from "@/lib/construction-supplies";
import { currency, dateBr, monthBr } from "@/lib/format";
import { friendlyError, getSupabase, storagePath } from "@/lib/supabase";
import type { Construction, ConstructionBudget, ConstructionEvidence, ConstructionSourceFile, ConstructionSupply, ConstructionTemplate, MacroStage, MicroStage, UserProfile } from "@/lib/types";
import {
  ArrowLeft,
  ArrowUpRight,
  Banknote,
  Camera,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Copy,
  FileDown,
  Files,
  History,
  Hammer,
  ImageIcon,
  Package,
  Pencil,
  Plus,
  Save,
  Settings2,
  Trash2,
  WalletCards,
  Upload,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

type UpdateRow = {
  id: string;
  evidence_id: string | null;
  micro_stage_name: string;
  macro_stage_name: string;
  progress_percent: number;
  note: string | null;
  created_at: string;
  evidence_url?: string;
};

type WorkTab = "resumo" | "etapas" | "insumos" | "financeiro" | "arquivos" | "atualizacoes";

const workTabs = [
  { key: "resumo", label: "Resumo", icon: <Settings2 size={16} /> },
  { key: "etapas", label: "Etapas", icon: <Hammer size={16} /> },
  { key: "insumos", label: "Insumos", icon: <Package size={16} /> },
  { key: "financeiro", label: "Financeiro", icon: <WalletCards size={16} /> },
  { key: "arquivos", label: "Arquivos", icon: <Files size={16} /> },
  { key: "atualizacoes", label: "Atualizações", icon: <History size={16} /> },
] satisfies Array<{ key: WorkTab; label: string; icon: ReactNode }>;

export default function WorkDetailPage() {
  const params = useParams<{ id: string }>();
  const supabase = getSupabase();
  const [construction, setConstruction] = useState<Construction | null>(null);
  const [macros, setMacros] = useState<MacroStage[]>([]);
  const [evidences, setEvidences] = useState<ConstructionEvidence[]>([]);
  const [budgets, setBudgets] = useState<ConstructionBudget[]>([]);
  const [updates, setUpdates] = useState<UpdateRow[]>([]);
  const [sourceFiles, setSourceFiles] = useState<ConstructionSourceFile[]>([]);
  const [templates, setTemplates] = useState<ConstructionTemplate[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [publicToken, setPublicToken] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkTab>(() => {
    if (typeof window === "undefined") return "resumo";
    const requested = new URLSearchParams(window.location.search).get("tab") as WorkTab | null;
    return requested && workTabs.some((tab) => tab.key === requested) ? requested : "resumo";
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [macroDialog, setMacroDialog] = useState(false);
  const [editingMacro, setEditingMacro] = useState<MacroStage | null>(null);
  const [editingMicro, setEditingMicro] = useState<MicroStage | null>(null);
  const [editingUpdate, setEditingUpdate] = useState<UpdateRow | null>(null);
  const [microMacroId, setMicroMacroId] = useState<string | null>(null);
  const [supplyMicro, setSupplyMicro] = useState<MicroStage | null>(null);
  const [progressMicro, setProgressMicro] = useState<MicroStage | null>(null);
  const [budgetDialog, setBudgetDialog] = useState(false);
  const [templateDialog, setTemplateDialog] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [macroForm, setMacroForm] = useState({ name: "", description: "" });
  const [microForm, setMicroForm] = useState({ name: "", description: "", supplies: [] as ConstructionSupply[] });
  const [updateEditForm, setUpdateEditForm] = useState({ progress: "0", note: "" });
  const [supplyForm, setSupplyForm] = useState<ConstructionSupply[]>([]);
  const [progressSupplies, setProgressSupplies] = useState<ConstructionSupply[]>([]);
  const [progressForm, setProgressForm] = useState({ progress: "0", note: "", file: null as File | null });
  const [budgetForm, setBudgetForm] = useState({ reference_month: new Date().toISOString().slice(0, 7), planned_amount: "", realized_amount: "", notes: "" });
  const [summaryForm, setSummaryForm] = useState({ name: "", type: "loteamento" as Construction["type"], start_date: "", expected_end_date: "", planned_budget: "", address: "", status: "planejamento" as Construction["status"], responsible_user_id: "", notes: "" });
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const loadData = useCallback(async () => {
    if (!supabase || !params.id) return;
    setLoading(true);
    const [workResult, macroResult, microResult, evidenceResult, budgetResult, updateResult, sourceFileResult, templateResult, userResult, publicLinkResult] = await Promise.all([
      supabase.from("construction_progress_summary").select("*").eq("id", params.id).single(),
      supabase.from("construction_macro_stage_progress").select("*").eq("construction_id", params.id).order("position"),
      supabase.from("construction_micro_stages").select("*").order("position"),
      supabase.from("construction_evidence").select("*").eq("construction_id", params.id).order("captured_at", { ascending: false }),
      supabase.from("construction_budgets").select("*").eq("construction_id", params.id).order("reference_month", { ascending: false }),
      supabase.from("construction_update_feed").select("*").eq("construction_id", params.id).order("created_at", { ascending: false }).limit(20),
      supabase.rpc("construction_source_files", { p_construction_id: params.id }),
      supabase.from("construction_templates").select("*").eq("is_active", true).order("name"),
      supabase.from("profiles").select("user_id,full_name,email,active,is_admin").eq("active", true).not("email", "is", null).order("full_name"),
      supabase.from("construction_public_links").select("token").eq("construction_id", params.id).eq("active", true).maybeSingle(),
    ]);

    if (workResult.error) {
      setToast({ message: friendlyError(workResult.error), type: "error" });
      setLoading(false);
      return;
    }
    const macroRows = (macroResult.data || []) as MacroStage[];
    const microRows = (microResult.data || []) as MicroStage[];
    const assembled = macroRows.map((macro) => ({
      ...macro,
      micro_stages: microRows.filter((micro) => micro.macro_stage_id === macro.id),
    }));
    const evidenceRows = (evidenceResult.data || []) as ConstructionEvidence[];
    const signedEvidence = await Promise.all(evidenceRows.map(async (item) => {
      const { data } = await supabase.storage.from("construction-evidence").createSignedUrl(item.file_path, 3600);
      return { ...item, signed_url: data?.signedUrl };
    }));
    const urlByEvidence = new Map(signedEvidence.map((item) => [item.id, item.signed_url]));
    const work = workResult.data as Construction;
    const sourceFileRows = (sourceFileResult.data || []) as ConstructionSourceFile[];
    const signedSourceFiles = await Promise.all(sourceFileRows.map(async (item) => {
      const { data } = await supabase.storage.from("project-files").createSignedUrl(item.file_path, 3600);
      return { ...item, signed_url: data?.signedUrl };
    }));
    setConstruction(work);
    setSummaryForm({ name: work.name, type: work.type, start_date: work.start_date, expected_end_date: work.expected_end_date || "", planned_budget: String(work.planned_budget || 0), address: work.address || "", status: work.status, responsible_user_id: work.responsible_user_id || "", notes: work.notes || "" });
    setMacros(assembled);
    setWeights(Object.fromEntries(assembled.map((item) => [item.id, String(item.weight_percent)])));
    setEvidences(signedEvidence);
    setBudgets((budgetResult.data || []) as ConstructionBudget[]);
    setUpdates(((updateResult.data || []) as UpdateRow[]).map((item) => ({ ...item, evidence_url: item.evidence_id ? urlByEvidence.get(item.evidence_id) : undefined })));
    setSourceFiles(signedSourceFiles);
    setTemplates(((templateResult.data || []) as ConstructionTemplate[]).filter((template) => template.type === work.type));
    setUsers((userResult.data || []) as UserProfile[]);
    setPublicToken(publicLinkResult.data?.token || null);
    setLoading(false);
  }, [params.id, supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const weightTotal = useMemo(() => Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0), [weights]);
  const supplyRows = useMemo(() => macros.flatMap((macro) => (macro.micro_stages || []).flatMap((micro) =>
    (micro.supplies || []).map((supply, index) => ({
      ...supply,
      key: `${micro.id}-${index}`,
      macroName: macro.name,
      microName: micro.name,
    })),
  )), [macros]);

  function openNewMacro() {
    setMacroForm({ name: "", description: "" });
    setMacroDialog(true);
  }

  function openNewMicro(macroId: string) {
    setMicroForm({ name: "", description: "", supplies: [] });
    setMicroMacroId(macroId);
  }

  async function addMacro(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !construction) return;
    setSaving(true);
    const { error } = await supabase.from("construction_macro_stages").insert({
      construction_id: construction.id,
      name: macroForm.name.trim(),
      description: macroForm.description.trim() || null,
      weight_percent: macros.length ? 0 : 100,
      position: macros.length,
    });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setMacroDialog(false);
    setMacroForm({ name: "", description: "" });
    setToast({ message: "Macro etapa adicionada. Ajuste os pesos para somarem 100%.", type: "success" });
    await loadData();
  }

  function openEditMacro(macro: MacroStage) {
    setEditingMacro(macro);
    setMacroForm({ name: macro.name, description: macro.description || "" });
  }

  async function saveMacro(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !editingMacro) return;
    setSaving(true);
    const { error } = await supabase.from("construction_macro_stages").update({ name: macroForm.name.trim(), description: macroForm.description.trim() || null }).eq("id", editingMacro.id);
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setEditingMacro(null);
    setMacroForm({ name: "", description: "" });
    setToast({ message: "Etapa atualizada.", type: "success" });
    await loadData();
  }

  async function deleteMacro(macro: MacroStage) {
    if (!supabase || !construction || !window.confirm(`Excluir a etapa “${macro.name}”, suas microetapas, insumos e evidências?`)) return;
    setSaving(true);
    const { data: paths, error } = await supabase.rpc("delete_construction_macro_stage", { p_macro_stage_id: macro.id });
    if (!error) {
      const remaining = macros.filter((item) => item.id !== macro.id);
      if (remaining.length) {
        const total = remaining.reduce((sum, item) => sum + Number(item.weight_percent || 0), 0);
        let distributed = 0;
        const normalized = remaining.map((item, index) => {
          const weight = index === remaining.length - 1 ? 100 - distributed : Number((total ? Number(item.weight_percent || 0) / total * 100 : 100 / remaining.length).toFixed(2));
          distributed += weight;
          return { id: item.id, weight };
        });
        await supabase.rpc("set_construction_stage_weights", { p_construction_id: construction.id, p_weights: normalized });
      }
      if (paths?.length) await supabase.storage.from("construction-evidence").remove(paths);
    }
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setToast({ message: "Etapa excluída e pesos restantes recalculados.", type: "success" });
    await loadData();
  }

  async function saveWeights() {
    if (!supabase || !construction) return;
    if (Math.abs(weightTotal - 100) > 0.001) {
      setToast({ message: "A soma dos pesos precisa ser exatamente 100%.", type: "error" });
      return;
    }
    setSaving(true);
    const payload = Object.entries(weights).map(([id, weight]) => ({ id, weight: Number(weight) }));
    const { error } = await supabase.rpc("set_construction_stage_weights", { p_construction_id: construction.id, p_weights: payload });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setToast({ message: "Pesos salvos. O avanço geral foi recalculado.", type: "success" });
    await loadData();
  }

  async function addMicro(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !microMacroId) return;
    setSaving(true);
    const macro = macros.find((item) => item.id === microMacroId);
    const { error } = await supabase.from("construction_micro_stages").insert({
      macro_stage_id: microMacroId,
      name: microForm.name.trim(),
      description: microForm.description.trim() || null,
      supplies: microForm.supplies,
      position: macro?.micro_stages?.length || 0,
    });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setMicroMacroId(null);
    setMicroForm({ name: "", description: "", supplies: [] });
    setToast({ message: "Micro etapa adicionada.", type: "success" });
    await loadData();
  }

  function openEditMicro(micro: MicroStage) {
    setEditingMicro(micro);
    setMicroForm({ name: micro.name, description: micro.description || "", supplies: (micro.supplies || []).map((item) => ({ ...item })) });
  }

  async function saveMicro(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !editingMicro) return;
    setSaving(true);
    const { error } = await supabase.from("construction_micro_stages").update({ name: microForm.name.trim(), description: microForm.description.trim() || null, supplies: microForm.supplies }).eq("id", editingMicro.id);
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setEditingMicro(null);
    setMicroForm({ name: "", description: "", supplies: [] });
    setToast({ message: "Microetapa e insumos atualizados.", type: "success" });
    await loadData();
  }

  async function deleteMicro(micro: MicroStage) {
    if (!supabase || !window.confirm(`Excluir a microetapa “${micro.name}”, seus insumos e evidências?`)) return;
    setSaving(true);
    const { data: paths, error } = await supabase.rpc("delete_construction_micro_stage", { p_micro_stage_id: micro.id });
    if (!error) {
      if (paths?.length) await supabase.storage.from("construction-evidence").remove(paths);
    }
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setToast({ message: "Microetapa excluída.", type: "success" });
    await loadData();
  }

  function openSupplies(micro: MicroStage) {
    setSupplyMicro(micro);
    setSupplyForm((micro.supplies || []).map((item) => ({
      name: item.name,
      total_value: Number(item.total_value || 0),
      total_quantity: Number(item.total_quantity || 0),
      used_quantity: Number(item.used_quantity || 0),
    })));
  }

  async function saveSupplies(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !supplyMicro) return;
    setSaving(true);
    const { error } = await supabase
      .from("construction_micro_stages")
      .update({ supplies: supplyForm })
      .eq("id", supplyMicro.id);
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setSupplyMicro(null);
    setSupplyForm([]);
    setToast({ message: "Insumos atualizados.", type: "success" });
    await loadData();
  }

  function openProgress(micro: MicroStage) {
    setProgressMicro(micro);
    setProgressForm({ progress: String(micro.progress_percent), note: "", file: null });
    setProgressSupplies((micro.supplies || []).map((item) => ({
      ...item,
      total_value: Number(item.total_value || 0),
      total_quantity: Number(item.total_quantity || 0),
      used_quantity: Number(item.used_quantity || 0),
    })));
  }

  async function updateProgress(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !construction || !progressMicro || !progressForm.file) return;
    setSaving(true);
    const path = storagePath(construction.id, progressForm.file.name, progressMicro.id);
    const upload = await supabase.storage.from("construction-evidence").upload(path, progressForm.file, { cacheControl: "3600", upsert: false });
    if (upload.error) {
      setSaving(false);
      return setToast({ message: friendlyError(upload.error), type: "error" });
    }
    const evidence = await supabase.from("construction_evidence").insert({
      construction_id: construction.id,
      micro_stage_id: progressMicro.id,
      file_path: path,
      file_name: progressForm.file.name,
      note: progressForm.note.trim() || null,
    }).select("id").single();
    if (evidence.error) {
      await supabase.storage.from("construction-evidence").remove([path]);
      setSaving(false);
      return setToast({ message: friendlyError(evidence.error), type: "error" });
    }
    const update = await supabase.from("construction_micro_stages").update({
      progress_percent: Number(progressForm.progress),
      last_evidence_id: evidence.data.id,
      supplies: progressSupplies,
    }).eq("id", progressMicro.id);
    setSaving(false);
    if (update.error) {
      await supabase.from("construction_evidence").delete().eq("id", evidence.data.id);
      await supabase.storage.from("construction-evidence").remove([path]);
      return setToast({ message: friendlyError(update.error), type: "error" });
    }
    setProgressMicro(null);
    setProgressSupplies([]);
    setToast({ message: progressSupplies.length ? "Avanço e estoque dos insumos atualizados." : "Evidência registrada e avanço atualizado.", type: "success" });
    await loadData();
  }

  function openEditUpdate(update: UpdateRow) {
    setEditingUpdate(update);
    setUpdateEditForm({ progress: String(update.progress_percent), note: update.note || "" });
  }

  async function saveEditedUpdate(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !editingUpdate) return;
    setSaving(true);
    const { error } = await supabase.rpc("edit_construction_progress_update", {
      p_update_id: editingUpdate.id,
      p_progress_percent: Number(updateEditForm.progress),
      p_note: updateEditForm.note,
    });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setEditingUpdate(null);
    setToast({ message: "Atualização corrigida; o avanço atual foi recalculado quando aplicável.", type: "success" });
    await loadData();
  }

  async function copyPublicLink() {
    if (!supabase || !construction) return;
    let token = publicToken;
    if (!token) {
      const { data, error } = await supabase.from("construction_public_links").upsert({ construction_id: construction.id, active: true }, { onConflict: "construction_id" }).select("token").single();
      if (error) return setToast({ message: friendlyError(error), type: "error" });
      token = data.token;
      setPublicToken(token);
    }
    const url = `${window.location.origin}/obra-publica/${token}`;
    await navigator.clipboard.writeText(url);
    setToast({ message: "Link público copiado. Quem receber poderá atualizar avanço, estoque e fotos, sem acessar o financeiro.", type: "success" });
  }

  async function saveBudget(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !construction) return;
    setSaving(true);
    const { error } = await supabase.from("construction_budgets").upsert({
      construction_id: construction.id,
      reference_month: `${budgetForm.reference_month}-01`,
      planned_amount: Number(budgetForm.planned_amount || 0),
      realized_amount: Number(budgetForm.realized_amount || 0),
      notes: budgetForm.notes.trim() || null,
    }, { onConflict: "construction_id,reference_month" });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setBudgetDialog(false);
    setToast({ message: "Competência financeira atualizada.", type: "success" });
    await loadData();
  }

  async function saveSummary(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !construction) return;
    setSaving(true);
    const { error } = await supabase.from("constructions").update({
      name: summaryForm.name.trim(),
      type: summaryForm.type,
      start_date: summaryForm.start_date,
      expected_end_date: summaryForm.expected_end_date || null,
      planned_budget: Number(summaryForm.planned_budget || 0),
      address: summaryForm.address.trim() || null,
      status: summaryForm.status,
      responsible_user_id: summaryForm.responsible_user_id || null,
      notes: summaryForm.notes.trim() || null,
    }).eq("id", construction.id);
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setToast({ message: "Dados gerais da obra atualizados.", type: "success" });
    await loadData();
  }

  async function applyTemplate(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !construction || !templateId) return;
    setSaving(true);
    const { error } = await supabase.rpc("apply_construction_template", { p_construction_id: construction.id, p_template_id: templateId });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setTemplateDialog(false);
    setTemplateId("");
    setActiveTab("etapas");
    setToast({ message: "Modelo aplicado. Macro e micro etapas foram criadas com os pesos prontos.", type: "success" });
    await loadData();
  }

  async function makeReport() {
    if (!construction) return;
    setReporting(true);
    try {
      await generateConstructionReport({ construction, macros, updates, evidences });
      setToast({ message: "Relatório PDF gerado com as atualizações mais recentes.", type: "success" });
    } catch (error) {
      setToast({ message: friendlyError(error), type: "error" });
    } finally {
      setReporting(false);
    }
  }

  if (loading) return <div className="detail-loading">Carregando obra…</div>;
  if (!construction) return <EmptyState icon={<Hammer size={22} />} title="Obra não encontrada" description="Verifique se o registro ainda existe e tente novamente." />;

  return (
    <>
      <Link href="/obras" className="detail-back"><ArrowLeft size={16} /> Voltar para Obras</Link>
      <header className="work-detail-header">
        <div>
          <div className="work-detail-tags"><StatusPill tone="info">{construction.type === "loteamento" ? "Loteamento" : "Construção"}</StatusPill><StatusPill>{construction.status === "em_andamento" ? "Em andamento" : construction.status}</StatusPill></div>
          <h1>{construction.name}</h1>
          <p>{construction.address || "Localização não informada"} · {dateBr(construction.start_date)} a {dateBr(construction.expected_end_date)}</p>
        </div>
        <div className="work-header-actions"><Button variant="secondary" onClick={() => void copyPublicLink()}><Copy size={17} /> Copiar link de campo</Button><Button variant="secondary" onClick={makeReport} loading={reporting}><FileDown size={17} /> Gerar relatório PDF</Button></div>
      </header>

      <section className="kpi-grid">
        <KpiCard label="Avanço físico" value={`${Number(construction.progress_percent || 0).toFixed(0)}%`} helper="média ponderada" tone="success" icon={<Hammer size={17} />} />
        <KpiCard label="Orçamento previsto" value={currency(construction.planned_budget, true)} helper="orçamento total" icon={<CircleDollarSign size={17} />} />
        <KpiCard label="Realizado" value={currency(construction.realized_total, true)} helper={`${construction.planned_budget ? (Number(construction.realized_total || 0) / construction.planned_budget * 100).toFixed(0) : 0}% utilizado`} icon={<Banknote size={17} />} />
        <KpiCard label="Peso estruturado" value={`${weightTotal.toFixed(0)}%`} helper={weightTotal === 100 ? "estrutura válida" : "precisa somar 100%"} tone={weightTotal === 100 ? "success" : "warning"} icon={<Save size={17} />} />
      </section>

      <DetailTabs tabs={workTabs} active={activeTab} onChange={setActiveTab} />

      {activeTab === "resumo" ? <section className="content-card detail-tab-panel">
        <div className="content-card-head"><div><h2>Dados gerais</h2><p>Informações principais, prazo, responsável e orçamento previsto</p></div>{construction.source_business_id ? <StatusPill tone="info">Origem: Novo negócio</StatusPill> : <StatusPill tone="neutral">Obra avulsa</StatusPill>}</div>
        <div className="content-card-body">
          <form className="form-grid" onSubmit={saveSummary}>
            <Field label="Nome da obra"><input value={summaryForm.name} onChange={(event) => setSummaryForm({ ...summaryForm, name: event.target.value })} maxLength={140} required /></Field>
            <Field label="Tipo"><select value={summaryForm.type} onChange={(event) => setSummaryForm({ ...summaryForm, type: event.target.value as Construction["type"] })}><option value="loteamento">Loteamento</option><option value="construcao">Construção</option></select></Field>
            <Field label="Status"><select value={summaryForm.status} onChange={(event) => setSummaryForm({ ...summaryForm, status: event.target.value as Construction["status"] })}><option value="planejamento">Planejamento</option><option value="em_andamento">Em andamento</option><option value="pausada">Pausada</option><option value="concluida">Concluída</option></select></Field>
            <Field label="Responsável"><select value={summaryForm.responsible_user_id} onChange={(event) => setSummaryForm({ ...summaryForm, responsible_user_id: event.target.value })}><option value="">A definir</option>{users.map((user) => <option key={user.user_id} value={user.user_id}>{user.full_name || user.email} · {user.email}</option>)}</select></Field>
            <Field label="Data de início"><input type="date" value={summaryForm.start_date} onChange={(event) => setSummaryForm({ ...summaryForm, start_date: event.target.value })} required /></Field>
            <Field label="Previsão de fim"><input type="date" min={summaryForm.start_date} value={summaryForm.expected_end_date} onChange={(event) => setSummaryForm({ ...summaryForm, expected_end_date: event.target.value })} /></Field>
            <Field label="Orçamento previsto"><input type="number" min="0" step="0.01" value={summaryForm.planned_budget} onChange={(event) => setSummaryForm({ ...summaryForm, planned_budget: event.target.value })} /></Field>
            <Field label="Localização"><input value={summaryForm.address} onChange={(event) => setSummaryForm({ ...summaryForm, address: event.target.value })} maxLength={260} /></Field>
            <Field label="Observações" className="form-span-2"><textarea value={summaryForm.notes} onChange={(event) => setSummaryForm({ ...summaryForm, notes: event.target.value })} maxLength={5000} /></Field>
            <div className="form-actions"><Button type="submit" loading={saving}><Save size={16} /> Salvar alterações</Button></div>
          </form>
        </div>
      </section> : null}

      {activeTab === "etapas" ? <section className="content-card detail-tab-panel">
          <div className="content-card-head"><div><h2>Etapas da obra</h2><p>O avanço geral considera o peso de cada macro etapa</p></div><Button variant="secondary" onClick={openNewMacro}><Plus size={16} /> Macro etapa</Button></div>
          {macros.length === 0 ? (
            <EmptyState icon={<Hammer size={22} />} title="Estruture as etapas" description="Aplique um modelo pronto ou crie a estrutura manualmente." action={<div className="empty-actions"><Button onClick={() => setTemplateDialog(true)}><Plus size={16} /> Aplicar modelo</Button><Button variant="secondary" onClick={openNewMacro}>Criar manualmente</Button></div>} />
          ) : (
            <div className="macro-list">
              <div className={`weight-editor ${weightTotal === 100 ? "weight-valid" : "weight-invalid"}`}>
                <div><strong>Distribuição de pesos</strong><span>Total: {weightTotal.toFixed(0)}%</span></div>
                <Button variant="secondary" onClick={saveWeights} loading={saving} disabled={weightTotal !== 100}><Save size={15} /> Salvar pesos</Button>
              </div>
              {macros.map((macro, macroIndex) => {
                const isOpen = expanded[macro.id] ?? true;
                return (
                  <article className="macro-card" key={macro.id}>
                    <div className="macro-head">
                      <button className="macro-toggle" onClick={() => setExpanded({ ...expanded, [macro.id]: !isOpen })}>
                        <span className="macro-sequence">Etapa {String(macroIndex + 1).padStart(2, "0")}</span>
                        <div><h3>{macro.name}</h3><span>{macro.description || `${macro.micro_stages?.length || 0} microetapas de execução`}</span></div>
                        {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </button>
                      <div className="macro-controls"><div className="macro-weight"><label>Peso</label><div><input type="number" min="0" max="100" step="0.1" value={weights[macro.id] ?? macro.weight_percent} onChange={(event) => setWeights({ ...weights, [macro.id]: event.target.value })} /><span>%</span></div></div><button type="button" onClick={() => openEditMacro(macro)} title="Editar etapa"><Pencil size={15} /></button><button type="button" className="danger" onClick={() => void deleteMacro(macro)} title="Excluir etapa"><Trash2 size={15} /></button></div>
                    </div>
                    <div className="macro-progress"><ProgressBar value={Number(macro.progress_percent || 0)} label="Avanço da macro etapa" /></div>
                    {isOpen ? (
                      <div className="micro-list">
                        {(macro.micro_stages || []).map((micro, microIndex) => (
                          <div className="micro-row" key={micro.id}>
                            <span className="micro-sequence">{String(macroIndex + 1).padStart(2, "0")}.{String(microIndex + 1).padStart(2, "0")}</span>
                            <div className="micro-main">
                              <div><small>Microetapa</small><strong>{micro.name}</strong>{micro.description ? <span>{micro.description}</span> : null}</div>
                              <ProgressBar value={micro.progress_percent} />
                            </div>
                            <div className="micro-supplies"><Package size={16} /><div><small>Insumos vinculados</small><strong>{micro.supplies?.length ? `${micro.supplies.length} item(ns)` : "Nenhum item"}</strong><span>{micro.supplies?.length ? `${micro.supplies.reduce((sum, item) => sum + remainingSupplyQuantity(item), 0).toLocaleString("pt-BR")} em estoque` : "Cadastro opcional"}</span></div></div>
                            <div className="micro-actions"><Button variant="ghost" onClick={() => openEditMicro(micro)}><Pencil size={15} /> Editar</Button><Button variant="ghost" onClick={() => openSupplies(micro)}><Package size={15} /> Insumos</Button><Button variant="secondary" onClick={() => openProgress(micro)}><Camera size={15} /> Atualizar</Button><button type="button" className="micro-delete" onClick={() => void deleteMicro(micro)} title="Excluir microetapa"><Trash2 size={15} /></button></div>
                          </div>
                        ))}
                        <button className="add-micro" onClick={() => openNewMicro(macro.id)}><Plus size={15} /> Adicionar micro etapa</button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section> : null}

      {activeTab === "insumos" ? <section className="content-card detail-tab-panel">
        <div className="content-card-head"><div><h2>Estoque de insumos</h2><p>Posição atual por etapa e microetapa; o consumo é sempre calculado pelo total menos o estoque</p></div><StatusPill tone={supplyRows.length ? "info" : "neutral"}>{supplyRows.length} item(ns)</StatusPill></div>
        {supplyRows.length ? <div className="supply-inventory-table">
          <div className="supply-inventory-head"><span>Etapa / microetapa</span><span>Insumo</span><span>Total</span><span>Em estoque</span><span>Consumido</span><span>Valor</span></div>
          {supplyRows.map((item) => <div className="supply-inventory-row" key={item.key}>
            <div><strong>{item.macroName}</strong><span>{item.microName}</span></div>
            <strong>{item.name}</strong>
            <span>{Number(item.total_quantity || 0).toLocaleString("pt-BR")}</span>
            <span className="supply-stock-value">{remainingSupplyQuantity(item).toLocaleString("pt-BR")}</span>
            <span>{Number(item.used_quantity || 0).toLocaleString("pt-BR")}</span>
            <span>{currency(Number(item.total_value || 0), true)}</span>
          </div>)}
        </div> : <EmptyState icon={<Package size={22} />} title="Nenhum insumo cadastrado" description="Vincule os insumos às microetapas para controlar estoque e consumo durante as atualizações de avanço." />}
      </section> : null}

      {activeTab === "financeiro" ? <section className="content-card detail-tab-panel">
        <div className="content-card-head"><div><h2>Orçamento mensal</h2><p>Previsto versus realizado por competência</p></div><Button variant="secondary" onClick={() => setBudgetDialog(true)}><Plus size={16} /> Competência</Button></div>
        {budgets.length ? <div className="budget-list budget-list-full">{budgets.map((budget) => <div key={budget.id}><div><strong>{monthBr(budget.reference_month)}</strong><span>{budget.notes || "Sem observações"}</span></div><div><small>Prev. {currency(budget.planned_amount, true)}</small><strong className={budget.realized_amount > budget.planned_amount ? "value-danger" : ""}>{currency(budget.realized_amount, true)}</strong></div></div>)}</div> : <EmptyState icon={<WalletCards size={22} />} title="Nenhuma competência" description="Registre o previsto e realizado de cada mês para acompanhar o orçamento." action={<Button onClick={() => setBudgetDialog(true)}><Plus size={16} /> Adicionar competência</Button>} />}
      </section> : null}

      {activeTab === "arquivos" ? <div className="detail-files-grid detail-tab-panel">
        <section className="content-card">
          <div className="content-card-head"><div><h2>Documentos do projeto</h2><p>Arquivos reaproveitados do projeto que originou a obra</p></div><Files size={18} /></div>
          {sourceFiles.length ? <div className="project-files">{sourceFiles.map((item) => <a key={item.id} href={item.signed_url} target="_blank" rel="noreferrer"><Files size={22} /><div><strong>{item.file_name}</strong><span>{dateBr(item.created_at)}</span></div><ArrowUpRight size={15} /></a>)}</div> : <div className="mini-empty">Esta obra não possui documentos vinculados de um projeto-fonte.</div>}
        </section>
        <section className="content-card">
          <div className="content-card-head"><div><h2>Evidências da obra</h2><p>Fotos registradas nas atualizações de avanço</p></div><ImageIcon size={18} /></div>
          {evidences.length ? <div className="evidence-gallery">{evidences.map((evidence) => <a key={evidence.id} href={evidence.signed_url} target="_blank" rel="noreferrer">{evidence.signed_url ? <Image src={evidence.signed_url} alt={evidence.file_name} width={220} height={150} unoptimized /> : <div className="update-placeholder"><Camera size={18} /></div>}<strong>{evidence.file_name}</strong><span>{dateBr(evidence.captured_at)}</span></a>)}</div> : <div className="mini-empty">Nenhuma evidência registrada.</div>}
        </section>
      </div> : null}

      {activeTab === "atualizacoes" ? <section className="content-card detail-tab-panel">
        <div className="content-card-head"><div><h2>Últimas atualizações</h2><p>Evidências, percentuais e histórico recente</p></div><ImageIcon size={18} /></div>
        {updates.length ? <div className="update-feed update-feed-full">{updates.map((update) => <article key={update.id}>{update.evidence_url ? <a href={update.evidence_url} target="_blank" rel="noreferrer"><Image src={update.evidence_url} alt={`Evidência de ${update.micro_stage_name}`} width={54} height={54} unoptimized /></a> : <div className="update-placeholder"><Camera size={18} /></div>}<div><strong>{update.micro_stage_name} · {Number(update.progress_percent).toFixed(0)}%</strong><span>{update.macro_stage_name}{update.note ? ` · ${update.note}` : ""}</span><small>{dateBr(update.created_at)}</small></div><button type="button" className="update-edit" onClick={() => openEditUpdate(update)}><Pencil size={15} /> Editar</button></article>)}</div> : <EmptyState icon={<History size={22} />} title="Sem atualizações" description="As atualizações aparecerão após o primeiro registro de avanço com evidência." />}
      </section> : null}

      <Dialog open={templateDialog} onClose={() => setTemplateDialog(false)} title="Aplicar modelo de etapas" description="A estrutura só pode ser aplicada enquanto a obra ainda não possui macro etapas."><form className="form-grid" onSubmit={applyTemplate}><Field label="Modelo"><select value={templateId} onChange={(event) => setTemplateId(event.target.value)} required><option value="">Selecione um modelo</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></Field>{templateId ? <div className="template-preview"><strong>{templates.find((template) => template.id === templateId)?.name}</strong><p>{templates.find((template) => template.id === templateId)?.description}</p></div> : null}<div className="form-actions"><Button type="button" variant="secondary" onClick={() => setTemplateDialog(false)}>Cancelar</Button><Button type="submit" loading={saving} disabled={!templateId}>Aplicar modelo</Button></div></form></Dialog>
      <Dialog open={macroDialog} onClose={() => setMacroDialog(false)} title="Nova macro etapa" description="Ex.: Terraplenagem, infraestrutura, fundações ou acabamento."><form className="form-grid" onSubmit={addMacro}><Field label="Nome"><input value={macroForm.name} onChange={(event) => setMacroForm({ ...macroForm, name: event.target.value })} required maxLength={120} /></Field><Field label="Descrição"><textarea value={macroForm.description} onChange={(event) => setMacroForm({ ...macroForm, description: event.target.value })} maxLength={1000} /></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setMacroDialog(false)}>Cancelar</Button><Button type="submit" loading={saving}>Adicionar</Button></div></form></Dialog>
      <Dialog open={Boolean(editingMacro)} onClose={() => setEditingMacro(null)} title="Editar etapa" description="Altere nome e descrição sem perder microetapas ou histórico."><form className="form-grid" onSubmit={saveMacro}><Field label="Nome"><input value={macroForm.name} onChange={(event) => setMacroForm({ ...macroForm, name: event.target.value })} required maxLength={120} /></Field><Field label="Descrição"><textarea value={macroForm.description} onChange={(event) => setMacroForm({ ...macroForm, description: event.target.value })} maxLength={1000} /></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setEditingMacro(null)}>Cancelar</Button><Button type="submit" loading={saving}>Salvar etapa</Button></div></form></Dialog>
      <Dialog open={Boolean(microMacroId)} onClose={() => setMicroMacroId(null)} title="Nova micro etapa" description="Detalhe a execução. O cadastro de insumos é opcional." wide><form className="form-grid" onSubmit={addMicro}><Field label="Nome"><input value={microForm.name} onChange={(event) => setMicroForm({ ...microForm, name: event.target.value })} required maxLength={140} /></Field><Field label="Descrição"><textarea value={microForm.description} onChange={(event) => setMicroForm({ ...microForm, description: event.target.value })} /></Field><SupplyEditor value={microForm.supplies} onChange={(supplies) => setMicroForm({ ...microForm, supplies })} /><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setMicroMacroId(null)}>Cancelar</Button><Button type="submit" loading={saving}>Adicionar</Button></div></form></Dialog>
      <Dialog open={Boolean(editingMicro)} onClose={() => setEditingMicro(null)} title="Editar microetapa" description="Altere dados e insumos vinculados sem perder as atualizações." wide><form className="form-grid" onSubmit={saveMicro}><Field label="Nome"><input value={microForm.name} onChange={(event) => setMicroForm({ ...microForm, name: event.target.value })} required maxLength={140} /></Field><Field label="Descrição"><textarea value={microForm.description} onChange={(event) => setMicroForm({ ...microForm, description: event.target.value })} /></Field><SupplyEditor value={microForm.supplies} onChange={(supplies) => setMicroForm({ ...microForm, supplies })} /><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setEditingMicro(null)}>Cancelar</Button><Button type="submit" loading={saving}>Salvar microetapa</Button></div></form></Dialog>
      <Dialog open={Boolean(supplyMicro)} onClose={() => setSupplyMicro(null)} title={`Insumos · ${supplyMicro?.name || "micro etapa"}`} description="Atualize o total adquirido e o estoque atual. O consumo será recalculado automaticamente." wide><form className="form-grid" onSubmit={saveSupplies}><SupplyEditor value={supplyForm} onChange={setSupplyForm} /><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setSupplyMicro(null)}>Cancelar</Button><Button type="submit" loading={saving}>Salvar insumos</Button></div></form></Dialog>
      <Dialog open={Boolean(progressMicro)} onClose={() => setProgressMicro(null)} title={`Atualizar ${progressMicro?.name || "etapa"}`} description="Registre o avanço, a evidência e a posição atual do estoque."><form className="form-grid" onSubmit={updateProgress}><Field label="Novo avanço"><div className="range-field"><input type="range" min="0" max="100" step="1" value={progressForm.progress} onChange={(event) => setProgressForm({ ...progressForm, progress: event.target.value })} /><strong>{progressForm.progress}%</strong></div></Field><Field label="Evidência fotográfica" hint="PNG, JPG ou WEBP. Evite imagens com dados pessoais."><label className="file-drop"><Upload size={20} /><span>{progressForm.file?.name || "Selecionar foto"}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setProgressForm({ ...progressForm, file: event.target.files?.[0] || null })} required /></label></Field>{progressSupplies.length ? <div className="progress-stock-editor form-span-2"><div><strong>Estoque após esta atualização</strong><span>Informe quanto restou de cada insumo. O sistema calcula o consumo automaticamente.</span></div>{progressSupplies.map((item, index) => <label key={`${item.name}-${index}`}><span>{item.name}<small>Total: {Number(item.total_quantity || 0).toLocaleString("pt-BR")}</small></span><input type="number" min="0" max={item.total_quantity} step="0.01" value={remainingSupplyQuantity(item)} onChange={(event) => setProgressSupplies((current) => current.map((supply, supplyIndex) => supplyIndex === index ? supplyWithRemainingQuantity(supply, Number(event.target.value)) : supply))} required /><small>{Number(item.used_quantity || 0).toLocaleString("pt-BR")} consumidos</small></label>)}</div> : null}<Field label="Comentário da atualização" className="form-span-2"><textarea value={progressForm.note} onChange={(event) => setProgressForm({ ...progressForm, note: event.target.value })} placeholder="O que foi executado desde a última atualização?" maxLength={1500} /></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setProgressMicro(null)}>Cancelar</Button><Button type="submit" loading={saving} disabled={!progressForm.file}><Camera size={16} /> Registrar avanço e estoque</Button></div></form></Dialog>
      <Dialog open={Boolean(editingUpdate)} onClose={() => setEditingUpdate(null)} title="Editar atualização" description="A foto é preservada. Se esta for a atualização mais recente da microetapa, o avanço atual também será corrigido."><form className="form-grid" onSubmit={saveEditedUpdate}><Field label="Avanço"><div className="range-field"><input type="range" min="0" max="100" step="1" value={updateEditForm.progress} onChange={(event) => setUpdateEditForm({ ...updateEditForm, progress: event.target.value })} /><strong>{updateEditForm.progress}%</strong></div></Field><Field label="Comentário"><textarea value={updateEditForm.note} onChange={(event) => setUpdateEditForm({ ...updateEditForm, note: event.target.value })} maxLength={1500} /></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setEditingUpdate(null)}>Cancelar</Button><Button type="submit" loading={saving}>Salvar correção</Button></div></form></Dialog>
      <Dialog open={budgetDialog} onClose={() => setBudgetDialog(false)} title="Atualizar orçamento mensal" description="Se o mês já existir, os valores serão atualizados."><form className="form-grid" onSubmit={saveBudget}><Field label="Mês de referência"><input type="month" value={budgetForm.reference_month} onChange={(event) => setBudgetForm({ ...budgetForm, reference_month: event.target.value })} required /></Field><Field label="Previsto no mês"><input type="number" min="0" step="0.01" value={budgetForm.planned_amount} onChange={(event) => setBudgetForm({ ...budgetForm, planned_amount: event.target.value })} required /></Field><Field label="Realizado no mês"><input type="number" min="0" step="0.01" value={budgetForm.realized_amount} onChange={(event) => setBudgetForm({ ...budgetForm, realized_amount: event.target.value })} required /></Field><Field label="Observações"><textarea value={budgetForm.notes} onChange={(event) => setBudgetForm({ ...budgetForm, notes: event.target.value })} /></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setBudgetDialog(false)}>Cancelar</Button><Button type="submit" loading={saving}>Salvar competência</Button></div></form></Dialog>
      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}
