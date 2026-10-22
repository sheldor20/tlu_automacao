"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ListPlus, MessageCircle, Plus, Send, Settings, Users, Paperclip, Download, X } from "lucide-react";
import { getSupabase, friendlyError } from "@/lib/supabase";
import { initials, todayIso } from "@/lib/format";
import type { ProjectCategory, UserProfile } from "@/lib/types";
import { Button, Dialog, Field } from "./ui";
import { UserMultiSelect } from "./user-multi-select";
import { emptyProjectTaskDraft, projectTaskRpcPayload } from "@/lib/project-tasks";
import "./chat.css";

type Person = Pick<UserProfile, "user_id" | "full_name" | "email">;
type Conversation = { id: string; name: string | null; is_group: boolean; created_by: string; participants: Person[]; last_body: string | null; last_at: string; unread: number };
type Attachment = { id: string; name: string; mime_type: string; size: number };
const messageColumns = "id,conversation_id,sender_id,body,created_at,chat_attachments(id,name,mime_type,size)";
type Message = { id: string; conversation_id: string; sender_id: string; body: string; created_at: string; chat_attachments?: Attachment[] };
const time = (value: string) => new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const date = (value: string) => new Date(value).toLocaleDateString("pt-BR");

export function ChatWorkspace() {
  const supabase = getSupabase();
  const [taskMessage, setTaskMessage] = useState<Message | null>(null);
  const [taskForm, setTaskForm] = useState(() => emptyProjectTaskDraft("", todayIso()));
  const [taskCategory, setTaskCategory] = useState<ProjectCategory>("operational");
  const [taskCategories, setTaskCategories] = useState<ProjectCategory[]>([]);
  const [taskSaving, setTaskSaving] = useState(false);
  const taskSavingRef = useRef(false);
  const [taskError, setTaskError] = useState("");
  const [taskNotice, setTaskNotice] = useState("");
  const [me, setMe] = useState("");
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const sendingRef = useRef(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [messageLoading, setMessageLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [dialog, setDialog] = useState<"direct" | "group" | "manage" | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [limit, setLimit] = useState(100);
  const [hasMore, setHasMore] = useState(false);
  const selectionRef = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const current = conversations.find(c => c.id === selected);
  const title = (c: Conversation) => c.is_group ? c.name || "Grupo" : c.participants.find(p => p.user_id !== me)?.full_name || c.participants.find(p => p.user_id !== me)?.email || "Usuário indisponível";
  const reloadInbox = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("chat_inbox");
    if (error) throw error;
    setConversations(data || []);
  }, [supabase]);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    async function refresh() {
      try {
        const [{ data: auth }, people, inbox, operational, governance] = await Promise.all([
          supabase!.auth.getUser(),
          supabase!.from("profiles").select("user_id,full_name,email,active,is_admin").eq("active", true).is("deleted_at", null).order("full_name"),
          supabase!.rpc("chat_inbox"),
          supabase!.rpc("has_project_category_access", { p_category: "operational" }),
          supabase!.rpc("has_project_category_access", { p_category: "governance" }),
        ]);
        if (!active) return;
        if (people.error) throw people.error;
        if (inbox.error) throw inbox.error;
        setTaskCategories([
          ...(operational.data === true ? ["operational" as const] : []),
          ...(governance.data === true ? ["governance" as const] : []),
        ]);
        setMe(auth.user?.id || ""); setUsers(people.data || []); setConversations(inbox.data || []); setError("");
      } catch (err) { if (active) setError(friendlyError(err)); }
      finally { if (active) setLoading(false); }
    }
    void refresh();
    const channel = supabase.channel("chat-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_members" }, () => void refresh())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_conversations" }, () => void refresh())
      .subscribe();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 15000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", onFocus); void supabase.removeChannel(channel); };
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !selected) return;
    let active = true;
    let revision = 0;
    async function refresh() {
      const request = ++revision;
      try {
        const { data, error } = await supabase!.from("chat_messages").select(messageColumns)
          .eq("conversation_id", selected).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
        if (!active || request !== revision) return;
        if (error) throw error;
        const rows = (data || []).slice(0, limit).reverse() as Message[];
        setMessages(rows); setHasMore((data || []).length > limit); setMessageLoading(false);
        if (document.visibilityState === "visible" && document.hasFocus() && rows.length) {
          const result = await supabase!.rpc("mark_chat_read", { p_conversation: selected, p_through: rows[rows.length - 1].created_at });
          if (result.error) throw result.error;
          if (active) { await reloadInbox(); window.dispatchEvent(new Event("chat-unread-changed")); }
        }
      } catch (err) { if (active) { setError(friendlyError(err)); setMessageLoading(false); } }
    }
    void refresh();
    const channel = supabase.channel(`chat-thread-${selected}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `conversation_id=eq.${selected}` }, () => void refresh()).subscribe();
    const onFocus = () => void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 10000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); void supabase.removeChannel(channel); };
  }, [supabase, selected, limit, reloadInbox]);

  const latestMessageId = messages.at(-1)?.id;
  useEffect(() => { bottom.current?.scrollIntoView({ block: "nearest" }); }, [latestMessageId]);

  function select(id: string) { selectionRef.current = id; setSelected(id); setMessages([]); setLimit(100); setMessageLoading(true); setError(""); }
  function open(kind: "direct" | "group" | "manage") {
    setMembers(kind === "manage" ? current?.participants.filter(p => p.user_id !== me).map(p => p.user_id) || [] : []);
    setGroupName(""); setDialogError(""); setDialog(kind);
  }
  async function saveConversation(event: FormEvent) {
    event.preventDefault(); if (!supabase || saving) return;
    setSaving(true); setDialogError("");
    try {
      const result = dialog === "manage"
        ? await supabase.rpc("set_chat_group_members", { p_conversation: selected, p_members: members })
        : await supabase.rpc("create_chat_conversation", { p_members: members, p_name: dialog === "group" ? groupName.trim() : null });
      if (result.error) throw result.error;
      await reloadInbox(); if (dialog !== "manage") select(result.data); setDialog(null);
    } catch (err) { setDialogError(friendlyError(err)); }
    finally { setSaving(false); }
  }
  async function send(event: FormEvent) {
    event.preventDefault(); const conversationId = selected; const body = (drafts[conversationId || ""] || "").trim();
    const attachments = files[conversationId || ""] || [];
    if (!supabase || !conversationId || (!body && !attachments.length) || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true); setError("");
    try {
      let messageId: string;
      if (attachments.length) {
        const encoded = await Promise.all(attachments.map(file => new Promise<{name:string;mime_type:string;data:string}>((resolve,reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error(`Não foi possível ler ${file.name}.`));
          reader.onload = () => resolve({name:file.name,mime_type:file.type || "application/octet-stream",data:String(reader.result).split(",")[1]});
          reader.readAsDataURL(file);
        })));
        const result = await supabase.rpc("send_chat_attachments", {p_conversation:conversationId,p_body:body,p_files:encoded});
        if (result.error) throw result.error;
        messageId = result.data;
      } else {
        const result = await supabase.from("chat_messages").insert({conversation_id:conversationId,body}).select("id").single();
        if (result.error) throw result.error;
        messageId = result.data.id;
      }
      setDrafts(previous => ({ ...previous, [conversationId]: "" }));
      setFiles(previous => ({ ...previous, [conversationId]: [] }));
      const result = await supabase.from("chat_messages").select(messageColumns).eq("id",messageId).single();
      if (result.error) throw result.error;
      const data = result.data as Message;
      // Thread refresh is driven by realtime and the fallback timer; inbox refresh also confirms access.
      if (data && conversationId === selectionRef.current) setMessages(previous => previous.some(m => m.id === data.id) ? previous : [...previous, data]);
      await reloadInbox();
    } catch (err) { setError(friendlyError(err)); }
    finally { sendingRef.current = false; setSending(false); }
  }
  function addFiles(conversationId: string, incoming: File[]) {
    const next = [...(files[conversationId] || []), ...incoming];
    if (next.length > 5 || next.some(file => !file.size || file.size > 5 * 1024 * 1024) || next.reduce((sum,file) => sum + file.size,0) > 10 * 1024 * 1024) {
      setError("Selecione até 5 arquivos não vazios, de até 5 MB cada e 10 MB no total."); return;
    }
    setError(""); setFiles(previous => ({...previous,[conversationId]:next}));
  }
  async function download(file: Attachment) {
    if (!supabase || downloading) return;
    setDownloading(file.id); setError("");
    try {
      const {data,error} = await supabase.rpc("download_chat_attachment",{p_id:file.id});
      if (error) throw error;
      if (!data?.length) throw new Error("Anexo indisponível ou acesso encerrado.");
      const bytes = Uint8Array.from(atob(data[0].data.replace(/\s/g,"")), character => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes],{type:data[0].mime_type}));
      const link = document.createElement("a"); link.href=url; link.download=data[0].name; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url),60000);
    } catch (err) { setError(friendlyError(err)); }
    finally { setDownloading(null); }
  }
  function openTask(message: Message) {
    setTaskForm({ ...emptyProjectTaskDraft("", todayIso(), "a_fazer", [me]),
      title: message.body.replace(/\s+/g, " ").trim().slice(0, 220),
      description: message.body,
    });
    setTaskCategory(taskCategories[0] || "operational");
    setTaskError(""); setTaskNotice(""); setTaskMessage(message);
  }
  async function saveMessageTask(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !taskMessage || taskSavingRef.current) return;
    if (taskForm.title.trim().length < 2 || !taskForm.assignee_user_ids.length) {
      setTaskError("Informe um título com pelo menos 2 caracteres e selecione um responsável."); return;
    }
    taskSavingRef.current = true; setTaskSaving(true); setTaskError("");
    try {
      const { error } = await supabase.rpc("save_project_task", projectTaskRpcPayload(taskForm, taskCategory));
      if (error) throw error;
      setTaskMessage(null);
      setTaskNotice("Tarefa criada. Você pode acompanhá-la em " + (taskCategory === "governance" ? "Governança." : "Projetos."));
    } catch (err) { setTaskError(friendlyError(err)); }
    finally { taskSavingRef.current = false; setTaskSaving(false); }
  }
  const filtered = conversations.filter(c => `${title(c)} ${c.last_body || ""}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  return <div className="chat-page">
    <header className="chat-page-heading"><div><span className="eyebrow">TERRA LOTUS</span><h1>Mensagens</h1><p>Converse e conecte sua equipe.</p></div><div className="chat-actions"><Button variant="secondary" onClick={() => open("group")}><Users size={17} />Criar grupo</Button><Button onClick={() => open("direct")}><Plus size={17} />Nova conversa</Button></div></header>
    {taskNotice ? <div className="chat-task-notice" role="status">{taskNotice}</div> : null}
    {error ? <div className="chat-error" role="alert">{error}</div> : null}
    <div className={`chat-layout${selected ? " has-selection" : ""}`}>
      <aside className="chat-list" aria-label="Conversas"><div className="chat-search"><input aria-label="Buscar conversas" placeholder="Buscar conversas…" value={query} onChange={e => setQuery(e.target.value)} /></div>
        {loading ? <p className="chat-empty">Carregando conversas…</p> : !filtered.length ? <div className="chat-empty"><MessageCircle size={30} /><p>{query ? "Nenhuma conversa encontrada." : "Sua próxima conversa começa aqui."}</p><Button variant="secondary" onClick={() => open("direct")}>Iniciar conversa</Button></div> : filtered.map(c => <button type="button" key={c.id} className={`chat-list-item${selected === c.id ? " selected" : ""}`} onClick={() => select(c.id)} aria-current={selected === c.id ? "true" : undefined}><span className="chat-avatar">{c.is_group ? <Users size={20} /> : initials(title(c))}</span><span className="chat-preview"><strong>{title(c)}</strong><small>{c.last_body || "Conversa iniciada"}</small></span><span className="chat-list-meta"><time>{date(c.last_at)}</time>{Number(c.unread) > 0 ? <b aria-label={`${c.unread} mensagens não lidas`}>{c.unread}</b> : null}</span></button>)}
      </aside>
      <section className="chat-thread" aria-label="Conversa selecionada">
        {!current ? <div className="chat-welcome"><span className="chat-welcome-icon"><MessageCircle size={36} /></span><h2>Um espaço para conversar</h2><p>Selecione uma conversa ou comece uma nova.<br />As mensagens são visíveis apenas aos participantes.</p></div> : <>
          <header className="chat-thread-head"><button className="icon-button chat-back" aria-label="Voltar às conversas" onClick={() => { selectionRef.current = null; setSelected(null); }}><ArrowLeft size={20} /></button><span className="chat-avatar">{current.is_group ? <Users size={20} /> : initials(title(current))}</span><div><h2>{title(current)}</h2><p>{current.is_group ? `${current.participants.length} participantes · ${current.participants.map(p => p.full_name || p.email || "Usuário").join(", ")}` : "Conversa privada"}</p></div>{current.is_group && current.created_by === me ? <button className="icon-button" onClick={() => open("manage")} aria-label="Gerenciar participantes"><Settings size={20} /></button> : null}</header>
          <div className="chat-history" role="log" aria-label="Histórico de mensagens" aria-live="polite">{messageLoading ? <p className="chat-empty">Carregando mensagens…</p> : <>{hasMore ? <Button variant="secondary" onClick={() => setLimit(n => n + 100)}>Carregar mensagens anteriores</Button> : null}{!messages.length ? <p className="chat-empty">Envie a primeira mensagem.</p> : messages.map((message, index) => {
            const author = current.participants.find(p => p.user_id === message.sender_id) || users.find(p => p.user_id === message.sender_id);
            const mine = message.sender_id === me;
            return <div key={message.id}>{index === 0 || date(messages[index - 1].created_at) !== date(message.created_at) ? <div className="chat-date">{date(message.created_at)}</div> : null}<article className={`chat-bubble${mine ? " mine" : ""}`}>{current.is_group && !mine ? <strong>{author?.full_name || author?.email || "Ex-participante"}</strong> : null}<p>{message.body}</p>{message.chat_attachments?.map(file => <button key={file.id} type="button" className="chat-attachment" disabled={downloading !== null} onClick={() => void download(file)} aria-label={`Baixar ${file.name}`}><Download size={16} /><span>{downloading === file.id ? "Baixando…" : file.name}<small>{(file.size / 1024).toLocaleString("pt-BR", {maximumFractionDigits:0})} KB</small></span></button>)}{taskCategories.length ? <button type="button" className="chat-create-task" onClick={() => openTask(message)}><ListPlus size={14} />Criar tarefa</button> : null}<time dateTime={message.created_at}>{time(message.created_at)}</time></article></div>;
          })}</>}<div ref={bottom} /></div>
          <form className="chat-composer" onSubmit={send}>
            <div className="chat-attachment-tools"><label className="chat-attach-button"><Paperclip size={17} />Anexar fotos e documentos<input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.odt,.ods" disabled={sending} onChange={e => { addFiles(current.id,Array.from(e.target.files || [])); e.target.value=""; }} /></label><small>Até 5 arquivos · 5 MB por arquivo · 10 MB por mensagem</small></div>
            {(files[current.id] || []).length ? <ul className="chat-pending-files">{files[current.id].map((file,index) => <li key={`${file.name}-${index}`}><span>{file.name}</span><button type="button" disabled={sending} aria-label={`Remover ${file.name}`} onClick={() => setFiles(previous => ({...previous,[current.id]:(previous[current.id] || []).filter((_,i) => i !== index)}))}><X size={15} /></button></li>)}</ul> : null}<textarea aria-label="Sua mensagem" placeholder="Escreva uma mensagem…" maxLength={4000} rows={2} value={drafts[current.id] || ""} disabled={sending} onChange={e => setDrafts(previous => ({ ...previous, [current.id]: e.target.value }))} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} /><Button type="submit" loading={sending} disabled={!drafts[current.id]?.trim() && !files[current.id]?.length} aria-label="Enviar mensagem"><Send size={19} /><span>Enviar</span></Button><small>Enter para enviar · Shift + Enter para nova linha</small></form>
        </>}
      </section>
    </div>
    <Dialog open={taskMessage !== null} onClose={() => { if (!taskSavingRef.current) setTaskMessage(null); }} title="Criar tarefa da mensagem" description="Revise o texto e escolha responsáveis e prazo. A tarefa será criada como atividade avulsa; os responsáveis poderão ler a descrição.">
      <form className="chat-dialog-form" onSubmit={saveMessageTask}>
        {taskCategories.length > 1 ? <Field label="Área"><select value={taskCategory} disabled={taskSaving} onChange={e => setTaskCategory(e.target.value as ProjectCategory)}>{taskCategories.map(category => <option key={category} value={category}>{category === "governance" ? "Governança" : "Projetos"}</option>)}</select></Field> : null}
        <Field label="Título"><input required minLength={2} maxLength={220} value={taskForm.title} disabled={taskSaving} onChange={e => setTaskForm({ ...taskForm, title: e.target.value })} /></Field>
        <Field label="Descrição"><textarea maxLength={4000} rows={5} value={taskForm.description} disabled={taskSaving} onChange={e => setTaskForm({ ...taskForm, description: e.target.value })} /></Field>
        <Field label="Responsáveis"><UserMultiSelect users={users} value={taskForm.assignee_user_ids} disabled={taskSaving} onChange={assignee_user_ids => setTaskForm({ ...taskForm, assignee_user_ids })} /></Field>
        <Field label="Data de entrega"><input type="date" required value={taskForm.due_date} disabled={taskSaving} onChange={e => setTaskForm({ ...taskForm, due_date: e.target.value })} /></Field>
        {taskError ? <p className="chat-error" role="alert">{taskError}</p> : null}
        <div className="chat-actions"><Button type="button" variant="secondary" disabled={taskSaving} onClick={() => setTaskMessage(null)}>Cancelar</Button><Button type="submit" loading={taskSaving} disabled={!taskForm.assignee_user_ids.length || !taskCategories.includes(taskCategory)}>Criar tarefa</Button></div>
      </form>
    </Dialog>
    <Dialog open={dialog !== null} onClose={() => { if (!saving) setDialog(null); }} title={dialog === "group" ? "Criar grupo" : dialog === "manage" ? "Gerenciar participantes" : "Nova conversa"} description={dialog === "manage" ? "Pessoas adicionadas podem ler o histórico. Remover uma pessoa encerra seu acesso." : "Escolha usuários cadastrados e ativos da Terra Lotus."}>
      <form className="chat-dialog-form" onSubmit={saveConversation}>{dialog === "group" ? <Field label="Nome do grupo"><input value={groupName} onChange={e => setGroupName(e.target.value)} minLength={2} maxLength={100} required placeholder="Ex.: Equipe de projetos" /></Field> : null}
        {dialog === "direct" ? <Field label="Pessoa"><select value={members[0] || ""} onChange={e => setMembers([e.target.value])} required><option value="">Selecione uma pessoa</option>{users.filter(u => u.user_id !== me).map(u => <option key={u.user_id} value={u.user_id}>{u.full_name || u.email}</option>)}</select></Field> : <div><p>Participantes</p><UserMultiSelect users={users.filter(u => u.user_id !== me)} value={members} onChange={setMembers} disabled={saving} /><small>Você participa automaticamente. Até 50 pessoas por grupo.</small></div>}
        {dialogError ? <p role="alert" className="chat-error">{dialogError}</p> : null}<Button type="submit" loading={saving} disabled={!members.length || members.length > 49}>{dialog === "manage" ? "Salvar participantes" : dialog === "group" ? "Criar grupo" : "Abrir conversa"}</Button>
      </form>
    </Dialog>
  </div>;
}
