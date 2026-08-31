"use client";

import { Button, Dialog, EmptyState, Field, ProgressBar, StatusPill, Toast } from "@/components/ui";
import { DetailTabs } from "@/components/detail-tabs";
import { ProjectTaskEditor, taskToDraft, type ProjectTaskDraft } from "@/components/project-task-editor";
import { ProjectTaskBoard } from "@/components/project-task-board";
import { UserSelect } from "@/components/user-select";
import { BUSINESS_STAGES } from "@/lib/constants";
import { currency, dateBr, initials, todayIso } from "@/lib/format";
import { generateProjectReport } from "@/lib/project-report";
import { withProjectProgress } from "@/lib/project-progress";
import { emptyProjectTaskDraft, PROJECT_TASK_RELATIONS, projectTaskRpcPayload } from "@/lib/project-tasks";
import { friendlyError, getSupabase, storagePath } from "@/lib/supabase";
import type { BusinessStage, Project, ProjectCategory, ProjectComment, ProjectFile, ProjectMember, ProjectSubtask, ProjectTask, TaskStatus, UserProfile } from "@/lib/types";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  Building2,
  Calendar,
  CheckCircle2,
  Clock3,
  Download,
  File,
  FileDown,
  Files,
  History,
  ListTodo,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  Upload,
  UserPlus,
  Users,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

type LinkedBusiness = {
  id: string;
  name: string;
  stage: BusinessStage;
  potential_vgv: number;
};

type ProjectTab = "resumo" | "tarefas" | "arquivos" | "atualizacoes";

const projectTabs = [
  { key: "tarefas", label: "Tarefas", icon: <ListTodo size={16} /> },
  { key: "resumo", label: "Resumo", icon: <Settings2 size={16} /> },
  { key: "arquivos", label: "Arquivos", icon: <Files size={16} /> },
  { key: "atualizacoes", label: "Atualizações", icon: <History size={16} /> },
] satisfies Array<{ key: ProjectTab; label: string; icon: ReactNode }>;

