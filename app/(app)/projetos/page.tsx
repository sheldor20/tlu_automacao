"use client";

import { Button, Dialog, EmptyState, Field, KpiCard, PageIntro, ProgressBar, StatusPill, Toast } from "@/components/ui";
import { dateBr, todayIso } from "@/lib/format";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { Project, ProjectStatus } from "@/lib/types";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  CalendarCheck,
  CheckCircle2,
  FolderKanban,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const statusLabel: Record<ProjectStatus, string> = {
  planejamento: "Planejamento",
  ativo: "Ativo",
  pausado: "Pausado",
  concluido: "Concluído",
};

type ProjectFilter = "current" | "archived";
type ProjectAction = "archive" | "delete";

export default function ProjectsPage() {
  const supabase = getSupabase();
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState<ProjectFilter>("current");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionProject, setActionProject] = useState<Project | null>(null);
  const [projectAction, setProjectAction] = useState<ProjectAction>("archive");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [form, setForm] = useState({ name: "", start_date: todayIso(), end_date: "", owner_name: "", owner_email: "", objective: "" });

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase.from("project_progress_summary").select("*").order("updated_at", { ascending: false });
    if (error) setToast({ message: friendlyError(error), type: "error" });
    setProjects((data || []) as Project[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const currentProjects = useMemo(() => projects.filter((project) => !project.archived_at), [projects]);
  const archivedProjects = useMemo(() => projects.filter((project) => Boolean(project.archived_at)), [projects]);
  const visibleProjects = filter === "current" ? currentProjects : archivedProjects;

  const metrics = useMemo(() => {
    const active = currentProjects.filter((project) => project.status === "ativo").length;
    const completed = currentProjects.reduce((sum, project) => sum + Number(project.completed_tasks || 0), 0);
    const total = currentProjects.reduce((sum, project) => sum + Number(project.total_tasks || 0), 0);
    const overdue = currentProjects.reduce((sum, project) => sum + Number(project.overdue_tasks || 0), 0);
    const average = currentProjects.length
      ? currentProjects.reduce((sum, project) => sum + Number(project.progress_percent || 0), 0) / currentProjects.length
      : 0;
    return { active, completed, total, overdue, average };
  }, [currentProjects]);

  async function createProject(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    const { error } = await supabase.from("projects").insert({
      name: form.name.trim(),
      start_date: form.start_date,
      end_date: form.end_date || null,
      owner_name: form.owner_name.trim(),
      owner_email: form.owner_email.trim().toLowerCase(),
      objective: form.objective.trim(),
      status: "ativo",
    });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setDialogOpen(false);
    setFilter("current");
    setForm({ name: "", start_date: todayIso(), end_date: "", owner_name: "", owner_email: "", objective: "" });
    setToast({ message: "Projeto criado e pronto para receber tarefas.", type: "success" });
    await loadData();
  }

  function requestAction(project: Project, action: ProjectAction) {
    setActionProject(project);
    setProjectAction(action);
  }

  async function archiveProject(project: Project) {
    if (!supabase) return;
    setSaving(true);
    const { data } = await supabase.auth.getUser();
    const archived = Boolean(project.archived_at);
    const { error } = await supabase
      .from("projects")
      .update({ archived_at: archived ? null : new Date().toISOString(), archived_by: archived ? null : data.user?.id || null })
      .eq("id", project.id);
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setActionProject(null);
    setToast({ message: archived ? "Projeto restaurado." : "Projeto arquivado sem perder o histórico.", type: "success" });
    await loadData();
  }

  async function deleteProject(project: Project) {
    if (!supabase) return;
    setSaving(true);
    const { count, error: relationError } = await supabase
      .from("businesses")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project.id);
    if (relationError) {
      setSaving(false);
      return setToast({ message: friendlyError(relationError), type: "error" });
    }
    if (count) {
      setSaving(false);
      setActionProject(null);
      return setToast({ message: "Este projeto está conectado a um novo negócio. Arquive-o para preservar o histórico.", type: "error" });
    }

    const { data: fileRows } = await supabase.from("project_files").select("file_path").eq("project_id", project.id);
    const { error } = await supabase.from("projects").delete().eq("id", project.id);
    if (error) {
      setSaving(false);
      return setToast({ message: friendlyError(error), type: "error" });
    }
    const paths = (fileRows || []).map((item) => item.file_path).filter(Boolean);
    if (paths.length) await supabase.storage.from("project-files").remove(paths);
    setSaving(false);
    setActionProject(null);
    setToast({ message: "Projeto excluído definitivamente.", type: "success" });
    await loadData();
  }

  return (
    <>
      <PageIntro
        eyebrow="Departamento · Projetos"
        title="Projetos e entregas"
        description="Uma visão simples, combinando tarefas visuais com contexto, arquivos e colaboração."
        action={<Button onClick={() => setDialogOpen(true)}><Plus size={18} /> Novo projeto</Button>}
      />

      <section className="kpi-grid">
        <KpiCard label="Projetos ativos" value={String(metrics.active)} helper={`${currentProjects.length} em acompanhamento`} icon={<FolderKanban size={17} />} />
        <KpiCard label="Avanço médio" value={`${metrics.average.toFixed(0)}%`} helper="baseado nas tarefas" tone="success" icon={<CheckCircle2 size={17} />} />
        <KpiCard label="Tarefas concluídas" value={`${metrics.completed}/${metrics.total}`} helper="em projetos atuais" icon={<CalendarCheck size={17} />} />
        <KpiCard label="Tarefas atrasadas" value={String(metrics.overdue)} helper={metrics.overdue ? "precisam de atenção" : "nenhum alerta aberto"} tone={metrics.overdue ? "warning" : "success"} icon={<AlertTriangle size={17} />} />
      </section>

      <section className="content-card">
        <div className="content-card-head project-list-head">
          <div><h2>{filter === "current" ? "Projetos atuais" : "Projetos arquivados"}</h2><p>Progresso, responsáveis, alertas e gestão do histórico</p></div>
          <div className="segmented" aria-label="Filtrar projetos">
            <button type="button" className={filter === "current" ? "active" : ""} onClick={() => setFilter("current")}>Atuais · {currentProjects.length}</button>
            <button type="button" className={filter === "archived" ? "active" : ""} onClick={() => setFilter("archived")}>Arquivados · {archivedProjects.length}</button>
          </div>
        </div>
        {loading ? <div className="list-loading">Carregando projetos…</div> : visibleProjects.length === 0 ? (
          <EmptyState
            icon={filter === "current" ? <FolderKanban size={23} /> : <Archive size={23} />}
            title={filter === "current" ? "Crie o primeiro projeto" : "Nenhum projeto arquivado"}
            description={filter === "current" ? "Organize objetivo, responsáveis, tarefas, comentários e arquivos em uma visão única." : "Projetos arquivados aparecerão aqui e poderão ser restaurados."}
            action={filter === "current" ? <Button onClick={() => setDialogOpen(true)}><Plus size={17} /> Criar projeto</Button> : undefined}
          />
        ) : (
          <div className="projects-grid">
            {visibleProjects.map((project) => (
              <article className={`project-card ${project.archived_at ? "project-card-archived" : ""}`} key={project.id}>
                <div className="project-card-top">
                  <div className="project-card-pills">
                    <StatusPill tone={project.status === "concluido" ? "success" : project.status === "pausado" ? "warning" : "info"}>{statusLabel[project.status]}</StatusPill>
                    {project.archived_at ? <StatusPill tone="neutral">Arquivado</StatusPill> : null}
                    {Number(project.overdue_tasks || 0) > 0 ? <StatusPill tone="danger"><AlertTriangle size={11} /> {project.overdue_tasks} atrasadas</StatusPill> : null}
                  </div>
                  <div className="project-card-actions">
                    <button
                      type="button"
                      onClick={() => project.archived_at ? void archiveProject(project) : requestAction(project, "archive")}
                      aria-label={project.archived_at ? `Restaurar ${project.name}` : `Arquivar ${project.name}`}
                      title={project.archived_at ? "Restaurar projeto" : "Arquivar projeto"}
                    >
                      {project.archived_at ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                    </button>
                    <button type="button" className="danger" onClick={() => requestAction(project, "delete")} aria-label={`Excluir ${project.name}`} title="Excluir projeto"><Trash2 size={16} /></button>
                  </div>
                </div>
                <Link href={`/projetos/${project.id}`} className="project-card-link">
                  <div className="project-card-title"><h3>{project.name}</h3><p>{project.objective}</p></div>
                  <ProgressBar value={Number(project.progress_percent || 0)} label="Progresso das tarefas" />
                  <div className="project-stats"><div><span>Responsável</span><strong>{project.owner_name}</strong></div><div><span>Prazo</span><strong>{dateBr(project.end_date)}</strong></div><div><span>Tarefas</span><strong>{project.completed_tasks || 0}/{project.total_tasks || 0}</strong></div></div>
                  <div className="project-card-footer"><span><Users size={13} /> {project.owner_email}</span><span className="inline-link">Abrir projeto <ArrowUpRight size={14} /></span></div>
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Novo projeto" description="Defina o contexto essencial; as tarefas e envolvidos entram na próxima etapa." wide>
        <form className="form-grid" onSubmit={createProject}>
          <Field label="Nome do projeto"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={140} required /></Field>
          <Field label="Responsável"><input value={form.owner_name} onChange={(event) => setForm({ ...form, owner_name: event.target.value })} maxLength={140} required /></Field>
          <Field label="E-mail do responsável"><input type="email" value={form.owner_email} onChange={(event) => setForm({ ...form, owner_email: event.target.value })} required /></Field>
          <Field label="Data de início"><input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} required /></Field>
          <Field label="Previsão de fim"><input type="date" min={form.start_date} value={form.end_date} onChange={(event) => setForm({ ...form, end_date: event.target.value })} /></Field>
          <Field label="Objetivo" hint="Descreva o resultado que define o sucesso deste projeto." className="form-span-2"><textarea value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} maxLength={2500} required /></Field>
          <div className="form-actions"><Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button type="submit" loading={saving}>Criar projeto</Button></div>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(actionProject)}
        onClose={() => setActionProject(null)}
        title={projectAction === "delete" ? "Excluir projeto?" : "Arquivar projeto?"}
        description={projectAction === "delete" ? "A exclusão é definitiva e remove tarefas, comentários e arquivos. Projetos ligados a negócios não podem ser excluídos." : "O projeto sairá da visão atual, mas todo o histórico será preservado e poderá ser restaurado."}
      >
        <div className="confirmation-content">
          <strong>{actionProject?.name}</strong>
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={() => setActionProject(null)}>Cancelar</Button>
            <Button
              type="button"
              variant={projectAction === "delete" ? "danger" : "primary"}
              loading={saving}
              onClick={() => actionProject && (projectAction === "delete" ? void deleteProject(actionProject) : void archiveProject(actionProject))}
            >
              {projectAction === "delete" ? <><Trash2 size={16} /> Excluir definitivamente</> : <><Archive size={16} /> Arquivar projeto</>}
            </Button>
          </div>
        </div>
      </Dialog>

      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}
