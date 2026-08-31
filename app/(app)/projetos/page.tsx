"use client";

import { Button, Dialog, EmptyState, Field, KpiCard, PageIntro, ProgressBar, StatusPill, Toast } from "@/components/ui";
import { ListToolbar } from "@/components/list-toolbar";
import { ProjectTaskEditor, taskToDraft, type ProjectTaskDraft } from "@/components/project-task-editor";
import { ProjectTaskBoard } from "@/components/project-task-board";
import { UserSelect } from "@/components/user-select";
import { dateBr, todayIso } from "@/lib/format";
import { emptyProjectTaskDraft, PROJECT_TASK_RELATIONS, projectTaskRpcPayload } from "@/lib/project-tasks";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { Project, ProjectCategory, ProjectStatus, ProjectSubtask, ProjectTask, ProjectTemplate, TaskStatus, UserProfile } from "@/lib/types";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  CheckCircle2,
  FolderKanban,
  ListTodo,
  Plus,
  Trash2,
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
type ProjectsView = "projects" | "tasks";
type TaskWithProject = ProjectTask & { projects?: { name: string; archived_at: string | null; category: ProjectCategory } | null };

export function ProjectsWorkspace({ category }: { category: ProjectCategory }) {
  const router = useRouter();
  const supabase = getSupabase();
  const governance = category === "governance";
  const baseHref = governance ? "/governanca" : "/projetos";
  const portfolioLabel = governance ? "Governança" : "Projetos";
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [view, setView] = useState<ProjectsView>("projects");
  const [filter, setFilter] = useState<ProjectFilter>("current");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "all">("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fullAccess, setFullAccess] = useState(true);
  const [currentUserId, setCurrentUserId] = useState("");
  const [taskProjectFilter, setTaskProjectFilter] = useState("all");
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  const [taskDialog, setTaskDialog] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionProject, setActionProject] = useState<Project | null>(null);
  const [projectAction, setProjectAction] = useState<ProjectAction>("archive");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [form, setForm] = useState({ name: "", start_date: todayIso(), owner_user_id: "", template_id: "" });
  const [taskForm, setTaskForm] = useState<ProjectTaskDraft>(() => emptyProjectTaskDraft("", todayIso()));

  const loadData = useCallback(async (silent = false) => {
    if (!supabase) return;
    if (!silent) setLoading(true);
    const { data: authData } = await supabase.auth.getUser();
    const [projectResult, taskResult, userResult, templateResult, templateTaskResult, permissionResult] = await Promise.all([
      supabase.from("project_progress_summary").select("*").eq("category", category).order("updated_at", { ascending: false }),
      supabase.from("project_tasks").select(`*,${PROJECT_TASK_RELATIONS},projects(name,archived_at,category)`).eq("category", category).order("position"),
      supabase.from("profiles").select("user_id,full_name,email,active,is_admin").eq("active", true).not("email", "is", null).order("full_name"),
      supabase.from("project_templates").select("*").eq("is_active", true).order("name"),
      supabase.from("project_template_tasks").select("id,template_id"),
      supabase.rpc("project_permission_scope"),
    ]);
    if (projectResult.error) setToast({ message: friendlyError(projectResult.error), type: "error" });
    if (taskResult.error) setToast({ message: friendlyError(taskResult.error), type: "error" });
    if (userResult.error) setToast({ message: friendlyError(userResult.error), type: "error" });
    if (templateResult.error || templateTaskResult.error) setToast({ message: friendlyError(templateResult.error || templateTaskResult.error), type: "error" });
    setProjects((projectResult.data || []) as Project[]);
    setTasks(((taskResult.data || []) as TaskWithProject[]).filter((task) => !task.projects?.archived_at).map((task) => ({ ...task, project_name: task.projects?.name || "Atividade avulsa" })));
    setUsers((userResult.data || []) as UserProfile[]);
    setTemplates(((templateResult.data || []) as ProjectTemplate[]).map((template) => ({ ...template, task_count: (templateTaskResult.data || []).filter((task) => task.template_id === template.id).length })));
    setFullAccess(permissionResult.data !== "assigned_tasks");
    setCurrentUserId(authData.user?.id || "");
    setLoading(false);
  }, [category, supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedView = window.localStorage.getItem(`terra-lotus-${category}-projects-view`);
      if (savedView === "projects" || savedView === "tasks") setView(savedView);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [category]);

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
  const boardTasks = useMemo(() => tasks.filter((task) => {
    if (taskProjectFilter === "all") return true;
    if (taskProjectFilter === "standalone") return task.project_id === null;
    return task.project_id === taskProjectFilter;
  }), [taskProjectFilter, tasks]);

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

  function selectView(nextView: ProjectsView) {
    setView(nextView);
    window.localStorage.setItem(`terra-lotus-${category}-projects-view`, nextView);
  }

  function openTaskForm(status: TaskStatus = "a_fazer") {
    setTaskForm(emptyProjectTaskDraft("", todayIso(), status, fullAccess ? [] : [currentUserId]));
    setTaskDialog(true);
  }

  function editTask(task: ProjectTask) {
    setTaskForm(taskToDraft(task));
    setTaskDialog(true);
  }

  async function saveTask(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    if (!fullAccess && taskForm.project_id) {
      setToast({ message: "Seu acesso permite criar somente tarefas avulsas para você.", type: "error" });
      return;
    }
    if (!taskForm.assignee_user_ids.length) {
      setToast({ message: "Selecione ao menos uma pessoa responsável.", type: "error" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("save_project_task", projectTaskRpcPayload(taskForm, category));
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setTaskDialog(false);
    setTaskForm(emptyProjectTaskDraft("", todayIso()));
    setToast({ message: taskForm.id ? "Atividade atualizada." : taskForm.project_id ? "Atividade adicionada ao projeto." : "Atividade avulsa adicionada.", type: "success" });
    await loadData(true);
  }

  async function changeTaskStatus(task: ProjectTask, status: TaskStatus) {
    if (!supabase || task.status === status || movingTaskId) return;
    const previous = tasks;
    const position = tasks.filter((item) => item.status === status).length;
    setMovingTaskId(task.id);
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status, position } : item));
    const { error } = await supabase.from("project_tasks").update({ status, position }).eq("id", task.id);
    if (error) {
      setTasks(previous);
      setMovingTaskId(null);
      return setToast({ message: friendlyError(error), type: "error" });
    }
    await loadData(true);
    setMovingTaskId(null);
  }

  async function toggleSubtask(task: ProjectTask, subtask: ProjectSubtask, completed: boolean) {
    if (!supabase || movingTaskId) return;
    setMovingTaskId(task.id);
    const { error } = await supabase.rpc("set_project_subtask_completed", { p_subtask_id: subtask.id, p_completed: completed });
    setMovingTaskId(null);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    await loadData(true);
  }

  async function deleteTask(task: ProjectTask) {
    if (!supabase || movingTaskId || !window.confirm(`Excluir a tarefa “${task.title}”?`)) return;
    setMovingTaskId(task.id);
    const { error } = await supabase.from("project_tasks").delete().eq("id", task.id);
    setMovingTaskId(null);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setToast({ message: "Tarefa excluída.", type: "success" });
    await loadData(true);
  }

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
      p_category: category,
    });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setDialogOpen(false);
    setFilter("current");
    setForm({ name: "", start_date: todayIso(), owner_user_id: "", template_id: "" });
    setToast({ message: selectedTemplate ? "Projeto criado com as tarefas do modelo." : "Projeto criado e pronto para receber tarefas.", type: "success" });
    await loadData();
    if (data) router.push(`${baseHref}/${data}`);
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
        eyebrow={`Departamento · ${portfolioLabel}`}
        title={governance ? "Governança e iniciativas estratégicas" : "Projetos e entregas"}
        description={governance ? "Acompanhe os projetos estratégicos com a mesma estrutura operacional, em uma carteira independente." : "Acompanhe os projetos de obras e do dia a dia em uma carteira operacional."}
        action={fullAccess ? <Button onClick={() => setDialogOpen(true)}><Plus size={18} /> Novo projeto</Button> : undefined}
      />

      <nav className="projects-view-switcher" aria-label="Alternar visão da página">
        <div className="projects-view-switcher-copy">
          <span>Visualização</span>
          <strong>{view === "projects" ? "Carteira de projetos" : "Quadro de tarefas"}</strong>
          <small>{view === "projects" ? "Acompanhe progresso, responsáveis e alertas." : "Organize as entregas por etapa e projeto."}</small>
        </div>
        <div className="projects-view-tabs" role="group" aria-label="Escolher conteúdo exibido">
          <button
            id="projects-view-tab"
            type="button"
            aria-pressed={view === "projects"}
            aria-controls="projects-view-panel"
            className={view === "projects" ? "active" : ""}
            onClick={() => selectView("projects")}
          >
            <FolderKanban size={18} />
            <span><strong>{portfolioLabel}</strong><small>{currentProjects.length} atuais</small></span>
          </button>
          <button
            id="tasks-view-tab"
            type="button"
            aria-pressed={view === "tasks"}
            aria-controls="tasks-view-panel"
            className={view === "tasks" ? "active" : ""}
            onClick={() => selectView("tasks")}
          >
            <ListTodo size={18} />
            <span><strong>Atividades</strong><small>{tasks.length} abertas e concluídas</small></span>
          </button>
        </div>
      </nav>

      <section className="kpi-grid projects-kpis">
        <KpiCard label="Projetos ativos" value={String(metrics.active)} helper={`${currentProjects.length} em acompanhamento`} icon={<FolderKanban size={17} />} />
        <KpiCard label="Avanço médio" value={`${metrics.average.toFixed(0)}%`} helper={`${metrics.completed}/${metrics.total} tarefas concluídas`} tone="success" icon={<CheckCircle2 size={17} />} />
        <KpiCard label="Atividades atrasadas" value={String(metrics.overdue)} helper={metrics.overdue ? "precisam de atenção" : "nenhum alerta aberto"} tone={metrics.overdue ? "warning" : "success"} icon={<AlertTriangle size={17} />} />
      </section>

      {view === "tasks" ? <section className="kanban-section global-task-board" id="tasks-view-panel" role="region" aria-labelledby="tasks-view-tab">
        <div className="section-title-row">
          <div><h2>Quadro geral de atividades</h2><p>{fullAccess ? "Todas as atividades da carteira, com responsáveis e subtarefas." : "Exibindo as atividades e subtarefas em que você está envolvido."}</p></div>
          <div className="global-task-actions">
            <select value={taskProjectFilter} onChange={(event) => setTaskProjectFilter(event.target.value)} aria-label="Filtrar quadro por projeto">
              <option value="all">Todos os projetos</option>
              <option value="standalone">Somente atividades avulsas</option>
              {currentProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <Button onClick={() => openTaskForm()}><Plus size={17} /> Nova atividade</Button>
          </div>
        </div>
        {loading ? <div className="list-loading">Carregando tarefas…</div> : <ProjectTaskBoard
          tasks={boardTasks}
          users={users}
          movingTaskId={movingTaskId}
          onStatusChange={changeTaskStatus}
          onAddTask={openTaskForm}
          onEditTask={editTask}
          onToggleSubtask={toggleSubtask}
          canAddTask
          canEdit
          canDelete
          onDeleteTask={deleteTask}
        />}
        <div className="global-task-board-foot"><ListTodo size={14} /> {boardTasks.length} atividade(s) no recorte atual · atividades avulsas não aparecem dentro de nenhum projeto.</div>
      </section> : null}

      {view === "projects" ? <section className="content-card" id="projects-view-panel" role="region" aria-labelledby="projects-view-tab">
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
            action={filter === "current" && fullAccess ? <Button onClick={() => setDialogOpen(true)}><Plus size={17} /> Criar projeto</Button> : undefined}
          />
        ) : (
          <div className="project-list-view">
            {visibleProjects.map((project) => (
              <article className={`project-list-row ${project.archived_at ? "project-card-archived" : ""} ${Number(project.overdue_tasks || 0) > 0 ? "exception-card" : ""}`} key={project.id}>
                <div className="project-list-status">
                  <div>
                    <StatusPill tone={project.status === "concluido" ? "success" : project.status === "pausado" ? "warning" : "info"}>{statusLabel[project.status]}</StatusPill>
                    {project.archived_at ? <StatusPill tone="neutral">Arquivado</StatusPill> : null}
                    {Number(project.overdue_tasks || 0) > 0 ? <StatusPill tone="danger"><AlertTriangle size={11} /> {project.overdue_tasks}</StatusPill> : null}
                  </div>
                </div>
                <Link href={`${baseHref}/${project.id}`} className="project-list-identity">
                  <h3>{project.name}</h3>
                  <span>{project.owner_name} · prazo {dateBr(project.end_date)}</span>
                </Link>
                <Link href={`${baseHref}/${project.id}`} className="project-list-progress">
                  <div><span>Progresso</span><strong>{Number(project.progress_percent || 0).toFixed(0)}%</strong></div>
                  <ProgressBar value={Number(project.progress_percent || 0)} />
                </Link>
                <Link href={`${baseHref}/${project.id}?tab=tarefas`} className="project-list-tasks">
                  <span>Atividades</span>
                  <strong>{project.completed_tasks || 0}/{project.total_tasks || 0}</strong>
                </Link>
                <div className="project-list-actions">
                  <Link href={`${baseHref}/${project.id}`} className="button button-secondary">Abrir <ArrowUpRight size={14} /></Link>
                    {fullAccess ? <button
                      type="button"
                      onClick={() => project.archived_at ? void archiveProject(project) : requestAction(project, "archive")}
                      aria-label={project.archived_at ? `Restaurar ${project.name}` : `Arquivar ${project.name}`}
                      title={project.archived_at ? "Restaurar projeto" : "Arquivar projeto"}
                    >
                      {project.archived_at ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                    </button> : null}
                    {fullAccess ? <button type="button" className="danger" onClick={() => requestAction(project, "delete")} aria-label={`Excluir ${project.name}`} title="Excluir projeto"><Trash2 size={16} /></button> : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section> : null}

      <ProjectTaskEditor open={taskDialog} onClose={() => setTaskDialog(false)} onSubmit={saveTask} form={taskForm} onChange={setTaskForm} users={users} projects={currentProjects} lockProject={!fullAccess} saving={saving} />

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={`Novo projeto de ${governance ? "governança" : "operação"}`} description="Comece com o essencial e use um modelo para criar as atividades automaticamente." wide>
        <form className="form-grid" onSubmit={createProject}>
          <Field label="Nome do projeto"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={140} required autoFocus /></Field>
          <Field label="Responsável" hint="Lista de usuários ativos cadastrados no Supabase.">
            <UserSelect users={users} value={form.owner_user_id} onChange={(user) => setForm({ ...form, owner_user_id: user?.user_id || "" })} required />
            {users.length === 0 ? <span className="field-empty-hint">Nenhum usuário ativo com e-mail foi encontrado no Supabase.</span> : null}
          </Field>
          <Field label="Data de início"><input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} required /></Field>
          <Field label="Modelo de atividades" hint="Opcional. Prazos são calculados a partir da data de início."><select value={form.template_id} onChange={(event) => setForm({ ...form, template_id: event.target.value })}><option value="">Sem modelo</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></Field>
          {selectedTemplate ? <div className="template-preview form-span-2"><strong>{selectedTemplate.name}</strong><p>{selectedTemplate.description}</p><span>{selectedTemplate.task_count} atividades com prazos relativos · responsável inicial herdado do projeto</span></div> : null}
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

export default function ProjectsPage() {
  return <ProjectsWorkspace category="operational" />;
}
