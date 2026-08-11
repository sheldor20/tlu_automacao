"use client";

import { Button, Dialog, EmptyState, Field, KpiCard, ProgressBar, StatusPill, Toast } from "@/components/ui";
import { generateConstructionReport } from "@/lib/construction-report";
import { currency, dateBr, monthBr } from "@/lib/format";
import { friendlyError, getSupabase, storagePath } from "@/lib/supabase";
import type { Construction, ConstructionBudget, ConstructionEvidence, MacroStage, MicroStage } from "@/lib/types";
import {
  ArrowLeft,
  Banknote,
  Camera,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  FileDown,
  Hammer,
  ImageIcon,
  Package,
  Plus,
  Save,
  Upload,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

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

export default function WorkDetailPage() {
  const params = useParams<{ id: string }>();
  const supabase = getSupabase();
  const [construction, setConstruction] = useState<Construction | null>(null);
  const [macros, setMacros] = useState<MacroStage[]>([]);
  const [evidences, setEvidences] = useState<ConstructionEvidence[]>([]);
  const [budgets, setBudgets] = useState<ConstructionBudget[]>([]);
  const [updates, setUpdates] = useState<UpdateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [macroDialog, setMacroDialog] = useState(false);
  const [microMacroId, setMicroMacroId] = useState<string | null>(null);
  const [progressMicro, setProgressMicro] = useState<MicroStage | null>(null);
  const [budgetDialog, setBudgetDialog] = useState(false);
  const [macroForm, setMacroForm] = useState({ name: "", description: "" });
  const [microForm, setMicroForm] = useState({ name: "", description: "", supplies: "" });
  const [progressForm, setProgressForm] = useState({ progress: "0", note: "", file: null as File | null });
  const [budgetForm, setBudgetForm] = useState({ reference_month: new Date().toISOString().slice(0, 7), planned_amount: "", realized_amount: "", notes: "" });
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const loadData = useCallback(async () => {
    if (!supabase || !params.id) return;
    setLoading(true);
    const [workResult, macroResult, microResult, evidenceResult, budgetResult, updateResult] = await Promise.all([
      supabase.from("construction_progress_summary").select("*").eq("id", params.id).single(),
      supabase.from("construction_macro_stage_progress").select("*").eq("construction_id", params.id).order("position"),
      supabase.from("construction_micro_stages").select("*").order("position"),
      supabase.from("construction_evidence").select("*").eq("construction_id", params.id).order("captured_at", { ascending: false }),
      supabase.from("construction_budgets").select("*").eq("construction_id", params.id).order("reference_month", { ascending: false }),
      supabase.from("construction_update_feed").select("*").eq("construction_id", params.id).order("created_at", { ascending: false }).limit(20),
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
    setConstruction(workResult.data as Construction);
    setMacros(assembled);
    setWeights(Object.fromEntries(assembled.map((item) => [item.id, String(item.weight_percent)])));
    setEvidences(signedEvidence);
    setBudgets((budgetResult.data || []) as ConstructionBudget[]);
    setUpdates(((updateResult.data || []) as UpdateRow[]).map((item) => ({ ...item, evidence_url: item.evidence_id ? urlByEvidence.get(item.evidence_id) : undefined })));
    setLoading(false);
  }, [params.id, supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const weightTotal = useMemo(() => Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0), [weights]);

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
    const supplies = microForm.supplies.split(",").map((name) => name.trim()).filter(Boolean).map((name) => ({ name }));
    const macro = macros.find((item) => item.id === microMacroId);
    const { error } = await supabase.from("construction_micro_stages").insert({
      macro_stage_id: microMacroId,
      name: microForm.name.trim(),
      description: microForm.description.trim() || null,
      supplies,
      position: macro?.micro_stages?.length || 0,
    });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setMicroMacroId(null);
    setMicroForm({ name: "", description: "", supplies: "" });
    setToast({ message: "Micro etapa adicionada.", type: "success" });
    await loadData();
  }

  function openProgress(micro: MicroStage) {
    setProgressMicro(micro);
    setProgressForm({ progress: String(micro.progress_percent), note: "", file: null });
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
    }).eq("id", progressMicro.id);
    setSaving(false);
    if (update.error) return setToast({ message: friendlyError(update.error), type: "error" });
    setProgressMicro(null);
    setToast({ message: "Evidência registrada e avanço atualizado.", type: "success" });
    await loadData();
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
        <Button variant="secondary" onClick={makeReport} loading={reporting}><FileDown size={17} /> Gerar relatório PDF</Button>
      </header>

      <section className="kpi-grid">
        <KpiCard label="Avanço físico" value={`${Number(construction.progress_percent || 0).toFixed(0)}%`} helper="média ponderada" tone="success" icon={<Hammer size={17} />} />
        <KpiCard label="Orçamento previsto" value={currency(construction.planned_budget, true)} helper="orçamento total" icon={<CircleDollarSign size={17} />} />
        <KpiCard label="Realizado" value={currency(construction.realized_total, true)} helper={`${construction.planned_budget ? (Number(construction.realized_total || 0) / construction.planned_budget * 100).toFixed(0) : 0}% utilizado`} icon={<Banknote size={17} />} />
        <KpiCard label="Peso estruturado" value={`${weightTotal.toFixed(0)}%`} helper={weightTotal === 100 ? "estrutura válida" : "precisa somar 100%"} tone={weightTotal === 100 ? "success" : "warning"} icon={<Save size={17} />} />
      </section>

      <div className="split-layout work-detail-grid">
        <section className="content-card">
          <div className="content-card-head"><div><h2>Etapas da obra</h2><p>O avanço geral considera o peso de cada macro etapa</p></div><Button variant="secondary" onClick={() => setMacroDialog(true)}><Plus size={16} /> Macro etapa</Button></div>
          {macros.length === 0 ? (
            <EmptyState icon={<Hammer size={22} />} title="Estruture as etapas" description="Comece criando as macro etapas da obra. A primeira recebe peso de 100%, que pode ser redistribuído depois." action={<Button onClick={() => setMacroDialog(true)}><Plus size={16} /> Criar macro etapa</Button>} />
          ) : (
            <div className="macro-list">
              <div className={`weight-editor ${weightTotal === 100 ? "weight-valid" : "weight-invalid"}`}>
                <div><strong>Distribuição de pesos</strong><span>Total: {weightTotal.toFixed(0)}%</span></div>
                <Button variant="secondary" onClick={saveWeights} loading={saving} disabled={weightTotal !== 100}><Save size={15} /> Salvar pesos</Button>
              </div>
              {macros.map((macro) => {
                const isOpen = expanded[macro.id] ?? true;
                return (
                  <article className="macro-card" key={macro.id}>
                    <div className="macro-head">
                      <button className="macro-toggle" onClick={() => setExpanded({ ...expanded, [macro.id]: !isOpen })}>
                        {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                        <div><h3>{macro.name}</h3><span>{macro.micro_stages?.length || 0} micro etapas</span></div>
                      </button>
                      <div className="macro-weight"><label>Peso</label><div><input type="number" min="0" max="100" step="0.1" value={weights[macro.id] ?? macro.weight_percent} onChange={(event) => setWeights({ ...weights, [macro.id]: event.target.value })} /><span>%</span></div></div>
                    </div>
                    <div className="macro-progress"><ProgressBar value={Number(macro.progress_percent || 0)} label="Avanço da macro etapa" /></div>
                    {isOpen ? (
                      <div className="micro-list">
                        {(macro.micro_stages || []).map((micro) => (
                          <div className="micro-row" key={micro.id}>
                            <div className="micro-main">
                              <div><strong>{micro.name}</strong>{micro.description ? <span>{micro.description}</span> : null}</div>
                              <ProgressBar value={micro.progress_percent} />
                            </div>
                            <div className="micro-supplies"><Package size={14} /><span>{micro.supplies?.length ? micro.supplies.map((item) => item.name).join(", ") : "Sem insumos informados"}</span></div>
                            <Button variant="secondary" onClick={() => openProgress(micro)}><Camera size={15} /> Atualizar avanço</Button>
                          </div>
                        ))}
                        <button className="add-micro" onClick={() => setMicroMacroId(macro.id)}><Plus size={15} /> Adicionar micro etapa</button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <div className="section-stack">
          <section className="content-card">
            <div className="content-card-head"><div><h2>Orçamento mensal</h2><p>Previsto versus realizado</p></div><button className="icon-button" onClick={() => setBudgetDialog(true)} aria-label="Adicionar competência"><Plus size={17} /></button></div>
            {budgets.length ? <div className="budget-list">{budgets.map((budget) => <div key={budget.id}><div><strong>{monthBr(budget.reference_month)}</strong><span>{budget.notes || "Sem observações"}</span></div><div><small>Prev. {currency(budget.planned_amount, true)}</small><strong className={budget.realized_amount > budget.planned_amount ? "value-danger" : ""}>{currency(budget.realized_amount, true)}</strong></div></div>)}</div> : <div className="mini-empty">Nenhuma competência registrada.</div>}
          </section>
          <section className="content-card">
            <div className="content-card-head"><div><h2>Últimas atualizações</h2><p>Evidências e avanços registrados</p></div><ImageIcon size={18} /></div>
            {updates.length ? <div className="update-feed">{updates.slice(0, 6).map((update) => <article key={update.id}>{update.evidence_url ? <a href={update.evidence_url} target="_blank" rel="noreferrer"><Image src={update.evidence_url} alt={`Evidência de ${update.micro_stage_name}`} width={54} height={54} unoptimized /></a> : <div className="update-placeholder"><Camera size={18} /></div>}<div><strong>{update.micro_stage_name} · {Number(update.progress_percent).toFixed(0)}%</strong><span>{update.macro_stage_name}</span><small>{dateBr(update.created_at)}</small></div></article>)}</div> : <div className="mini-empty">As atualizações aparecerão após o primeiro registro de avanço.</div>}
          </section>
        </div>
      </div>

      <Dialog open={macroDialog} onClose={() => setMacroDialog(false)} title="Nova macro etapa" description="Ex.: Terraplenagem, infraestrutura, fundações ou acabamento."><form className="form-grid" onSubmit={addMacro}><Field label="Nome"><input value={macroForm.name} onChange={(event) => setMacroForm({ ...macroForm, name: event.target.value })} required maxLength={120} /></Field><Field label="Descrição"><textarea value={macroForm.description} onChange={(event) => setMacroForm({ ...macroForm, description: event.target.value })} maxLength={1000} /></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setMacroDialog(false)}>Cancelar</Button><Button type="submit" loading={saving}>Adicionar</Button></div></form></Dialog>
      <Dialog open={Boolean(microMacroId)} onClose={() => setMicroMacroId(null)} title="Nova micro etapa" description="Detalhe a execução e os principais insumos vinculados."><form className="form-grid" onSubmit={addMicro}><Field label="Nome"><input value={microForm.name} onChange={(event) => setMicroForm({ ...microForm, name: event.target.value })} required maxLength={140} /></Field><Field label="Descrição"><textarea value={microForm.description} onChange={(event) => setMicroForm({ ...microForm, description: event.target.value })} /></Field><Field label="Insumos" hint="Separe por vírgulas. Ex.: concreto, aço, brita"><textarea value={microForm.supplies} onChange={(event) => setMicroForm({ ...microForm, supplies: event.target.value })} /></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setMicroMacroId(null)}>Cancelar</Button><Button type="submit" loading={saving}>Adicionar</Button></div></form></Dialog>
      <Dialog open={Boolean(progressMicro)} onClose={() => setProgressMicro(null)} title={`Atualizar ${progressMicro?.name || "etapa"}`} description="A foto é obrigatória para registrar qualquer alteração no percentual."><form className="form-grid" onSubmit={updateProgress}><Field label="Novo avanço"><div className="range-field"><input type="range" min="0" max="100" step="1" value={progressForm.progress} onChange={(event) => setProgressForm({ ...progressForm, progress: event.target.value })} /><strong>{progressForm.progress}%</strong></div></Field><Field label="Evidência fotográfica" hint="PNG, JPG ou WEBP. Evite imagens com dados pessoais."><label className="file-drop"><Upload size={20} /><span>{progressForm.file?.name || "Selecionar foto"}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setProgressForm({ ...progressForm, file: event.target.files?.[0] || null })} required /></label></Field><Field label="Comentário da atualização"><textarea value={progressForm.note} onChange={(event) => setProgressForm({ ...progressForm, note: event.target.value })} placeholder="O que foi executado desde a última atualização?" maxLength={1500} /></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setProgressMicro(null)}>Cancelar</Button><Button type="submit" loading={saving} disabled={!progressForm.file}><Camera size={16} /> Registrar evidência e avanço</Button></div></form></Dialog>
      <Dialog open={budgetDialog} onClose={() => setBudgetDialog(false)} title="Atualizar orçamento mensal" description="Se o mês já existir, os valores serão atualizados."><form className="form-grid" onSubmit={saveBudget}><Field label="Mês de referência"><input type="month" value={budgetForm.reference_month} onChange={(event) => setBudgetForm({ ...budgetForm, reference_month: event.target.value })} required /></Field><Field label="Previsto no mês"><input type="number" min="0" step="0.01" value={budgetForm.planned_amount} onChange={(event) => setBudgetForm({ ...budgetForm, planned_amount: event.target.value })} required /></Field><Field label="Realizado no mês"><input type="number" min="0" step="0.01" value={budgetForm.realized_amount} onChange={(event) => setBudgetForm({ ...budgetForm, realized_amount: event.target.value })} required /></Field><Field label="Observações"><textarea value={budgetForm.notes} onChange={(event) => setBudgetForm({ ...budgetForm, notes: event.target.value })} /></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setBudgetDialog(false)}>Cancelar</Button><Button type="submit" loading={saving}>Salvar competência</Button></div></form></Dialog>
      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}
