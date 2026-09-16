"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, History, MessageSquare, Paperclip, Send, Upload } from "lucide-react";
import { Button, Dialog, Field } from "@/components/ui";
import { friendlyError, getSupabase } from "@/lib/supabase";
import { downloadTaskFile, insertTaskActivity, TASK_FILE_ACCEPT, taskFileSize, taskFileType, uploadTaskFile, type TaskActivity } from "@/lib/task-activity";
import type { ProjectTask } from "@/lib/types";

function activityDate(value: string) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function ProjectTaskHistory({ projectId }: { projectId: string }) {
  const [activities, setActivities] = useState<TaskActivity[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(100);
  const [hasMore, setHasMore] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const client = getSupabase();
      if (!client) { setError("Não foi possível conectar."); setLoading(false); return; }
      const result = await client.from("project_task_activity")
        .select("*, task:project_tasks!inner(project_id,title)").eq("task.project_id", projectId)
        .order("created_at", { ascending: false }).order("id").limit(limit + 1);
      if (cancelled) return;
      if (result.error) setError(friendlyError(result.error));
      else {
        const rows = (result.data || []).slice(0, limit);
        setActivities(rows as TaskActivity[]);
        setTitles(Object.fromEntries(rows.map((row) => [row.task_id, row.task.title])));
        setHasMore((result.data || []).length > limit);
        setError(null);
      }
      setLoading(false);
    }
    void load().catch((cause) => { if (!cancelled) { setError(friendlyError(cause)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [projectId, limit]);
  return <section className="task-project-history">
    <h3><History size={18} /> Atividades das tarefas</h3>
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    {activities.length ? <TaskActivityHistory activities={activities} taskTitles={titles} /> : !loading && !error ? <p className="mini-empty">Nenhum arquivo ou comentário registrado nas tarefas.</p> : null}
    {loading ? <p className="mini-empty">Carregando atividades…</p> : hasMore ? <Button variant="secondary" onClick={() => { setLoading(true); setLimit((current) => current + 100); }}>Carregar atividades anteriores</Button> : null}
  </section>;
}

export function TaskActivityHistory({ activities, taskTitles }: { activities: TaskActivity[]; taskTitles?: Record<string, string> }) {
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  async function download(item: TaskActivity) {
    const client = getSupabase();
    if (!client || downloading) return;
    setDownloading(item.id);
    setError(null);
    try { await downloadTaskFile(client, item); }
    catch (cause) { setError(friendlyError(cause)); }
    finally { setDownloading(null); }
  }
  return <>
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    <ol className="task-activity-history">{activities.map((item) => <li key={item.id}>
      <span className="task-activity-icon" aria-hidden="true">{item.kind === "file" ? <Paperclip size={17} /> : <MessageSquare size={17} />}</span>
      <div className="task-activity-entry">
        <header><strong>{item.author_name}</strong><time dateTime={item.created_at}>{activityDate(item.created_at)}</time></header>
        {taskTitles ? <span className="task-activity-task-title">{taskTitles[item.task_id] || "Atividade"}</span> : null}
        {item.kind === "comment" ? <p>{item.body}</p> : <>
          <p>Anexou um arquivo</p>
          <button type="button" className="task-file-download" onClick={() => void download(item)} disabled={Boolean(downloading)} aria-label={`Baixar ${item.file_name}`}>
            <Download size={16} /><span>{item.file_name}<small>{taskFileSize(item.file_size || 0)}</small></span>
            {downloading === item.id ? <small>Baixando…</small> : null}
          </button>
        </>}
      </div>
    </li>)}</ol>
  </>;
}

export function TaskActivityDialog({ task, onClose }: { task: ProjectTask; onClose: () => void }) {
  const client = getSupabase();
  const [activities, setActivities] = useState<TaskActivity[]>([]);
  const [permissions, setPermissions] = useState({ files: false, comments: false });
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const commentId = useRef<string | null>(null);
  const submitting = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (!client) throw new Error("Não foi possível conectar. Atualize a página e tente novamente.");
        const [history, access] = await Promise.all([
          client.from("project_task_activity").select("*").eq("task_id", task.id).order("created_at", { ascending: false }).order("id"),
          client.rpc("project_task_activity_permissions", { p_task_id: task.id }),
        ]);
        if (history.error) throw history.error;
        if (access.error) throw access.error;
        if (!cancelled) {
          setActivities(history.data as TaskActivity[]);
          setPermissions(access.data);
          setError(null);
          setLoadFailed(false);
        }
      } catch (cause) {
        if (!cancelled) { setError(friendlyError(cause)); setLoadFailed(true); }
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [client, task.id, reload]);

  function addActivity(item: TaskActivity) {
    setActivities((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
  }

  async function saveComment(event: FormEvent) {
    event.preventDefault();
    if (!client || submitting.current || !comment.trim()) return;
    submitting.current = true;
    setBusy(true); setError(null); setNotice(null);
    commentId.current ||= crypto.randomUUID();
    try {
      const item = await insertTaskActivity(client, { id: commentId.current, task_id: task.id, kind: "comment", body: comment.trim() });
      addActivity(item); setComment(""); commentId.current = null;
      setNotice("Comentário registrado no histórico.");
    } catch (cause) { setError(friendlyError(cause)); }
    finally { submitting.current = false; setBusy(false); }
  }

  async function uploadFiles() {
    if (!client || submitting.current || !files.length) return;
    try { files.forEach(taskFileType); }
    catch (cause) { setError(friendlyError(cause)); return; }
    submitting.current = true;
    setBusy(true); setError(null); setNotice(null);
    let completed = 0;
    try {
      for (const file of files) {
        setProgress(`Enviando ${completed + 1} de ${files.length}: ${file.name}`);
        addActivity(await uploadTaskFile(client, task.id, file));
        completed += 1;
      }
      setNotice(`${completed === 1 ? "Arquivo anexado" : `${completed} arquivos anexados`} e registrado${completed === 1 ? "" : "s"} no histórico.`);
    } catch (cause) {
      setError(`${completed ? `${completed} arquivo(s) enviado(s). ` : ""}${friendlyError(cause)} Os arquivos pendentes podem ser enviados novamente.`);
    } finally {
      setFiles((current) => current.slice(completed));
      if (inputRef.current) inputRef.current.value = "";
      setProgress(""); setBusy(false); submitting.current = false;
    }
  }

  function close() {
    if (submitting.current) return;
    if ((comment.trim() || files.length) && !window.confirm("Fechar sem enviar o comentário ou os arquivos selecionados?")) return;
    onClose();
  }

  return <Dialog open onClose={close} title="Arquivos e comentários" description={task.title} wide>
    <div className="task-activity-panel" aria-busy={loading || busy}>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      {notice ? <p className="task-activity-notice" role="status">{notice}</p> : null}
      {loading ? <p className="mini-empty">Carregando atividades…</p> : loadFailed ? <Button variant="secondary" onClick={() => { setLoading(true); setReload((value) => value + 1); }}>Tentar novamente</Button> : <>
        {permissions.files ? <section className="task-attachment-form" aria-labelledby="task-files-heading">
          <h3 id="task-files-heading"><Paperclip size={18} /> Anexar arquivos</h3>
          <p>Documentos, imagens, planilhas, apresentações, TXT, CSV ou ZIP. Até 20 MB por arquivo.</p>
          <input ref={inputRef} type="file" multiple accept={TASK_FILE_ACCEPT} disabled={busy} aria-label="Selecionar arquivos da tarefa" onChange={(event) => { setFiles(Array.from(event.target.files || [])); setError(null); setNotice(null); }} />
          {files.length ? <ul className="task-selected-files">{files.map((file, index) => <li key={`${index}-${file.name}`}><span>{file.name}</span><small>{taskFileSize(file.size)}</small></li>)}</ul> : null}
          <Button type="button" variant="secondary" onClick={() => void uploadFiles()} disabled={busy || !files.length}><Upload size={16} /> {progress ? "Enviando…" : "Enviar arquivos"}</Button>
          {progress ? <p role="status">{progress}</p> : null}
        </section> : null}
        {permissions.comments ? <form className="task-comment-form" onSubmit={saveComment}>
          <Field label="Comentário"><textarea value={comment} onChange={(event) => { setComment(event.target.value); commentId.current = null; }} placeholder="Registre uma atualização sobre esta tarefa…" maxLength={4000} rows={3} disabled={busy} required /></Field>
          <Button type="submit" disabled={busy || !comment.trim()}><Send size={16} /> Registrar comentário</Button>
        </form> : null}
        <section aria-labelledby="task-history-heading">
          <h3 id="task-history-heading"><History size={18} /> Histórico de atividades</h3>
          {activities.length ? <TaskActivityHistory activities={activities} /> : <p className="mini-empty">Nenhum arquivo ou comentário registrado nesta tarefa.</p>}
        </section>
      </>}
      <div className="form-actions"><Button type="button" variant="secondary" onClick={close} disabled={busy}>Fechar</Button></div>
    </div>
  </Dialog>;
}
