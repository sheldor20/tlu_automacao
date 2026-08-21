"use client";

import { ListToolbar } from "@/components/list-toolbar";
import { Button, Dialog, EmptyState, Field, KpiCard, PageIntro, ProgressBar, StatusPill, Toast } from "@/components/ui";
import { currency, dateBr, daysBetween, todayIso } from "@/lib/format";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { Construction, ConstructionTemplate } from "@/lib/types";
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  Banknote,
  Building2,
  CalendarClock,
  CircleDollarSign,
  Hammer,
  Plus,
  Trash2,
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

const statusTone: Record<Construction["status"], "neutral" | "info" | "warning" | "success"> = {
  planejamento: "neutral",
  em_andamento: "info",
  pausada: "warning",
  concluida: "success",
};

type WorkFilter = "current" | "archived";
type WorkAction = "archive" | "delete";
type WorkException = "all" | "stale" | "budget";

export default function WorksPage() {
  const router = useRouter();
  const supabase = getSupabase();
  const [works, setWorks] = useState<Construction[]>([]);
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
    const [workResult, templateResult, macroResult, microResult] = await Promise.all([
      supabase.from("construction_progress_summary").select("*").order("updated_at", { ascending: false }),
      supabase.from("construction_templates").select("*").eq("is_active", true).order("name"),
      supabase.from("construction_template_macro_stages").select("id,template_id"),
      supabase.from("construction_template_micro_stages").select("id,template_macro_id"),
    ]);
    const firstError = workResult.error || templateResult.error || macroResult.error || microResult.error;
    if (firstError) setToast({ message: friendlyError(firstError), type: "error" });
    const macros = macroResult.data || [];
    const micros = microResult.data || [];
    setWorks((workResult.data || []) as Construction[]);
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
        <div className="content-card-head project-list-head"><div><h2>{filter === "current" ? "Portfólio de obras" : "Obras arquivadas"}</h2><p>Resumo de status, prazo e avanço</p></div><div className="segmented" aria-label="Filtrar obras"><button type="button" className={filter === "current" ? "active" : ""} onClick={() => setFilter("current")}>Atuais · {currentWorks.length}</button><button type="button" className={filter === "archived" ? "active" : ""} onClick={() => setFilter("archived")}>Arquivadas · {archivedWorks.length}</button></div></div>
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
          return <article className={`work-card work-card-compact ${work.archived_at ? "work-card-archived" : ""} ${stale || budgetPercent > 100 ? "exception-card" : ""}`} key={work.id}>
            <div className="work-card-head">
              <Link href={`/obras/${work.id}`} className="work-card-identity"><div className="work-type-icon"><Building2 size={19} /></div><div><span>{work.type === "loteamento" ? "Loteamento" : "Construção"}</span><h3>{work.name}</h3></div></Link>
              <div className="work-card-actions"><StatusPill tone={statusTone[work.status]}>{statusLabel[work.status]}</StatusPill>{budgetPercent > 100 ? <StatusPill tone="danger">Orçamento excedido</StatusPill> : stale ? <StatusPill tone="warning">Sem atualização</StatusPill> : null}{work.archived_at ? <StatusPill tone="neutral">Arquivada</StatusPill> : null}<button type="button" onClick={() => work.archived_at ? void archiveWork(work) : requestAction(work, "archive")} title={work.archived_at ? "Restaurar obra" : "Arquivar obra"}>{work.archived_at ? <ArchiveRestore size={16} /> : <Archive size={16} />}</button><button type="button" className="danger" onClick={() => requestAction(work, "delete")} title="Excluir obra"><Trash2 size={16} /></button></div>
            </div>
            <Link href={`/obras/${work.id}`} className="work-card-link work-card-summary">
              <div className="work-card-meta"><div><span>Responsável</span><strong>{work.responsible_name || "A definir"}</strong></div><div><span>Prazo</span><strong>{work.expected_end_date ? dateBr(work.expected_end_date) : "A definir"}</strong></div></div>
              <ProgressBar value={Number(work.progress_percent || 0)} label="Avanço físico" />
              <div className="work-card-footer"><span className="inline-link">Abrir obra <ArrowUpRight size={14} /></span></div>
            </Link>
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

      <Dialog open={Boolean(actionWork)} onClose={() => setActionWork(null)} title={workAction === "delete" ? "Excluir obra?" : "Arquivar obra?"} description={workAction === "delete" ? "A exclusão é definitiva e remove etapas, orçamentos e evidências." : "A obra sairá da visão atual, mas todo o histórico será preservado."}><div className="confirmation-content"><strong>{actionWork?.name}</strong><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setActionWork(null)}>Cancelar</Button><Button type="button" variant={workAction === "delete" ? "danger" : "primary"} loading={saving} onClick={() => actionWork && (workAction === "delete" ? void deleteWork(actionWork) : void archiveWork(actionWork))}>{workAction === "delete" ? <><Trash2 size={16} /> Excluir definitivamente</> : <><Archive size={16} /> Arquivar obra</>}</Button></div></div></Dialog>
      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}
