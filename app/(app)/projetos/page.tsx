"use client";

import { Button, Dialog, EmptyState, Field, KpiCard, PageIntro, ProgressBar, StatusPill, Toast } from "@/components/ui";
import { ListToolbar } from "@/components/list-toolbar";
import { UserSelect } from "@/components/user-select";
import { dateBr, todayIso } from "@/lib/format";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { Project, ProjectStatus, ProjectTemplate, UserProfile } from "@/lib/types";
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
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const supabase = getSupabase();
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [filter, setFilter] = useState<ProjectFilter>("current");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "all">("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionProject, setActionProject] = useState<Project | null>(null);
  const [projectAction, setProjectAction] = useState<ProjectAction>("archive");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [form, setForm] = useState({ name: "", start_date: todayIso(), owner_user_id: "", template_id: "" });

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [projectResult, userResult, templateResult, templateTaskResult] = await Promise.all([
      supabase.from("project_progress_summary").select("*").order("updated_at", { ascending: false }),
      supabase.from("profiles").select("user_id,full_name,email,active,is_admin").eq("active", true).not("email", "is", null).order("full_name"),
      supabase.from("project_templates").select("*").eq("is_active", true).order("name"),
      supabase.from("project_template_tasks").select("id,template_id"),
    ]);
    if (projectResult.error) setToast({ message: friendlyError(projectResult.error), type: "error" });
    if (userResult.error) setToast({ message: friendlyError(userResult.error), type: "error" });
    if (templateResult.error || templateTaskResult.error) setToast({ message: friendlyError(templateResult.error || templateTaskResult.error), type: "error" });
    setProjects((projectResult.data || []) as Project[]);
    setUsers((userResult.data || []) as UserProfile[]);
    setTemplates(((templateResult.data || []) as ProjectTemplate[]).map((template) => ({ ...template, task_count: (templateTaskResult.data || []).filter((task) => task.template_id === template.id).length })));
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const currentProjects = useMemo(() => projects.filter((project) => !project.archived_at), [projects]);
  const archivedProjects = useMemo(() => projects.filter((project) => Boolean(project.archived_at)), [projects]);
  const visibleProjects = useMemo(() => {
    const source = filter === "current" ? currentProjects : archivedProjects;
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return source.filter((project) => {
      const matchesSearch = !normalized || [project.name, project.owner_name, project.owner_email, project.objective].some((value) => value?.toLocaleLowerCase("pt-BR").includes(normalized));
      const matchesStatus = statusFilter === "all" || project.status === statusFilter;
      const matchesOverdue = !overdueOnly || Number(project.overdue_tasks || 0) > 0;
      return matchesSearch && matchesStatus && matchesOverdue;
    });
  }, [archivedProjects, currentProjects, filter, overdueOnly, query, statusFilter]);
  const selectedTemplate = templates.find((template) => template.id === form.template_id);

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
    if (!users.some((user) => user.user_id === form.owner_user_id)) {
      setToast({ message: "Selecione um usuário ativo como responsável.", type: "error" });
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("create_project_from_template", {
      p_name: form.name.trim(),
      p_owner_user_id: form.owner_user_id,
      p_start_date: form.start_date,
      p_template_id: form.template_id || null,
    });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setDialogOpen(false);
    setFilter("current");
    setForm({ name: "", start_date: todayIso(), owner_user_id: "", template_id: "" });
    setToast({ message: selectedTemplate ? "Projeto criado com as tarefas do modelo." : "Projeto criado e pronto para receber tarefas.", type: "success" });
    await loadData();
    if (data) router.push(`/projetos/${data}`);
  }

  async function quickUpdate(project: Project, updates: Partial<Pick<Project, "status" | "owner_user_id" | "end_date">>) {
    if (!supabase) return;
    const previous = projects;
    setProjects((items) => items.map((item) => item.id === project.id ? { ...item, ...updates } : item));
    const { error } = await supabase.from("projects").update(updates).eq("id", project.id);
    if (error) {
      setProjects(previous);
      return setToast({ message: friendlyError(error), type: "error" });
    }
    setToast({ message: `Projeto ${project.name} atualizado.`, type: "success" });
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
        <ListToolbar query={query} onQueryChange={setQuery}>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ProjectStatus | "all")} aria-label="Filtrar por status"><option value="all">Todos os status</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <label className="filter-check"><input type="checkbox" checked={overdueOnly} onChange={(event) => setOverdueOnly(event.target.checked)} /> Com tarefas atrasadas</label>
        </ListToolbar>
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
              <article className={`project-card ${project.archived_at ? "project-card-archived" : ""} ${Number(project.overdue_tasks || 0) > 0 ? "exception-card" : ""}`} key={project.id}>
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
                </Link>
                {!project.archived_at ? <div className="quick-edit-grid project-quick-edit">
                  <label><span>Status</span><select value={project.status} onChange={(event) => void quickUpdate(project, { status: event.target.value as ProjectStatus })}>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label><span>Responsável</span><select value={project.owner_user_id || ""} onChange={(event) => void quickUpdate(project, { owner_user_id: event.target.value })}>{users.map((user) => <option key={user.user_id} value={user.user_id}>{user.full_name || user.email}</option>)}</select></label>
                  <label><span>Prazo</span><input type="date" min={project.start_date} value={project.end_date || ""} onChange={(event) => void quickUpdate(project, { end_date: event.target.value || null })} /></label>
                </div> : null}
                <Link href={`/projetos/${project.id}`} className="project-card-link"><div className="project-stats"><div><span>Responsável</span><strong>{project.owner_name}</strong></div><div><span>Prazo</span><strong>{dateBr(project.end_date)}</strong></div><div><span>Tarefas</span><strong>{project.completed_tasks || 0}/{project.total_tasks || 0}</strong></div></div><div className="project-card-footer"><span><Users size={13} /> {project.owner_email}</span><span className="inline-link">Abrir projeto <ArrowUpRight size={14} /></span></div></Link>
              </article>
            ))}
          </div>
        )}
      </section>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Novo projeto" description="Comece com o essencial e use um modelo para criar as tarefas automaticamente." wide>
        <form className="form-grid" onSubmit={createProject}>
          <Field label="Nome do projeto"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={140} required autoFocus /></Field>
          <Field label="Responsável" hint="Lista de usuários ativos cadastrados no Supabase.">
            <UserSelect users={users} value={form.owner_user_id} onChange={(user) => setForm({ ...form, owner_user_id: user?.user_id || "" })} required />
            {users.length === 0 ? <span className="field-empty-hint">Nenhum usuário ativo com e-mail foi encontrado no Supabase.</span> : null}
          </Field>
          <Field label="Data de início"><input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} required /></Field>
          <Field label="Modelo de tarefas" hint="Opcional. Prazos são calculados a partir da data de início."><select value={form.template_id} onChange={(event) => setForm({ ...form, template_id: event.target.value })}><option value="">Sem modelo</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></Field>
          {selectedTemplate ? <div className="template-preview form-span-2"><strong>{selectedTemplate.name}</strong><p>{selectedTemplate.description}</p><span>{selectedTemplate.task_count} tarefas com prazos relativos · responsável inicial herdado do projeto</span></div> : null}
          <div className="form-actions"><Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button type="submit" loading={saving}>Criar e abrir projeto</Button></div>
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
