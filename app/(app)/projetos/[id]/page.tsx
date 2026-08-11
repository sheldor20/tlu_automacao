"use client";

import { Button, Dialog, EmptyState, Field, ProgressBar, StatusPill, Toast } from "@/components/ui";
import { TASK_COLUMNS } from "@/lib/constants";
import { dateBr, initials, todayIso } from "@/lib/format";
import { friendlyError, getSupabase, storagePath } from "@/lib/supabase";
import type { Project, ProjectComment, ProjectFile, ProjectMember, ProjectTask, TaskStatus } from "@/lib/types";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock3,
  Download,
  File,
  ListTodo,
  Mail,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
  Upload,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const supabase = getSupabase();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [comments, setComments] = useState<ProjectComment[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState<"owner" | "all" | null>(null);
  const [taskDialog, setTaskDialog] = useState(false);
  const [memberDialog, setMemberDialog] = useState(false);
  const [fileDialog, setFileDialog] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: "", description: "", assignee_name: "", assignee_email: "", due_date: todayIso(), status: "a_fazer" as TaskStatus });
  const [memberForm, setMemberForm] = useState({ name: "", email: "", role: "" });
  const [fileForm, setFileForm] = useState({ file: null as globalThis.File | null });
  const [comment, setComment] = useState("");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const loadData = useCallback(async () => {
    if (!supabase || !params.id) return;
    setLoading(true);
    const [projectResult, taskResult, commentResult, memberResult, fileResult] = await Promise.all([
      supabase.from("project_progress_summary").select("*").eq("id", params.id).single(),
      supabase.from("project_tasks").select("*").eq("project_id", params.id).order("position"),
      supabase.from("project_comments").select("*").eq("project_id", params.id).order("created_at", { ascending: false }),
      supabase.from("project_members").select("*").eq("project_id", params.id).order("name"),
      supabase.from("project_files").select("*").eq("project_id", params.id).order("created_at", { ascending: false }),
    ]);
    if (projectResult.error) {
      setToast({ message: friendlyError(projectResult.error), type: "error" });
      setLoading(false);
      return;
    }
    const fileRows = (fileResult.data || []) as ProjectFile[];
    const signedFiles = await Promise.all(fileRows.map(async (item) => {
      const { data } = await supabase.storage.from("project-files").createSignedUrl(item.file_path, 3600);
      return { ...item, signed_url: data?.signedUrl };
    }));
    setProject(projectResult.data as Project);
    setTasks((taskResult.data || []) as ProjectTask[]);
    setComments((commentResult.data || []) as ProjectComment[]);
    setMembers((memberResult.data || []) as ProjectMember[]);
    setFiles(signedFiles);
    setLoading(false);
  }, [params.id, supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const stats = useMemo(() => {
    const overdue = tasks.filter((task) => task.status !== "concluida" && task.due_date < todayIso()).length;
    const completed = tasks.filter((task) => task.status === "concluida").length;
    return { overdue, completed };
  }, [tasks]);

  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !project) return;
    setSaving(true);
    const { error } = await supabase.from("project_tasks").insert({
      project_id: project.id,
      title: taskForm.title.trim(),
      description: taskForm.description.trim() || null,
      assignee_name: taskForm.assignee_name.trim(),
      assignee_email: taskForm.assignee_email.trim().toLowerCase(),
      due_date: taskForm.due_date,
      status: taskForm.status,
      position: tasks.filter((task) => task.status === taskForm.status).length,
    });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setTaskDialog(false);
    setTaskForm({ title: "", description: "", assignee_name: "", assignee_email: "", due_date: todayIso(), status: "a_fazer" });
    setToast({ message: "Tarefa adicionada ao quadro.", type: "success" });
    await loadData();
  }

  async function changeStatus(task: ProjectTask, status: TaskStatus) {
    if (!supabase || task.status === status) return;
    const previous = tasks;
    setTasks(tasks.map((item) => item.id === task.id ? { ...item, status } : item));
    const { error } = await supabase.from("project_tasks").update({ status }).eq("id", task.id);
    if (error) {
      setTasks(previous);
      return setToast({ message: friendlyError(error), type: "error" });
    }
    await loadData();
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

  async function addMember(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !project) return;
    setSaving(true);
    const { error } = await supabase.from("project_members").insert({ project_id: project.id, name: memberForm.name.trim(), email: memberForm.email.trim().toLowerCase(), role: memberForm.role.trim() || null });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setMemberDialog(false);
    setMemberForm({ name: "", email: "", role: "" });
    setToast({ message: "Envolvido adicionado ao projeto.", type: "success" });
    await loadData();
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

  async function sendStatus(scope: "owner" | "all") {
    if (!supabase || !project) return;
    setSending(scope);
    const { data } = await supabase.auth.getSession();
    try {
      const response = await fetch("/api/projects/status-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token || ""}` },
        body: JSON.stringify({ projectId: project.id, scope }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível enviar o status.");
      setToast({ message: `Status enviado para ${result.recipientCount} destinatário(s).`, type: "success" });
    } catch (error) {
      setToast({ message: friendlyError(error), type: "error" });
    } finally {
      setSending(null);
    }
  }

  if (loading) return <div className="detail-loading">Carregando projeto…</div>;
  if (!project) return <EmptyState icon={<ListTodo size={22} />} title="Projeto não encontrado" description="Verifique se o registro ainda existe e tente novamente." />;

  return (
    <>
      <Link href="/projetos" className="detail-back"><ArrowLeft size={16} /> Voltar para Projetos</Link>
      <header className="project-detail-header">
        <div>
          <div className="project-title-meta"><StatusPill tone="info">{project.status === "ativo" ? "Projeto ativo" : project.status}</StatusPill>{stats.overdue ? <StatusPill tone="danger"><AlertTriangle size={11} /> {stats.overdue} atrasadas</StatusPill> : <StatusPill tone="success">Prazos acompanhados</StatusPill>}</div>
          <h1>{project.name}</h1>
          <p><Users size={14} /> {project.owner_name} · {project.owner_email} <span /> <Calendar size={14} /> {dateBr(project.start_date)} a {dateBr(project.end_date)}</p>
        </div>
        <div className="email-actions"><Button variant="secondary" onClick={() => sendStatus("owner")} loading={sending === "owner"}><Mail size={16} /> Enviar ao responsável</Button><Button onClick={() => sendStatus("all")} loading={sending === "all"}><Send size={16} /> Enviar a todos</Button></div>
      </header>

      <section className="project-progress-strip">
        <div><strong>{Number(project.progress_percent || 0).toFixed(0)}%</strong><span>concluído</span></div>
        <ProgressBar value={Number(project.progress_percent || 0)} />
        <div className="project-progress-numbers"><span><CheckCircle2 size={15} /> {stats.completed} concluídas</span><span><Clock3 size={15} /> {tasks.length - stats.completed} abertas</span><span className={stats.overdue ? "text-danger" : ""}><AlertTriangle size={15} /> {stats.overdue} atrasadas</span></div>
      </section>

      <section className="project-context-grid">
        <article className="objective-card"><span className="eyebrow">Objetivo do projeto</span><p>{project.objective}</p></article>
        <article className="members-card"><div><span className="eyebrow">Envolvidos</span><div className="avatar-stack">{members.slice(0, 5).map((member) => <span title={`${member.name} · ${member.email}`} key={member.id}>{initials(member.name)}</span>)}{members.length > 5 ? <span>+{members.length - 5}</span> : null}</div></div><Button variant="ghost" onClick={() => setMemberDialog(true)}><UserPlus size={16} /> Adicionar</Button></article>
      </section>

      <section className="kanban-section">
        <div className="section-title-row"><div><h2>Quadro de tarefas</h2><p>Mova o status de cada tarefa pelo seletor no cartão.</p></div><Button onClick={() => setTaskDialog(true)}><Plus size={17} /> Nova tarefa</Button></div>
        <div className="kanban-board">
          {TASK_COLUMNS.map((column) => {
            const columnTasks = tasks.filter((task) => task.status === column.key);
            return (
              <section className={`kanban-column column-${column.key}`} key={column.key}>
                <header><div><span className="column-dot" /><h3>{column.label}</h3></div><strong>{columnTasks.length}</strong></header>
                <div className="kanban-tasks">
                  {columnTasks.map((task) => {
                    const overdue = task.status !== "concluida" && task.due_date < todayIso();
                    return (
                      <article className={`task-card ${overdue ? "task-overdue" : ""}`} key={task.id}>
                        <div className="task-card-top"><span className="task-avatar">{initials(task.assignee_name)}</span>{overdue ? <StatusPill tone="danger">Atrasada</StatusPill> : task.status === "concluida" ? <StatusPill tone="success">Concluída</StatusPill> : null}</div>
                        <h4>{task.title}</h4>{task.description ? <p>{task.description}</p> : null}
                        <div className="task-meta"><span><Users size={12} /> {task.assignee_name}</span><span className={overdue ? "text-danger" : ""}><Calendar size={12} /> {dateBr(task.due_date)}</span></div>
                        <select value={task.status} onChange={(event) => changeStatus(task, event.target.value as TaskStatus)} aria-label={`Mudar status de ${task.title}`}>{TASK_COLUMNS.map((option) => <option value={option.key} key={option.key}>{option.label}</option>)}</select>
                      </article>
                    );
                  })}
                  {columnTasks.length === 0 ? <div className="column-empty">Nenhuma tarefa nesta etapa.</div> : null}
                </div>
                <button className="kanban-add" onClick={() => { setTaskForm({ ...taskForm, status: column.key }); setTaskDialog(true); }}><Plus size={15} /> Adicionar tarefa</button>
              </section>
            );
          })}
        </div>
      </section>

      <div className="split-layout project-notion-grid">
        <section className="content-card">
          <div className="content-card-head"><div><h2>Comentários gerais</h2><p>Atualizações, decisões e contexto do projeto</p></div><MessageSquare size={18} /></div>
          <form className="comment-form" onSubmit={addComment}><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Adicionar atualização ou comentário…" maxLength={2500} required /><div><small>O comentário ficará visível para todos os usuários.</small><Button type="submit" loading={saving} disabled={!comment.trim()}>Comentar</Button></div></form>
          <div className="comment-list">{comments.length ? comments.map((item) => <article key={item.id}><span className="comment-avatar">{initials(item.author_name)}</span><div><div><strong>{item.author_name}</strong><small>{dateBr(item.created_at)}</small></div><p>{item.body}</p></div></article>) : <div className="mini-empty">Nenhum comentário ainda.</div>}</div>
        </section>
        <section className="content-card">
          <div className="content-card-head"><div><h2>Arquivos e imagens</h2><p>Referências compartilhadas do projeto</p></div><button className="icon-button" onClick={() => setFileDialog(true)} aria-label="Adicionar arquivo"><Plus size={17} /></button></div>
          {files.length ? <div className="project-files">{files.map((item) => { const isImage = item.mime_type?.startsWith("image/") && item.signed_url; return <a key={item.id} href={item.signed_url} target="_blank" rel="noreferrer" className={isImage ? "image-file" : "document-file"}>{isImage ? <Image src={item.signed_url!} alt={item.file_name} width={46} height={46} unoptimized /> : <File size={23} />}<div><strong>{item.file_name}</strong><span>{dateBr(item.created_at)}</span></div><Download size={15} /></a>; })}</div> : <EmptyState icon={<Paperclip size={21} />} title="Nenhum arquivo" description="Adicione imagens, PDFs ou documentos importantes para o projeto." action={<Button variant="secondary" onClick={() => setFileDialog(true)}><Upload size={16} /> Enviar arquivo</Button>} />}
        </section>
      </div>

      <Dialog open={taskDialog} onClose={() => setTaskDialog(false)} title="Nova tarefa" description="Defina claramente a entrega, o responsável e o prazo." wide><form className="form-grid" onSubmit={addTask}><Field label="Tarefa"><input value={taskForm.title} onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })} required maxLength={220} /></Field><Field label="Status inicial"><select value={taskForm.status} onChange={(event) => setTaskForm({ ...taskForm, status: event.target.value as TaskStatus })}>{TASK_COLUMNS.map((column) => <option value={column.key} key={column.key}>{column.label}</option>)}</select></Field><Field label="Responsável"><input value={taskForm.assignee_name} onChange={(event) => setTaskForm({ ...taskForm, assignee_name: event.target.value })} required /></Field><Field label="E-mail do responsável"><input type="email" value={taskForm.assignee_email} onChange={(event) => setTaskForm({ ...taskForm, assignee_email: event.target.value })} required /></Field><Field label="Data de entrega"><input type="date" value={taskForm.due_date} onChange={(event) => setTaskForm({ ...taskForm, due_date: event.target.value })} required /></Field><Field label="Descrição"><textarea value={taskForm.description} onChange={(event) => setTaskForm({ ...taskForm, description: event.target.value })} maxLength={2000} /></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setTaskDialog(false)}>Cancelar</Button><Button type="submit" loading={saving}>Criar tarefa</Button></div></form></Dialog>
      <Dialog open={memberDialog} onClose={() => setMemberDialog(false)} title="Adicionar envolvido" description="A pessoa poderá receber os e-mails de status do projeto."><form className="form-grid" onSubmit={addMember}><Field label="Nome"><input value={memberForm.name} onChange={(event) => setMemberForm({ ...memberForm, name: event.target.value })} required /></Field><Field label="E-mail"><input type="email" value={memberForm.email} onChange={(event) => setMemberForm({ ...memberForm, email: event.target.value })} required /></Field><Field label="Papel no projeto"><input value={memberForm.role} onChange={(event) => setMemberForm({ ...memberForm, role: event.target.value })} placeholder="Ex.: Diretoria, Engenharia" /></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setMemberDialog(false)}>Cancelar</Button><Button type="submit" loading={saving}>Adicionar</Button></div></form></Dialog>
      <Dialog open={fileDialog} onClose={() => setFileDialog(false)} title="Adicionar arquivo" description="Arquivos ficam protegidos no storage do Supabase."><form className="form-grid" onSubmit={uploadFile}><Field label="Arquivo" hint="Imagens ou documentos de até 20 MB."><label className="file-drop"><Upload size={21} /><span>{fileForm.file?.name || "Selecionar arquivo"}</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,.xls,.xlsx" onChange={(event) => setFileForm({ file: event.target.files?.[0] || null })} required /></label></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setFileDialog(false)}>Cancelar</Button><Button type="submit" loading={saving} disabled={!fileForm.file}>Enviar arquivo</Button></div></form></Dialog>
      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}
