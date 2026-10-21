"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, MessageCircle, Plus, Send, Settings, Users } from "lucide-react";
import { getSupabase, friendlyError } from "@/lib/supabase";
import { initials } from "@/lib/format";
import type { UserProfile } from "@/lib/types";
import { Button, Dialog, Field } from "./ui";
import { UserMultiSelect } from "./user-multi-select";
import "./chat.css";

type Person = Pick<UserProfile, "user_id" | "full_name" | "email">;
type Conversation = { id: string; name: string | null; is_group: boolean; created_by: string; participants: Person[]; last_body: string | null; last_at: string; unread: number };
type Message = { id: string; conversation_id: string; sender_id: string; body: string; created_at: string };
const time = (value: string) => new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const date = (value: string) => new Date(value).toLocaleDateString("pt-BR");

export function ChatWorkspace() {
  const supabase = getSupabase();
  const [me, setMe] = useState("");
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
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
        const [{ data: auth }, people, inbox] = await Promise.all([
          supabase!.auth.getUser(),
          supabase!.from("profiles").select("user_id,full_name,email,active,is_admin").eq("active", true).is("deleted_at", null).order("full_name"),
          supabase!.rpc("chat_inbox"),
        ]);
        if (!active) return;
        if (people.error) throw people.error;
        if (inbox.error) throw inbox.error;
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
        const { data, error } = await supabase!.from("chat_messages").select("id,conversation_id,sender_id,body,created_at")
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
    if (!supabase || !conversationId || !body || sending) return;
    setSending(true); setError("");
    try {
      const { data, error } = await supabase.from("chat_messages").insert({ conversation_id: conversationId, body }).select("id,conversation_id,sender_id,body,created_at").single();
      if (error) throw error;
      setDrafts(previous => ({ ...previous, [conversationId]: "" }));
      // Thread refresh is driven by realtime and the fallback timer; inbox refresh also confirms access.
      if (data && conversationId === selectionRef.current) setMessages(previous => previous.some(m => m.id === data.id) ? previous : [...previous, data]);
      await reloadInbox();
    } catch (err) { setError(friendlyError(err)); }
    finally { setSending(false); }
  }
  const filtered = conversations.filter(c => `${title(c)} ${c.last_body || ""}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  return <div className="chat-page">
    <header className="chat-page-heading"><div><span className="eyebrow">TERRA LOTUS</span><h1>Mensagens</h1><p>Converse e conecte sua equipe.</p></div><div className="chat-actions"><Button variant="secondary" onClick={() => open("group")}><Users size={17} />Criar grupo</Button><Button onClick={() => open("direct")}><Plus size={17} />Nova conversa</Button></div></header>
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
            return <div key={message.id}>{index === 0 || date(messages[index - 1].created_at) !== date(message.created_at) ? <div className="chat-date">{date(message.created_at)}</div> : null}<article className={`chat-bubble${mine ? " mine" : ""}`}>{current.is_group && !mine ? <strong>{author?.full_name || author?.email || "Ex-participante"}</strong> : null}<p>{message.body}</p><time dateTime={message.created_at}>{time(message.created_at)}</time></article></div>;
          })}</>}<div ref={bottom} /></div>
          <form className="chat-composer" onSubmit={send}><textarea aria-label="Sua mensagem" placeholder="Escreva uma mensagem…" maxLength={4000} rows={2} value={drafts[current.id] || ""} disabled={sending} onChange={e => setDrafts(previous => ({ ...previous, [current.id]: e.target.value }))} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} /><Button type="submit" loading={sending} disabled={!drafts[current.id]?.trim()} aria-label="Enviar mensagem"><Send size={19} /><span>Enviar</span></Button><small>Enter para enviar · Shift + Enter para nova linha</small></form>
        </>}
      </section>
    </div>
    <Dialog open={dialog !== null} onClose={() => { if (!saving) setDialog(null); }} title={dialog === "group" ? "Criar grupo" : dialog === "manage" ? "Gerenciar participantes" : "Nova conversa"} description={dialog === "manage" ? "Pessoas adicionadas podem ler o histórico. Remover uma pessoa encerra seu acesso." : "Escolha usuários cadastrados e ativos da Terra Lotus."}>
      <form className="chat-dialog-form" onSubmit={saveConversation}>{dialog === "group" ? <Field label="Nome do grupo"><input value={groupName} onChange={e => setGroupName(e.target.value)} minLength={2} maxLength={100} required placeholder="Ex.: Equipe de projetos" /></Field> : null}
        {dialog === "direct" ? <Field label="Pessoa"><select value={members[0] || ""} onChange={e => setMembers([e.target.value])} required><option value="">Selecione uma pessoa</option>{users.filter(u => u.user_id !== me).map(u => <option key={u.user_id} value={u.user_id}>{u.full_name || u.email}</option>)}</select></Field> : <div><p>Participantes</p><UserMultiSelect users={users.filter(u => u.user_id !== me)} value={members} onChange={setMembers} disabled={saving} /><small>Você participa automaticamente. Até 50 pessoas por grupo.</small></div>}
        {dialogError ? <p role="alert" className="chat-error">{dialogError}</p> : null}<Button type="submit" loading={saving} disabled={!members.length || members.length > 49}>{dialog === "manage" ? "Salvar participantes" : dialog === "group" ? "Criar grupo" : "Abrir conversa"}</Button>
      </form>
    </Dialog>
  </div>;
}
