"use client";

import { ListToolbar } from "@/components/list-toolbar";
import { Button, Dialog, EmptyState, Field, KpiCard, PageIntro, ProgressBar, StatusPill, Toast } from "@/components/ui";
import { currency, dateBr, daysBetween, todayIso } from "@/lib/format";
import { friendlyError, getSupabase, storagePath } from "@/lib/supabase";
import type { Construction, ConstructionTemplate, MicroStage, UserProfile } from "@/lib/types";
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  Banknote,
  Building2,
  CalendarClock,
  Camera,
  CircleDollarSign,
  Hammer,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const statusLabel: Record<Construction["status"], string> = {
  planejamento: "Planejamento",
  em_andamento: "Em andamento",
  pausada: "Pausada",
  concluida: "Concluída",
};

type WorkFilter = "current" | "archived";
type WorkAction = "archive" | "delete";
type WorkException = "all" | "stale" | "budget";

export default function WorksPage() {
  const router = useRouter();
  const supabase = getSupabase();
  const [works, setWorks] = useState<Construction[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [templates, setTemplates] = useState<ConstructionTemplate[]>([]);
  const [filter, setFilter] = useState<WorkFilter>("current");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<Construction["status"] | "all">("all");
  const [exceptionFilter, setExceptionFilter] = useState<WorkException>("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionWork, setActionWork] = useState<Construction | null>(null);
  const [workAction, setWorkAction] = useState<WorkAction>("archive");
  const [progressWork, setProgressWork] = useState<Construction | null>(null);
  const [progressMicros, setProgressMicros] = useState<MicroStage[]>([]);
  const [progressForm, setProgressForm] = useState({ micro_id: "", progress: "0", note: "", file: null as File | null });
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [form, setForm] = useState({
    name: "",
    type: "loteamento" as Construction["type"],
    start_date: todayIso(),
    template_id: "",
  });

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [workResult, userResult, templateResult, macroResult, microResult] = await Promise.all([
      supabase.from("construction_progress_summary").select("*").order("updated_at", { ascending: false }),
      supabase.from("profiles").select("user_id,full_name,email,active,is_admin").eq("active", true).not("email", "is", null).order("full_name"),
      supabase.from("construction_templates").select("*").eq("is_active", true).order("name"),
      supabase.from("construction_template_macro_stages").select("id,template_id"),
      supabase.from("construction_template_micro_stages").select("id,template_macro_id"),
    ]);
    const firstError = workResult.error || userResult.error || templateResult.error || macroResult.error || microResult.error;
    if (firstError) setToast({ message: friendlyError(firstError), type: "error" });
    const macros = macroResult.data || [];
    const micros = microResult.data || [];
    setWorks((workResult.data || []) as Construction[]);
    setUsers((userResult.data || []) as UserProfile[]);
    setTemplates(((templateResult.data || []) as ConstructionTemplate[]).map((template) => {
      const templateMacros = macros.filter((macro) => macro.template_id === template.id);
      const macroIds = new Set(templateMacros.map((macro) => macro.id));
      return { ...template, macro_count: templateMacros.length, micro_count: micros.filter((micro) => macroIds.has(micro.template_macro_id)).length };
    }));
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const currentWorks = useMemo(() => works.filter((work) => !work.archived_at), [works]);
  const archivedWorks = useMemo(() => works.filter((work) => Boolean(work.archived_at)), [works]);
  const visibleWorks = useMemo(() => {
    const source = filter === "current" ? currentWorks : archivedWorks;
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return source.filter((work) => {
      const stale = work.status !== "concluida" && daysBetween(work.last_activity_at || work.created_at) >= 7;
      const overBudget = Number(work.planned_budget) > 0 && Number(work.realized_total || 0) > Number(work.planned_budget);
      const matchesSearch = !normalized || [work.name, work.address, work.responsible_name, work.responsible_email].some((value) => value?.toLocaleLowerCase("pt-BR").includes(normalized));
      const matchesStatus = statusFilter === "all" || work.status === statusFilter;
      const matchesException = exceptionFilter === "all" || (exceptionFilter === "stale" ? stale : overBudget);
      return matchesSearch && matchesStatus && matchesException;
    });
  }, [archivedWorks, currentWorks, exceptionFilter, filter, query, statusFilter]);

  const compatibleTemplates = useMemo(() => templates.filter((template) => template.type === form.type), [form.type, templates]);
  const selectedTemplate = templates.find((template) => template.id === form.template_id);

  const metrics = useMemo(() => {
    const planned = currentWorks.reduce((sum, work) => sum + Number(work.planned_budget || 0), 0);
    const realized = currentWorks.reduce((sum, work) => sum + Number(work.realized_total || 0), 0);
    const month = currentWorks.reduce((sum, work) => sum + Number(work.realized_current_month || 0), 0);
    const progress = currentWorks.length ? currentWorks.reduce((sum, work) => sum + Number(work.progress_percent || 0), 0) / currentWorks.length : 0;
    return { planned, realized, month, progress };
  }, [currentWorks]);

  async function createWork(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("create_construction_from_template", {
      p_name: form.name.trim(),
      p_type: form.type,
      p_start_date: form.start_date,
      p_template_id: form.template_id || null,
    });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setDialogOpen(false);
    setForm({ name: "", type: "loteamento", start_date: todayIso(), template_id: "" });
    setToast({ message: selectedTemplate ? "Obra criada com todas as etapas do modelo." : "Obra criada para estruturação manual.", type: "success" });
    await loadData();
    if (data) router.push(`/obras/${data}`);
  }

  async function quickUpdate(work: Construction, updates: Partial<Pick<Construction, "status" | "responsible_user_id" | "expected_end_date">>) {
    if (!supabase) return;
    const previous = works;
    setWorks((items) => items.map((item) => item.id === work.id ? { ...item, ...updates } : item));
    const { error } = await supabase.from("constructions").update(updates).eq("id", work.id);
    if (error) {
      setWorks(previous);
      return setToast({ message: friendlyError(error), type: "error" });
    }
    setToast({ message: `Obra ${work.name} atualizada.`, type: "success" });
    await loadData();
  }

  async function openQuickProgress(work: Construction) {
    if (!supabase) return;
    const { data: macroRows, error: macroError } = await supabase.from("construction_macro_stages").select("id").eq("construction_id", work.id);
    if (macroError) return setToast({ message: friendlyError(macroError), type: "error" });
    const macroIds = (macroRows || []).map((macro) => macro.id);
    if (!macroIds.length) return setToast({ message: "Abra a obra e crie ou aplique um modelo de etapas primeiro.", type: "error" });
    const { data, error } = await supabase.from("construction_micro_stages").select("*").in("macro_stage_id", macroIds).order("position");
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    const micros = (data || []) as MicroStage[];
    if (!micros.length) return setToast({ message: "A obra ainda não possui micro etapas para atualização.", type: "error" });
    setProgressWork(work);
    setProgressMicros(micros);
    setProgressForm({ micro_id: micros[0].id, progress: String(micros[0].progress_percent), note: "", file: null });
  }

  async function saveQuickProgress(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !progressWork || !progressForm.micro_id || !progressForm.file) return;
    setSaving(true);
    const path = storagePath(progressWork.id, progressForm.file.name, progressForm.micro_id);
    const upload = await supabase.storage.from("construction-evidence").upload(path, progressForm.file, { cacheControl: "3600", upsert: false });
    if (upload.error) {
      setSaving(false);
      return setToast({ message: friendlyError(upload.error), type: "error" });
    }
    const evidence = await supabase.from("construction_evidence").insert({ construction_id: progressWork.id, micro_stage_id: progressForm.micro_id, file_path: path, file_name: progressForm.file.name, note: progressForm.note.trim() || null }).select("id").single();
    if (evidence.error) {
      await supabase.storage.from("construction-evidence").remove([path]);
      setSaving(false);
      return setToast({ message: friendlyError(evidence.error), type: "error" });
    }
    const update = await supabase.from("construction_micro_stages").update({ progress_percent: Number(progressForm.progress), last_evidence_id: evidence.data.id }).eq("id", progressForm.micro_id);
    setSaving(false);
    if (update.error) return setToast({ message: friendlyError(update.error), type: "error" });
    setProgressWork(null);
    setToast({ message: "Evidência registrada e avanço da obra recalculado.", type: "success" });
    await loadData();
  }

  function requestAction(work: Construction, action: WorkAction) {
    setActionWork(work);
    setWorkAction(action);
  }

  async function archiveWork(work: Construction) {
    if (!supabase) return;
    setSaving(true);
    const { data } = await supabase.auth.getUser();
    const archived = Boolean(work.archived_at);
    const { error } = await supabase.from("constructions").update({ archived_at: archived ? null : new Date().toISOString(), archived_by: archived ? null : data.user?.id || null }).eq("id", work.id);
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setActionWork(null);
    setToast({ message: archived ? "Obra restaurada." : "Obra arquivada sem perder o histórico.", type: "success" });
    await loadData();
  }

  async function deleteWork(work: Construction) {
    if (!supabase) return;
    setSaving(true);
    const { data: evidenceRows, error: evidenceError } = await supabase.from("construction_evidence").select("file_path").eq("construction_id", work.id);
    if (evidenceError) {
      setSaving(false);
      return setToast({ message: friendlyError(evidenceError), type: "error" });
    }
    const { error } = await supabase.from("constructions").delete().eq("id", work.id);
    if (error) {
      setSaving(false);
      return setToast({ message: friendlyError(error), type: "error" });
    }
    const paths = (evidenceRows || []).map((item) => item.file_path).filter(Boolean);
    if (paths.length) await supabase.storage.from("construction-evidence").remove(paths);
    setSaving(false);
    setActionWork(null);
    setToast({ message: "Obra excluída definitivamente.", type: "success" });
    await loadData();
  }

  return (
    <>
      <PageIntro eyebrow="Departamento · Obras" title="Gestão de obras" description="Avanço físico, evidências e controle financeiro de loteamentos e construções." action={<Button onClick={() => setDialogOpen(true)}><Plus size={18} /> Nova obra</Button>} />

      <section className="kpi-grid">
        <KpiCard label="Avanço médio" value={`${metrics.progress.toFixed(0)}%`} helper={`${currentWorks.length} obras no portfólio`} tone="success" icon={<Hammer size={17} />} />
        <KpiCard label="Orçamento previsto" value={currency(metrics.planned, true)} helper="total do departamento" icon={<CircleDollarSign size={17} />} />
        <KpiCard label="Realizado acumulado" value={currency(metrics.realized, true)} helper={`${metrics.planned ? (metrics.realized / metrics.planned * 100).toFixed(0) : 0}% do previsto`} icon={<Banknote size={17} />} />
        <KpiCard label="Gasto no mês" value={currency(metrics.month, true)} helper="competência atual" icon={<CalendarClock size={17} />} />
      </section>

      <section className="content-card">
        <div className="content-card-head project-list-head"><div><h2>{filter === "current" ? "Portfólio de obras" : "Obras arquivadas"}</h2><p>Atualize os campos principais sem sair da lista</p></div><div className="segmented" aria-label="Filtrar obras"><button type="button" className={filter === "current" ? "active" : ""} onClick={() => setFilter("current")}>Atuais · {currentWorks.length}</button><button type="button" className={filter === "archived" ? "active" : ""} onClick={() => setFilter("archived")}>Arquivadas · {archivedWorks.length}</button></div></div>
        <ListToolbar query={query} onQueryChange={setQuery}>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as Construction["status"] | "all")} aria-label="Filtrar por status"><option value="all">Todos os status</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select value={exceptionFilter} onChange={(event) => setExceptionFilter(event.target.value as WorkException)} aria-label="Filtrar exceções"><option value="all">Todas as situações</option><option value="stale">Sem atualização há 7+ dias</option><option value="budget">Orçamento excedido</option></select>
        </ListToolbar>
        {loading ? <div className="list-loading">Carregando obras…</div> : visibleWorks.length === 0 ? (
          <EmptyState icon={filter === "current" ? <Building2 size={23} /> : <Archive size={23} />} title={filter === "current" ? "Nenhuma obra encontrada" : "Nenhuma obra arquivada"} description={query || statusFilter !== "all" || exceptionFilter !== "all" ? "Ajuste os filtros para ampliar o resultado." : "Crie uma obra avulsa ou avance um negócio até a fase Obra."} action={filter === "current" && !query ? <Button onClick={() => setDialogOpen(true)}><Plus size={17} /> Criar obra</Button> : undefined} />
        ) : <div className="works-grid">{visibleWorks.map((work) => {
          const realized = Number(work.realized_total || 0);
          const budgetPercent = work.planned_budget ? realized / Number(work.planned_budget) * 100 : 0;
          const stale = work.status !== "concluida" && daysBetween(work.last_activity_at || work.created_at) >= 7;
          return <article className={`work-card ${work.archived_at ? "work-card-archived" : ""} ${stale || budgetPercent > 100 ? "exception-card" : ""}`} key={work.id}>
            <div className="work-card-head"><div className="work-type-icon"><Building2 size={20} /></div><div className="work-card-actions">{budgetPercent > 100 ? <StatusPill tone="danger">Orçamento excedido</StatusPill> : stale ? <StatusPill tone="warning">Sem atualização</StatusPill> : null}{work.archived_at ? <StatusPill tone="neutral">Arquivada</StatusPill> : null}<button type="button" onClick={() => work.archived_at ? void archiveWork(work) : requestAction(work, "archive")} title={work.archived_at ? "Restaurar obra" : "Arquivar obra"}>{work.archived_at ? <ArchiveRestore size={16} /> : <Archive size={16} />}</button><button type="button" className="danger" onClick={() => requestAction(work, "delete")} title="Excluir obra"><Trash2 size={16} /></button></div></div>
            <Link href={`/obras/${work.id}`} className="work-card-link"><div className="work-title"><span>{work.type === "loteamento" ? "Loteamento" : "Construção"}</span><h3>{work.name}</h3><p>{work.address || "Localização a definir"}</p></div><ProgressBar value={Number(work.progress_percent || 0)} label="Avanço físico" /></Link>
            {!work.archived_at ? <div className="quick-edit-grid work-quick-edit">
              <label><span>Status</span><select value={work.status} onChange={(event) => void quickUpdate(work, { status: event.target.value as Construction["status"] })}>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label><span>Responsável</span><select value={work.responsible_user_id || ""} onChange={(event) => void quickUpdate(work, { responsible_user_id: event.target.value || null })}><option value="">A definir</option>{users.map((user) => <option key={user.user_id} value={user.user_id}>{user.full_name || user.email}</option>)}</select></label>
              <label><span>Prazo</span><input type="date" value={work.expected_end_date || ""} min={work.start_date} onChange={(event) => void quickUpdate(work, { expected_end_date: event.target.value || null })} /></label>
              <Button variant="secondary" onClick={() => void openQuickProgress(work)}><Camera size={15} /> Avanço</Button>
            </div> : null}
            <Link href={`/obras/${work.id}`} className="work-card-link"><div className="work-financial"><div><span>Previsto</span><strong>{currency(work.planned_budget, true)}</strong></div><div><span>Realizado</span><strong>{currency(realized, true)}</strong></div><div><span>Uso</span><strong className={budgetPercent > 100 ? "value-danger" : ""}>{budgetPercent.toFixed(0)}%</strong></div></div><div className="work-card-footer"><span>{dateBr(work.start_date)} → {dateBr(work.expected_end_date)}</span><span className="inline-link">Abrir obra <ArrowUpRight size={14} /></span></div></Link>
          </article>;
        })}</div>}
      </section>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Nova obra" description="Comece com o essencial e escolha um modelo para receber as etapas automaticamente." wide>
        <form className="form-grid" onSubmit={createWork}>
          <Field label="Nome da obra"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required maxLength={140} autoFocus /></Field>
          <Field label="Tipo"><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as Construction["type"], template_id: "" })}><option value="loteamento">Loteamento</option><option value="construcao">Construção</option></select></Field>
          <Field label="Data de início"><input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} required /></Field>
          <Field label="Modelo de etapas" hint="Opcional. Você poderá estruturar manualmente depois."><select value={form.template_id} onChange={(event) => setForm({ ...form, template_id: event.target.value })}><option value="">Sem modelo</option>{compatibleTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></Field>
          {selectedTemplate ? <div className="template-preview form-span-2"><strong>{selectedTemplate.name}</strong><p>{selectedTemplate.description}</p><span>{selectedTemplate.macro_count} macro etapas · {selectedTemplate.micro_count} micro etapas · pesos somando 100%</span></div> : null}
          <div className="form-actions"><Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button type="submit" loading={saving}>Criar e abrir obra</Button></div>
        </form>
      </Dialog>

      <Dialog open={Boolean(progressWork)} onClose={() => setProgressWork(null)} title={`Atualizar avanço · ${progressWork?.name || "obra"}`} description="Escolha a micro etapa e registre a evidência obrigatória.">
        <form className="form-grid" onSubmit={saveQuickProgress}>
          <Field label="Micro etapa"><select value={progressForm.micro_id} onChange={(event) => { const micro = progressMicros.find((item) => item.id === event.target.value); setProgressForm({ ...progressForm, micro_id: event.target.value, progress: String(micro?.progress_percent || 0) }); }}>{progressMicros.map((micro) => <option key={micro.id} value={micro.id}>{micro.name}</option>)}</select></Field>
          <Field label="Novo avanço"><div className="range-field"><input type="range" min="0" max="100" step="1" value={progressForm.progress} onChange={(event) => setProgressForm({ ...progressForm, progress: event.target.value })} /><strong>{progressForm.progress}%</strong></div></Field>
          <Field label="Evidência fotográfica"><label className="file-drop"><Upload size={20} /><span>{progressForm.file?.name || "Selecionar foto"}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setProgressForm({ ...progressForm, file: event.target.files?.[0] || null })} required /></label></Field>
          <Field label="Comentário"><textarea value={progressForm.note} onChange={(event) => setProgressForm({ ...progressForm, note: event.target.value })} maxLength={1500} /></Field>
          <div className="form-actions"><Button type="button" variant="secondary" onClick={() => setProgressWork(null)}>Cancelar</Button><Button type="submit" loading={saving} disabled={!progressForm.file}><Camera size={16} /> Registrar avanço</Button></div>
        </form>
      </Dialog>

      <Dialog open={Boolean(actionWork)} onClose={() => setActionWork(null)} title={workAction === "delete" ? "Excluir obra?" : "Arquivar obra?"} description={workAction === "delete" ? "A exclusão é definitiva e remove etapas, orçamentos e evidências." : "A obra sairá da visão atual, mas todo o histórico será preservado."}><div className="confirmation-content"><strong>{actionWork?.name}</strong><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setActionWork(null)}>Cancelar</Button><Button type="button" variant={workAction === "delete" ? "danger" : "primary"} loading={saving} onClick={() => actionWork && (workAction === "delete" ? void deleteWork(actionWork) : void archiveWork(actionWork))}>{workAction === "delete" ? <><Trash2 size={16} /> Excluir definitivamente</> : <><Archive size={16} /> Arquivar obra</>}</Button></div></div></Dialog>
      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}