export function ProjectDetailWorkspace({ category }: { category: ProjectCategory }) {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = getSupabase();
  const governance = category === "governance";
  const baseHref = governance ? "/governanca" : "/projetos";
  const targetCategory: ProjectCategory = governance ? "operational" : "governance";
  const targetHref = governance ? "/projetos" : "/governanca";
  const targetLabel = governance ? "Projetos" : "Governança";
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [comments, setComments] = useState<ProjectComment[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [linkedBusinesses, setLinkedBusinesses] = useState<LinkedBusiness[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [fullAccess, setFullAccess] = useState(true);
  const [canMoveCategory, setCanMoveCategory] = useState(false);
  const [allowFiles, setAllowFiles] = useState(true);
  const [allowUpdates, setAllowUpdates] = useState(true);
  const [activeTab, setActiveTab] = useState<ProjectTab>(() => {
    if (typeof window === "undefined") return "tarefas";
    const requested = new URLSearchParams(window.location.search).get("tab") as ProjectTab | null;
    return requested && projectTabs.some((tab) => tab.key === requested) ? requested : "tarefas";
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  const [taskDialog, setTaskDialog] = useState(false);
  const [memberDialog, setMemberDialog] = useState(false);
  const [fileDialog, setFileDialog] = useState(false);
  const [moveDialog, setMoveDialog] = useState(false);
  const [taskForm, setTaskForm] = useState<ProjectTaskDraft>(() => emptyProjectTaskDraft(params.id, todayIso()));
  const [memberForm, setMemberForm] = useState({ user_id: "", role: "" });
  const [fileForm, setFileForm] = useState({ file: null as globalThis.File | null });
  const [comment, setComment] = useState("");
  const [summaryForm, setSummaryForm] = useState({ name: "", start_date: "", end_date: "", owner_user_id: "", objective: "", status: "ativo" as Project["status"] });
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const loadData = useCallback(async (silent = false) => {
    if (!supabase || !params.id) return;
    if (!silent) setLoading(true);
    const { data: currentAuth } = await supabase.auth.getUser();
    const currentUserId = currentAuth.user?.id || "00000000-0000-0000-0000-000000000000";
    const [projectResult, taskResult, commentResult, memberResult, fileResult, businessResult, userResult, profileResult, permissionResult, fullAccessResult, targetPermissionResult] = await Promise.all([
      supabase.from("projects").select("*").eq("id", params.id).eq("category", category).single(),
      supabase.from("project_tasks").select(`*,${PROJECT_TASK_RELATIONS}`).eq("project_id", params.id).eq("category", category).order("position"),
      supabase.from("project_comments").select("*").eq("project_id", params.id).order("created_at", { ascending: false }),
      supabase.from("project_members").select("*").eq("project_id", params.id).order("name"),
      supabase.from("project_files").select("*").eq("project_id", params.id).order("created_at", { ascending: false }),
      supabase.from("businesses").select("id,name,stage,potential_vgv").eq("project_id", params.id).order("updated_at", { ascending: false }),
      supabase.from("profiles").select("user_id,full_name,email,active,is_admin").eq("active", true).not("email", "is", null).order("full_name"),
      supabase.from("profiles").select("is_admin").eq("user_id", currentUserId).maybeSingle(),
      supabase.from("profile_project_permissions").select("access_scope,allow_files,allow_updates").eq("user_id", currentUserId).maybeSingle(),
      supabase.rpc("has_project_full_access", { p_project_id: params.id }),
      supabase.rpc("can_create_project", { p_category: targetCategory }),
    ]);
    if (projectResult.error) {
      setToast({ message: friendlyError(projectResult.error), type: "error" });
      setLoading(false);
      return;
    }
    if (userResult.error) setToast({ message: friendlyError(userResult.error), type: "error" });
    const fileRows = (fileResult.data || []) as ProjectFile[];
    const signedFiles = await Promise.all(fileRows.map(async (item) => {
      const { data } = await supabase.storage.from("project-files").createSignedUrl(item.file_path, 3600);
      return { ...item, signed_url: data?.signedUrl };
    }));
    const loadedProject = projectResult.data as Project;
    const loadedTasks = (taskResult.data || []) as ProjectTask[];
    setProject(withProjectProgress(loadedProject, loadedTasks, todayIso()));
    setSummaryForm({ name: loadedProject.name, start_date: loadedProject.start_date, end_date: loadedProject.end_date || "", owner_user_id: loadedProject.owner_user_id || "", objective: loadedProject.objective, status: loadedProject.status });
    setTasks(loadedTasks);
    setComments((commentResult.data || []) as ProjectComment[]);
    setMembers((memberResult.data || []) as ProjectMember[]);
    setFiles(signedFiles);
    setLinkedBusinesses((businessResult.data || []) as LinkedBusiness[]);
    setUsers((userResult.data || []) as UserProfile[]);
    const administrator = Boolean(profileResult.data?.is_admin);
    setFullAccess(administrator || Boolean(fullAccessResult.data));
    setCanMoveCategory(Boolean(targetPermissionResult.data));
    setAllowFiles(administrator || permissionResult.data?.allow_files !== false);
    setAllowUpdates(administrator || permissionResult.data?.allow_updates !== false);
    setLoading(false);
  }, [category, params.id, supabase, targetCategory]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const stats = useMemo(() => {
    const overdue = tasks.filter((task) => task.status !== "concluida" && task.due_date < todayIso()).length;
    const completed = tasks.filter((task) => task.status === "concluida").length;
    return { overdue, completed };
  }, [tasks]);

  function openNewTask(status: TaskStatus = "a_fazer") {
    setTaskForm(emptyProjectTaskDraft(params.id, todayIso(), status));
    setTaskDialog(true);
  }

  function editTask(task: ProjectTask) {
    setTaskForm(taskToDraft(task));
    setTaskDialog(true);
  }

  async function saveTask(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !project) return;
    if (!taskForm.assignee_user_ids.length) {
      setToast({ message: "Selecione ao menos uma pessoa responsável.", type: "error" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("save_project_task", projectTaskRpcPayload({ ...taskForm, project_id: project.id }, category));
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setTaskDialog(false);
    setTaskForm(emptyProjectTaskDraft(project.id, todayIso()));
    setToast({ message: taskForm.id ? "Atividade atualizada." : "Atividade adicionada ao quadro.", type: "success" });
    await loadData();
  }

  async function changeStatus(task: ProjectTask, status: TaskStatus) {
    if (!supabase || task.status === status || movingTaskId) return;
    const previousTasks = tasks;
    const previousProject = project;
    const position = tasks.filter((item) => item.status === status).length;
    const nextTasks = tasks.map((item) => item.id === task.id ? { ...item, status, position } : item);
    setMovingTaskId(task.id);
    setTasks(nextTasks);
    setProject((current) => current ? {
      ...current,
      progress_percent: nextTasks.length
        ? (nextTasks.filter((item) => item.status === "concluida").length / nextTasks.length) * 100
        : 0,
    } : current);
    const { error } = await supabase.from("project_tasks").update({ status, position }).eq("id", task.id);
    if (error) {
      setTasks(previousTasks);
      setProject(previousProject);
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
    setToast({ message: "Tarefa excluída do projeto.", type: "success" });
    await loadData(true);
  }

  async function saveSummary(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !project) return;
    setSaving(true);
    const { error } = await supabase.from("projects").update({
      name: summaryForm.name.trim(),
      start_date: summaryForm.start_date,
      end_date: summaryForm.end_date || null,
      owner_user_id: summaryForm.owner_user_id,
      objective: summaryForm.objective.trim() || "A definir",
      status: summaryForm.status,
    }).eq("id", project.id);
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setToast({ message: "Dados gerais do projeto atualizados.", type: "success" });
    await loadData();
  }

  async function moveProject() {
    if (!supabase || !project || !canMoveCategory) return;
    setSaving(true);
    const { error } = await supabase.rpc("move_project_to_category", {
      p_project_id: project.id,
      p_category: targetCategory,
    });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setMoveDialog(false);
    router.replace(`${targetHref}/${project.id}`);
  }

  async function addComment(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !project || !comment.trim()) return;
    setSaving(true);
    const { data } = await supabase.auth.getUser();
    const email = data.user?.email || "Usuário";
    const author = String(data.user?.user_metadata?.full_name || email.split("@")[0]);
    const { error } = await supabase.from("project_comments").insert({ project_id: project.id, body: comment.trim(), author_name: author });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setComment("");
    await loadData();
  }

  async function editComment(item: ProjectComment) {
    if (!supabase || !allowUpdates) return;
    const body = window.prompt("Editar atualização", item.body)?.trim();
    if (!body || body === item.body) return;
    const { error } = await supabase.from("project_comments").update({ body }).eq("id", item.id);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setToast({ message: "Atualização editada.", type: "success" });
    await loadData(true);
  }

  async function deleteComment(item: ProjectComment) {
    if (!supabase || !allowUpdates || !window.confirm("Excluir esta atualização?")) return;
    const { error } = await supabase.from("project_comments").delete().eq("id", item.id);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setToast({ message: "Atualização excluída.", type: "success" });
    await loadData(true);
  }

  async function addMember(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !project) return;
    const member = users.find((user) => user.user_id === memberForm.user_id);
    if (!member?.email) {
      setToast({ message: "Selecione um usuário ativo para adicionar ao projeto.", type: "error" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("project_members").upsert({
      project_id: project.id,
      user_id: member.user_id,
      name: member.full_name?.trim() || member.email.split("@")[0],
      email: member.email.toLowerCase(),
      role: memberForm.role.trim() || null,
    }, { onConflict: "project_id,email" });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setMemberDialog(false);
    setMemberForm({ user_id: "", role: "" });
    setToast({ message: "Envolvido adicionado ao projeto.", type: "success" });
    await loadData();
  }

  async function editMember(member: ProjectMember) {
    if (!supabase || !fullAccess) return;
    const role = window.prompt(`Editar papel de ${member.name}`, member.role || "")?.trim();
    if (role === undefined || role === (member.role || "")) return;
    const { error } = await supabase.from("project_members").update({ role: role || null }).eq("id", member.id);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setToast({ message: "Envolvido atualizado.", type: "success" });
    await loadData(true);
  }

  async function deleteMember(member: ProjectMember) {
    if (!supabase || !fullAccess || !window.confirm(`Remover ${member.name} do projeto?`)) return;
    if (member.user_id === project?.owner_user_id) return setToast({ message: "Troque o responsável principal antes de remover esta pessoa.", type: "error" });
    const { error } = await supabase.from("project_members").delete().eq("id", member.id);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setToast({ message: "Envolvido removido.", type: "success" });
    await loadData(true);
  }

  async function uploadFile(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !project || !fileForm.file) return;
    setSaving(true);
    const path = storagePath(project.id, fileForm.file.name, "attachments");
    const upload = await supabase.storage.from("project-files").upload(path, fileForm.file, { cacheControl: "3600", upsert: false });
    if (upload.error) {
      setSaving(false);
      return setToast({ message: friendlyError(upload.error), type: "error" });
    }
    const { error } = await supabase.from("project_files").insert({ project_id: project.id, file_path: path, file_name: fileForm.file.name, mime_type: fileForm.file.type || null, size_bytes: fileForm.file.size });
    setSaving(false);
    if (error) {
      await supabase.storage.from("project-files").remove([path]);
      return setToast({ message: friendlyError(error), type: "error" });
    }
    setFileDialog(false);
    setFileForm({ file: null });
    setToast({ message: "Arquivo adicionado ao projeto.", type: "success" });
    await loadData();
  }

  async function renameFile(item: ProjectFile) {
    if (!supabase || !fullAccess) return;
    const fileName = window.prompt("Editar nome do arquivo", item.file_name)?.trim();
    if (!fileName || fileName === item.file_name) return;
    const { error } = await supabase.from("project_files").update({ file_name: fileName }).eq("id", item.id);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setToast({ message: "Arquivo renomeado.", type: "success" });
    await loadData(true);
  }

  async function deleteFile(item: ProjectFile) {
    if (!supabase || !fullAccess || !window.confirm(`Excluir o arquivo “${item.file_name}”?`)) return;
    const { error } = await supabase.from("project_files").delete().eq("id", item.id);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    const { error: storageError } = await supabase.storage.from("project-files").remove([item.file_path]);
    if (storageError) setToast({ message: "O registro foi excluído, mas o arquivo físico precisa ser removido por um administrador.", type: "error" });
    else setToast({ message: "Arquivo excluído.", type: "success" });
    await loadData(true);
  }

  async function saveProjectPdf() {
    if (!project) return;
    setGeneratingPdf(true);
    try {
      await generateProjectReport({
        project,
        tasks,
        comments,
        members,
        files,
        linkedBusinesses,
      });
      setToast({ message: "PDF completo do projeto salvo.", type: "success" });
    } catch (error) {
      setToast({ message: friendlyError(error), type: "error" });
    } finally {
      setGeneratingPdf(false);
    }
  }

  if (loading) return <div className="detail-loading">Carregando projeto…</div>;
  if (!project) return <EmptyState icon={<ListTodo size={22} />} title="Projeto não encontrado" description="Verifique se o registro ainda existe e tente novamente." />;

  const visibleTabs = projectTabs.filter((tab) => (tab.key !== "arquivos" || allowFiles) && (tab.key !== "atualizacoes" || allowUpdates));
  const visibleActiveTab = (!allowFiles && activeTab === "arquivos") || (!allowUpdates && activeTab === "atualizacoes") ? "tarefas" : activeTab;

  return (
    <>
      <Link href={baseHref} className="detail-back"><ArrowLeft size={16} /> Voltar para {governance ? "Governança" : "Projetos"}</Link>
      <header className="project-detail-header">
        <div>
          <div className="project-title-meta"><StatusPill tone="info">{project.status === "ativo" ? "Projeto ativo" : project.status}</StatusPill>{project.archived_at ? <StatusPill tone="neutral">Arquivado</StatusPill> : null}{stats.overdue ? <StatusPill tone="danger"><AlertTriangle size={11} /> {stats.overdue} atrasadas</StatusPill> : <StatusPill tone="success">Prazos acompanhados</StatusPill>}</div>
          <h1>{project.name}</h1>
          <p><Users size={14} /> {project.owner_name} · {project.owner_email} <span /> <Calendar size={14} /> {dateBr(project.start_date)} a {dateBr(project.end_date)}</p>
        </div>
        <div className="email-actions">
          {fullAccess && canMoveCategory ? <Button variant="secondary" onClick={() => setMoveDialog(true)}><ArrowLeftRight size={16} /> Mover para {targetLabel}</Button> : null}
          <Button onClick={saveProjectPdf} loading={generatingPdf}><FileDown size={16} /> Salvar PDF</Button>
        </div>
      </header>

      <section className="project-progress-strip">
        <div><strong>{Number(project.progress_percent || 0).toFixed(0)}%</strong><span>concluído</span></div>
        <ProgressBar value={Number(project.progress_percent || 0)} />
        <div className="project-progress-numbers"><span><CheckCircle2 size={15} /> {stats.completed} concluídas</span><span><Clock3 size={15} /> {tasks.length - stats.completed} abertas</span><span className={stats.overdue ? "text-danger" : ""}><AlertTriangle size={15} /> {stats.overdue} atrasadas</span></div>
      </section>

      <DetailTabs tabs={visibleTabs} active={visibleActiveTab} onChange={setActiveTab} />

      {visibleActiveTab === "resumo" ? <div className="section-stack detail-tab-panel">
      <section className="content-card">
        <div className="content-card-head"><div><h2>Dados gerais</h2><p>Responsável, prazo, objetivo e situação do projeto</p></div></div>
        <div className="content-card-body"><form className="form-grid" onSubmit={saveSummary}>
          <Field label="Nome do projeto"><input value={summaryForm.name} onChange={(event) => setSummaryForm({ ...summaryForm, name: event.target.value })} disabled={!fullAccess} minLength={2} maxLength={140} required /></Field>
          <Field label="Status"><select value={summaryForm.status} onChange={(event) => setSummaryForm({ ...summaryForm, status: event.target.value as Project["status"] })} disabled={!fullAccess}><option value="planejamento">Planejamento</option><option value="ativo">Ativo</option><option value="pausado">Pausado</option><option value="concluido">Concluído</option></select></Field>
          <Field label="Responsável"><select value={summaryForm.owner_user_id} onChange={(event) => setSummaryForm({ ...summaryForm, owner_user_id: event.target.value })} disabled={!fullAccess} required>{users.map((user) => <option key={user.user_id} value={user.user_id}>{user.full_name || user.email} · {user.email}</option>)}</select></Field>
          <Field label="Data de início"><input type="date" value={summaryForm.start_date} onChange={(event) => setSummaryForm({ ...summaryForm, start_date: event.target.value })} disabled={!fullAccess} required /></Field>
          <Field label="Previsão de fim"><input type="date" min={summaryForm.start_date} value={summaryForm.end_date} onChange={(event) => setSummaryForm({ ...summaryForm, end_date: event.target.value })} disabled={!fullAccess} /></Field>
          <Field label="Objetivo" className="form-span-2"><textarea value={summaryForm.objective} onChange={(event) => setSummaryForm({ ...summaryForm, objective: event.target.value })} disabled={!fullAccess} maxLength={5000} /></Field>
          {fullAccess ? <div className="form-actions"><Button type="submit" loading={saving}>Salvar alterações</Button></div> : <div className="project-access-note form-span-2">Você visualiza este projeto por estar envolvido em uma tarefa. A gestão geral permanece com o responsável ou administrador.</div>}
        </form></div>
      </section>

      <section className="project-context-grid">
        <article className="objective-card"><span className="eyebrow">Objetivo do projeto</span><p>{project.objective}</p></article>
        <article className="members-card"><div><span className="eyebrow">Envolvidos</span><div className="avatar-stack">{members.slice(0, 5).map((member) => <span title={`${member.name} · ${member.email}`} key={member.id}>{initials(member.name)}</span>)}{members.length > 5 ? <span>+{members.length - 5}</span> : null}</div></div>{fullAccess ? <Button variant="ghost" onClick={() => setMemberDialog(true)}><UserPlus size={16} /> Adicionar</Button> : null}</article>
      </section>

      <section className="content-card project-member-management">
        <div className="content-card-head"><div><h2>Equipe do projeto</h2><p>Edite papéis ou remova envolvidos da carteira.</p></div>{fullAccess ? <Button variant="secondary" onClick={() => setMemberDialog(true)}><UserPlus size={16} /> Adicionar</Button> : null}</div>
        {members.length ? <div className="project-member-list">{members.map((member) => <article key={member.id}><span>{initials(member.name)}</span><div><strong>{member.name}</strong><small>{member.role || "Envolvido"} · {member.email}</small></div>{fullAccess ? <div><button type="button" onClick={() => void editMember(member)} aria-label={`Editar ${member.name}`}><Pencil size={14} /></button><button type="button" className="danger" onClick={() => void deleteMember(member)} aria-label={`Remover ${member.name}`}><Trash2 size={14} /></button></div> : null}</article>)}</div> : <div className="mini-empty">Nenhum envolvido adicional.</div>}
      </section>

      <section className="content-card linked-businesses-card">
        <div className="content-card-head">
          <div><h2>Novos negócios vinculados</h2><p>Conexão entre a execução do projeto e o funil de desenvolvimento</p></div>
          <StatusPill tone={linkedBusinesses.length ? "success" : "neutral"}>{linkedBusinesses.length} vínculo(s)</StatusPill>
        </div>
        {linkedBusinesses.length ? (
          <div className="linked-businesses-list">
            {linkedBusinesses.map((business) => {
              const stage = BUSINESS_STAGES.find((item) => item.key === business.stage);
              return (
                <article key={business.id}>
                  <span className="linked-business-icon"><Building2 size={18} /></span>
                  <div><strong>{business.name}</strong><small>{stage?.label || business.stage}</small></div>
                  <div><span>VGV potencial</span><strong>{currency(business.potential_vgv)}</strong></div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="linked-businesses-empty">Este projeto ainda não está conectado a um novo negócio. O vínculo é definido ao cadastrar o negócio no funil.</div>
        )}
        <div className="linked-businesses-footer"><Link href="/novos-negocios">Abrir Novos negócios</Link></div>
      </section>
      </div> : null}

      {visibleActiveTab === "tarefas" ? <section className="kanban-section detail-tab-panel">
        <div className="section-title-row"><div><h2>Quadro de atividades</h2><p>{fullAccess ? "Arraste os cartões, distribua responsáveis e acompanhe cada subtarefa." : "Exibindo as atividades e subtarefas em que você está envolvido."}</p></div>{fullAccess ? <Button onClick={() => openNewTask()}><Plus size={17} /> Nova atividade</Button> : null}</div>
        <ProjectTaskBoard
          tasks={tasks}
          users={users}
          movingTaskId={movingTaskId}
          onStatusChange={changeStatus}
          onAddTask={openNewTask}
          onEditTask={editTask}
          onToggleSubtask={toggleSubtask}
          canAddTask={fullAccess}
          canEdit
          canDelete={fullAccess}
          onDeleteTask={deleteTask}
        />
      </section> : null}

      {visibleActiveTab === "atualizacoes" || visibleActiveTab === "arquivos" ? <div className="detail-tab-panel">
        {visibleActiveTab === "atualizacoes" ? <section className="content-card">
          <div className="content-card-head"><div><h2>Comentários gerais</h2><p>Atualizações, decisões e contexto do projeto</p></div><MessageSquare size={18} /></div>
          <form className="comment-form" onSubmit={addComment}><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Adicionar atualização ou comentário…" maxLength={2500} required /><div><small>O comentário ficará visível para todos os usuários.</small><Button type="submit" loading={saving} disabled={!comment.trim()}>Comentar</Button></div></form>
          <div className="comment-list">{comments.length ? comments.map((item) => <article key={item.id}><span className="comment-avatar">{initials(item.author_name)}</span><div><div><strong>{item.author_name}</strong><span><small>{dateBr(item.created_at)}</small>{allowUpdates ? <span className="record-actions"><button type="button" onClick={() => void editComment(item)} aria-label="Editar atualização"><Pencil size={13} /></button><button type="button" className="danger" onClick={() => void deleteComment(item)} aria-label="Excluir atualização"><Trash2 size={13} /></button></span> : null}</span></div><p>{item.body}</p></div></article>) : <div className="mini-empty">Nenhum comentário ainda.</div>}</div>
        </section> : null}
        {visibleActiveTab === "arquivos" ? <section className="content-card">
          <div className="content-card-head"><div><h2>Arquivos e imagens</h2><p>Referências compartilhadas e reaproveitadas pela obra vinculada</p></div>{allowFiles ? <Button variant="secondary" onClick={() => setFileDialog(true)}><Plus size={16} /> Arquivo</Button> : null}</div>
          {files.length ? <div className="project-files project-files-grid">{files.map((item) => { const isImage = item.mime_type?.startsWith("image/") && item.signed_url; return <article key={item.id} className={isImage ? "image-file" : "document-file"}><a href={item.signed_url} target="_blank" rel="noreferrer">{isImage ? <Image src={item.signed_url!} alt={item.file_name} width={46} height={46} unoptimized /> : <File size={23} />}<div><strong>{item.file_name}</strong><span>{dateBr(item.created_at)}</span></div><Download size={15} /></a>{fullAccess ? <div className="record-actions"><button type="button" onClick={() => void renameFile(item)} aria-label={`Renomear ${item.file_name}`}><Pencil size={13} /></button><button type="button" className="danger" onClick={() => void deleteFile(item)} aria-label={`Excluir ${item.file_name}`}><Trash2 size={13} /></button></div> : null}</article>; })}</div> : <EmptyState icon={<Paperclip size={21} />} title="Nenhum arquivo" description="Adicione imagens, PDFs ou documentos importantes para o projeto." action={<Button variant="secondary" onClick={() => setFileDialog(true)}><Upload size={16} /> Enviar arquivo</Button>} />}
        </section> : null}
      </div> : null}

      <ProjectTaskEditor open={taskDialog} onClose={() => setTaskDialog(false)} onSubmit={saveTask} form={taskForm} onChange={setTaskForm} users={users} lockProject saving={saving} />
      <Dialog open={memberDialog} onClose={() => setMemberDialog(false)} title="Adicionar envolvido" description="Selecione um usuário do Supabase para participar do projeto."><form className="form-grid" onSubmit={addMember}><Field label="Usuário" hint="A lista exibe nome e e-mail dos usuários ativos." className="form-span-2"><UserSelect users={users} value={memberForm.user_id} onChange={(user) => setMemberForm({ ...memberForm, user_id: user?.user_id || "" })} required /></Field><Field label="Papel no projeto" className="form-span-2"><input value={memberForm.role} onChange={(event) => setMemberForm({ ...memberForm, role: event.target.value })} placeholder="Ex.: Diretoria, Engenharia" /></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setMemberDialog(false)}>Cancelar</Button><Button type="submit" loading={saving} disabled={!memberForm.user_id}>Adicionar</Button></div></form></Dialog>
      <Dialog open={fileDialog} onClose={() => setFileDialog(false)} title="Adicionar arquivo" description="Arquivos ficam protegidos no storage do Supabase."><form className="form-grid" onSubmit={uploadFile}><Field label="Arquivo" hint="Imagens ou documentos de até 20 MB."><label className="file-drop"><Upload size={21} /><span>{fileForm.file?.name || "Selecionar arquivo"}</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,.xls,.xlsx" onChange={(event) => setFileForm({ file: event.target.files?.[0] || null })} required /></label></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setFileDialog(false)}>Cancelar</Button><Button type="submit" loading={saving} disabled={!fileForm.file}>Enviar arquivo</Button></div></form></Dialog>
      <Dialog
        open={moveDialog}
        onClose={() => setMoveDialog(false)}
        title={`Mover para ${targetLabel}?`}
        description={`O projeto e todas as atividades passarão para ${targetLabel}. Responsáveis, subtarefas, comentários, arquivos e vínculos serão preservados.`}
      >
        <div className="confirmation-content">
          <strong>{project.name}</strong>
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={() => setMoveDialog(false)}>Cancelar</Button>
            <Button type="button" loading={saving} onClick={() => void moveProject()}><ArrowLeftRight size={16} /> Mover para {targetLabel}</Button>
          </div>
        </div>
      </Dialog>
      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}

export default function ProjectDetailPage() {
  return <ProjectDetailWorkspace category="operational" />;
}
