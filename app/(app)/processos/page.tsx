"use client";

import { Button, Dialog, EmptyState, Field, PageIntro, StatusPill, Toast } from "@/components/ui";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { BusinessProcess, BusinessProcessStep, ProcessStatus } from "@/lib/types";
import { Bot, GitBranch, MessageCircleQuestion, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type StepForm = { title: string; description: string; responsible_role: string; business_rule: string };
type ChatMessage = { role: "user" | "assistant"; content: string };

const emptyStep: StepForm = { title: "", description: "", responsible_role: "", business_rule: "" };
const statusLabel: Record<ProcessStatus, string> = { rascunho: "Rascunho", publicado: "Publicado", arquivado: "Arquivado" };

export default function ProcessesPage() {
  const supabase = getSupabase();
  const [processes, setProcesses] = useState<BusinessProcess[]>([]);
  const [steps, setSteps] = useState<BusinessProcessStep[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BusinessProcess | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [form, setForm] = useState({ title: "", area: "", objective: "", rules: "", policies: "", status: "rascunho" as ProcessStatus, steps: [{ ...emptyStep }] });

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [processResult, stepResult, permissionResult] = await Promise.all([
      supabase.from("business_processes").select("*").order("updated_at", { ascending: false }),
      supabase.from("business_process_steps").select("*").order("position"),
      supabase.rpc("can_manage_processes"),
    ]);
    const error = processResult.error || stepResult.error || permissionResult.error;
    if (error) setToast({ message: friendlyError(error), type: "error" });
    const nextProcesses = (processResult.data || []) as BusinessProcess[];
    setProcesses(nextProcesses);
    setSteps((stepResult.data || []) as BusinessProcessStep[]);
    setCanManage(Boolean(permissionResult.data));
    setSelectedId((current) => nextProcesses.some((process) => process.id === current) ? current : nextProcesses[0]?.id || "");
    setLoading(false);
  }, [supabase]);

  useEffect(() => { const timer = window.setTimeout(() => void loadData(), 0); return () => window.clearTimeout(timer); }, [loadData]);

  const selected = processes.find((process) => process.id === selectedId) || null;
  const selectedSteps = useMemo(() => steps.filter((step) => step.process_id === selectedId).sort((a, b) => a.position - b.position), [selectedId, steps]);

  function openNew() {
    setEditing(null);
    setForm({ title: "", area: "", objective: "", rules: "", policies: "", status: "rascunho", steps: [{ ...emptyStep }] });
    setDialogOpen(true);
  }

  function openEdit(process: BusinessProcess) {
    setEditing(process);
    const processSteps = steps.filter((step) => step.process_id === process.id).sort((a, b) => a.position - b.position);
    setForm({
      title: process.title, area: process.area, objective: process.objective,
      rules: (process.rules || []).join("\n"), policies: (process.policies || []).join("\n"), status: process.status,
      steps: processSteps.length ? processSteps.map((step) => ({ title: step.title, description: step.description, responsible_role: step.responsible_role || "", business_rule: step.business_rule || "" })) : [{ ...emptyStep }],
    });
    setDialogOpen(true);
  }

  function updateStep(index: number, patch: Partial<StepForm>) {
    setForm((current) => ({ ...current, steps: current.steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step) }));
  }

  async function saveProcess(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !canManage) return;
    const validSteps = form.steps.filter((step) => step.title.trim() && step.description.trim());
    if (!validSteps.length) return setToast({ message: "Cadastre ao menos uma etapa completa.", type: "error" });
    setSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    const payload = {
      title: form.title.trim(), area: form.area.trim(), objective: form.objective.trim(), status: form.status,
      rules: form.rules.split("\n").map((item) => item.trim()).filter(Boolean),
      policies: form.policies.split("\n").map((item) => item.trim()).filter(Boolean),
      updated_by: auth.user?.id,
    };
    const processResult = editing
      ? await supabase.from("business_processes").update(payload).eq("id", editing.id).select("id").single()
      : await supabase.from("business_processes").insert(payload).select("id").single();
    if (processResult.error || !processResult.data) { setSaving(false); return setToast({ message: friendlyError(processResult.error), type: "error" }); }
    const processId = processResult.data.id;
    if (editing) {
      const deletion = await supabase.from("business_process_steps").delete().eq("process_id", processId);
      if (deletion.error) { setSaving(false); return setToast({ message: friendlyError(deletion.error), type: "error" }); }
    }
    const insertion = await supabase.from("business_process_steps").insert(validSteps.map((step, position) => ({ process_id: processId, ...step, responsible_role: step.responsible_role.trim() || null, business_rule: step.business_rule.trim() || null, position })));
    setSaving(false);
    if (insertion.error) return setToast({ message: friendlyError(insertion.error), type: "error" });
    setDialogOpen(false);
    setSelectedId(processId);
    setMessages([]);
    setToast({ message: editing ? "Processo atualizado." : "Processo criado.", type: "success" });
    await loadData();
  }

  async function askProcess(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !selected || !question.trim()) return;
    const asked = question.trim();
    setMessages((current) => [...current, { role: "user", content: asked }]);
    setQuestion("");
    setAsking(true);
    const { data } = await supabase.auth.getSession();
    const response = await fetch("/api/processes/chat", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token || ""}` }, body: JSON.stringify({ processId: selected.id, question: asked }) });
    const result = await response.json().catch(() => ({}));
    setAsking(false);
    setMessages((current) => [...current, { role: "assistant", content: response.ok ? result.answer : result.error || "Não foi possível consultar o processo." }]);
  }

  return <>
    <PageIntro eyebrow="Departamento · Processos" title="Processos da TLU" description="Fluxos operacionais, regras, políticas e orientação para execução." action={canManage ? <Button onClick={openNew}><Plus size={17} /> Novo processo</Button> : undefined} />
    {loading ? <div className="list-loading">Carregando processos…</div> : <div className="process-layout">
      <aside className="content-card process-catalog">
        <div className="content-card-head"><div><h2>Catálogo</h2><p>{processes.length} processo(s) disponível(is)</p></div></div>
        {processes.length ? <div className="process-list">{processes.map((process) => <button type="button" key={process.id} className={selectedId === process.id ? "active" : ""} onClick={() => { setSelectedId(process.id); setMessages([]); }}><GitBranch size={17} /><span><strong>{process.title}</strong><small>{process.area}</small></span><StatusPill tone={process.status === "publicado" ? "success" : "neutral"}>{statusLabel[process.status]}</StatusPill></button>)}</div> : <EmptyState icon={<GitBranch size={22} />} title="Nenhum processo publicado" description={canManage ? "Crie o primeiro fluxo operacional da TLU." : "Os processos publicados aparecerão aqui."} />}
      </aside>
      <main className="process-main">
        {selected ? <>
          <section className="content-card process-detail">
            <div className="content-card-head"><div><span className="eyebrow">{selected.area}</span><h2>{selected.title}</h2><p>{selected.objective}</p></div>{canManage ? <Button variant="secondary" onClick={() => openEdit(selected)}><Pencil size={15} /> Editar</Button> : null}</div>
            <div className="process-guidance-grid"><article><h3>Regras de negócio</h3>{selected.rules.length ? <ul>{selected.rules.map((rule, index) => <li key={index}>{rule}</li>)}</ul> : <p>Nenhuma regra adicional registrada.</p>}</article><article><h3>Políticas</h3>{selected.policies.length ? <ul>{selected.policies.map((policy, index) => <li key={index}>{policy}</li>)}</ul> : <p>Nenhuma política adicional registrada.</p>}</article></div>
            <div className="process-step-list"><h3>Etapas do processo</h3>{selectedSteps.map((step, index) => <article key={step.id}><span>{index + 1}</span><div><strong>{step.title}</strong><p>{step.description}</p><small>{step.responsible_role ? `Responsável: ${step.responsible_role}` : "Responsável não definido"}{step.business_rule ? ` · Regra: ${step.business_rule}` : ""}</small></div></article>)}</div>
          </section>
          <section className="content-card process-chat">
            <div className="content-card-head"><div><h2><MessageCircleQuestion size={18} /> Tire dúvidas</h2><p>As respostas usam somente o conteúdo deste processo.</p></div></div>
            <div className="process-chat-feed">{messages.length ? messages.map((message, index) => <article key={index} className={`process-chat-${message.role}`}>{message.role === "assistant" ? <Bot size={16} /> : null}<p>{message.content}</p></article>) : <div className="mini-empty">Pergunte quem é responsável, qual regra aplicar ou qual é a próxima etapa.</div>}{asking ? <article className="process-chat-assistant"><Bot size={16} /><p>Consultando o processo…</p></article> : null}</div>
            <form className="process-chat-form" onSubmit={askProcess}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Digite sua dúvida sobre este processo" maxLength={1200} /><Button type="submit" disabled={asking || !question.trim()}><Send size={16} /> Perguntar</Button></form>
          </section>
        </> : <EmptyState icon={<GitBranch size={22} />} title="Selecione um processo" description="Escolha um fluxo no catálogo para consultar suas regras e etapas." />}
      </main>
    </div>}

    <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? "Editar processo" : "Novo processo"} description="Estruture o fluxo antes de publicá-lo para toda a equipe." wide>
      <form className="form-grid process-form" onSubmit={saveProcess}>
        <Field label="Nome do processo"><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required maxLength={160} /></Field>
        <Field label="Área responsável"><input value={form.area} onChange={(event) => setForm({ ...form, area: event.target.value })} required maxLength={100} /></Field>
        <Field label="Objetivo" className="form-span-2"><textarea value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} required maxLength={3000} /></Field>
        <Field label="Regras de negócio" hint="Uma regra por linha"><textarea value={form.rules} onChange={(event) => setForm({ ...form, rules: event.target.value })} /></Field>
        <Field label="Políticas" hint="Uma política por linha"><textarea value={form.policies} onChange={(event) => setForm({ ...form, policies: event.target.value })} /></Field>
        <Field label="Publicação" className="form-span-2"><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ProcessStatus })}><option value="rascunho">Rascunho — somente editores</option><option value="publicado">Publicado — todos com acesso</option><option value="arquivado">Arquivado</option></select></Field>
        <div className="process-step-editor form-span-2"><div><strong>Etapas</strong><Button type="button" variant="secondary" onClick={() => setForm({ ...form, steps: [...form.steps, { ...emptyStep }] })}><Plus size={15} /> Adicionar etapa</Button></div>{form.steps.map((step, index) => <article key={index}><span>{index + 1}</span><div><input placeholder="Nome da etapa" value={step.title} onChange={(event) => updateStep(index, { title: event.target.value })} required /><textarea placeholder="O que deve ser feito" value={step.description} onChange={(event) => updateStep(index, { description: event.target.value })} required /><div><input placeholder="Papel responsável" value={step.responsible_role} onChange={(event) => updateStep(index, { responsible_role: event.target.value })} /><input placeholder="Regra ou condição desta etapa" value={step.business_rule} onChange={(event) => updateStep(index, { business_rule: event.target.value })} /></div></div>{form.steps.length > 1 ? <button type="button" onClick={() => setForm({ ...form, steps: form.steps.filter((_, stepIndex) => stepIndex !== index) })} aria-label="Remover etapa"><Trash2 size={16} /></button> : null}</article>)}</div>
        <div className="form-actions"><Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button type="submit" loading={saving}>{editing ? "Salvar processo" : "Criar processo"}</Button></div>
      </form>
    </Dialog>
    {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
  </>;
}
