"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LockKeyhole, Plus, Target, Trash2 } from "lucide-react";
import { Button, EmptyState, Field, PageIntro } from "@/components/ui";
import { getSupabase } from "@/lib/supabase";
import {
  emptyPerformanceGoal, performanceAgreementError, performanceAgreementSchema,
  type PerformanceAgreement, type PerformanceAgreementInput, type PerformanceGoal,
} from "@/lib/performance-agreements";
import "./performance.css";

type Person = { user_id: string; full_name: string | null; email: string };
type Editor = { id: string | null; version: number | null; data: PerformanceAgreementInput };
const nameOf = (person?: Person) => person?.full_name || person?.email || "Colaborador";
const dateBr = (value: string) => value.split("-").reverse().join("/");

export default function PerformanceAgreementsPage() {
  const supabase = getSupabase();
  const [self, setSelf] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [agreements, setAgreements] = useState<PerformanceAgreement[]>([]);
  const [view, setView] = useState<"self" | "team">("self");
  const [reportId, setReportId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const auth = await supabase!.auth.getUser();
        if (auth.error || !auth.data.user) throw new Error("Sessão indisponível. Entre novamente.");
        const userId = auth.data.user.id;
        // This explicit filter also keeps administrators' selectors restricted to their own team.
        const lines = await supabase!.from("profile_reporting_lines").select("report_user_id").eq("leader_user_id", userId);
        if (lines.error) throw lines.error;
        const ids = [userId, ...(lines.data || []).map(line => line.report_user_id)];
        const [profiles, records] = await Promise.all([
          supabase!.from("profiles").select("user_id, full_name, email").in("user_id", ids).eq("active", true).is("deleted_at", null).order("full_name"),
          supabase!.from("performance_agreements").select("*").order("starts_on", { ascending: false }).order("created_at", { ascending: false }),
        ]);
        if (profiles.error || records.error) throw profiles.error || records.error;
        if (!active) return;
        setSelf(userId);
        setPeople(profiles.data || []);
        setAgreements((records.data || []) as PerformanceAgreement[]);
      } catch {
        if (active) {
          setAgreements([]);
          setPeople([]);
          setLoadError("Não foi possível carregar os acordos. Verifique sua conexão e tente novamente.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [supabase, reload]);

  const reports = people.filter(person => person.user_id !== self);
  const ownerId = view === "self" ? self : reportId;
  const owner = people.find(person => person.user_id === ownerId);
  const visible = agreements.filter(agreement => agreement.report_user_id === ownerId);
  const selected = visible.find(agreement => agreement.id === selectedId) || visible[0];

  const canEdit = view === "team" && reports.some(person => person.user_id === ownerId);

  function leaveEditor() {
    if (editor && !window.confirm("Descartar as alterações que ainda não foram salvas?")) return false;
    setEditor(null);
    setFeedback(null);
    return true;
  }

  function startNew() {
    if (!canEdit || !ownerId || !leaveEditor()) return;
    setEditor({ id: null, version: null, data: {
      report_user_id: ownerId, cycle: "", starts_on: "", ends_on: "", expectations: "", goals: [emptyPerformanceGoal()],
    } });
  }

  function editSelected() {
    if (!canEdit || !selected || !leaveEditor()) return;
    setEditor({ id: selected.id, version: selected.version, data: {
      report_user_id: selected.report_user_id, cycle: selected.cycle, starts_on: selected.starts_on,
      ends_on: selected.ends_on, expectations: selected.expectations, goals: selected.goals.map(goal => ({ ...goal })),
    } });
  }

  function changeField<K extends keyof PerformanceAgreementInput>(key: K, value: PerformanceAgreementInput[K]) {
    setEditor(current => current ? { ...current, data: { ...current.data, [key]: value } } : null);
  }

  function changeGoal(index: number, key: keyof PerformanceGoal, value: string) {
    if (!editor) return;
    changeField("goals", editor.data.goals.map((goal, i) => i === index ? { ...goal, [key]: value } : goal));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canEdit || !editor || editor.data.report_user_id !== ownerId || !supabase || saving) return;
    setFeedback(null);
    const parsed = performanceAgreementSchema.safeParse(editor.data);
    if (!parsed.success) {
      setFeedback({ text: parsed.error.issues[0].message, error: true });
      return;
    }
    setSaving(true);
    try {
      const result = editor.id
        ? await supabase.from("performance_agreements").update(parsed.data).eq("id", editor.id).eq("version", editor.version).select("*").maybeSingle()
        : await supabase.from("performance_agreements").insert(parsed.data).select("*").single();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("performance_agreement_conflict");
      const saved = result.data as PerformanceAgreement;
      setAgreements(current => [saved, ...current.filter(agreement => agreement.id !== saved.id)]
        .sort((a, b) => b.starts_on.localeCompare(a.starts_on) || b.created_at.localeCompare(a.created_at)));
      setSelectedId(saved.id);
      setEditor(null);
      setFeedback({ text: "Acordo salvo com sucesso.", error: false });
    } catch (error) {
      setFeedback({ text: performanceAgreementError(error), error: true });
    } finally {
      setSaving(false);
    }
  }

  return <div className="performance-page">
    <PageIntro eyebrow="Desenvolvimento" title="Acordo de Performance"
      description="Registre as metas e expectativas de cada ciclo em um espaço privado entre colaborador e líder direto." />
    <p className="performance-privacy"><LockKeyhole size={17} aria-hidden="true" /> Acesso exclusivo ao colaborador e ao líder direto atual.</p>
    {view === "self" ? <p>Os acordos são cadastrados e editados pelo seu líder direto.</p> : null}
    {loading ? <p role="status">Carregando acordos…</p> : loadError ? <section className="content-card">
      <p role="alert">{loadError}</p><Button onClick={() => setReload(value => value + 1)}>Tentar novamente</Button>
    </section> : <>
      <div className="performance-toolbar">
        <div className="performance-tabs" role="group" aria-label="Visão dos acordos">
          <Button variant={view === "self" ? "primary" : "secondary"} aria-pressed={view === "self"} disabled={saving}
            onClick={() => { if (view !== "self" && leaveEditor()) { setView("self"); setSelectedId(""); } }}>Meu acordo</Button>
          {reports.length > 0 ? <Button variant={view === "team" ? "primary" : "secondary"} aria-pressed={view === "team"} disabled={saving}
            onClick={() => { if (view !== "team" && leaveEditor()) { setView("team"); setReportId(reports[0].user_id); setSelectedId(""); } }}>Meus liderados</Button> : null}
        </div>
        <Button variant="secondary" disabled={saving} onClick={() => { if (leaveEditor()) setReload(value => value + 1); }}>Recarregar acordos</Button>
      </div>
      {view === "team" ? <Field label="Colaborador" className="performance-person"><select value={reportId} disabled={saving}
        onChange={event => { if (leaveEditor()) { setReportId(event.target.value); setSelectedId(""); } }}>
        {reports.map(person => <option key={person.user_id} value={person.user_id}>{nameOf(person)}</option>)}
      </select></Field> : null}
      {feedback ? <p className={feedback.error ? "performance-feedback error" : "performance-feedback"} role={feedback.error ? "alert" : "status"}>{feedback.text}</p> : null}
      {owner ? <>
        <div className="performance-toolbar"><h2>{view === "self" ? "Meus ciclos" : `Ciclos de ${nameOf(owner)}`}</h2>
          {canEdit ? <Button onClick={startNew} disabled={saving || Boolean(editor)}><Plus size={17} /> Novo acordo</Button> : null}</div>
        {editor && canEdit ? <section className="content-card">
          <h2>{editor.id ? "Editar acordo" : "Novo acordo"}</h2>
          <p>{nameOf(owner)} · Preencha o período e as metas deste ciclo.</p>
          <form onSubmit={save} className="form-grid performance-form">
            <fieldset disabled={saving} className="performance-fields">
              <Field label="Ciclo" hint="Use o mesmo nome em toda a equipe, por exemplo: 2026 — 2º semestre." className="form-span-2">
                <input required maxLength={120} value={editor.data.cycle} onChange={event => changeField("cycle", event.target.value)} />
              </Field>
              <Field label="Início do ciclo"><input required type="date" value={editor.data.starts_on} onChange={event => changeField("starts_on", event.target.value)} /></Field>
              <Field label="Término do ciclo"><input required type="date" min={editor.data.starts_on || undefined} value={editor.data.ends_on} onChange={event => changeField("ends_on", event.target.value)} /></Field>
              <Field label="Expectativas e observações" className="form-span-2"><textarea rows={4} maxLength={10000} value={editor.data.expectations} onChange={event => changeField("expectations", event.target.value)} /></Field>
              <div className="form-span-2 performance-goals">
                {editor.data.goals.map((goal, index) => <fieldset key={index} className="performance-goal form-grid">
                  <legend>Meta {index + 1}</legend>
                  <Field label="Descrição da meta" className="form-span-2"><input required maxLength={300} value={goal.title} onChange={event => changeGoal(index, "title", event.target.value)} /></Field>
                  <Field label="Indicador"><input required maxLength={500} value={goal.indicator} onChange={event => changeGoal(index, "indicator", event.target.value)} /></Field>
                  <Field label="Prazo"><input required type="date" min={editor.data.starts_on || undefined} max={editor.data.ends_on || undefined} value={goal.due_date} onChange={event => changeGoal(index, "due_date", event.target.value)} /></Field>
                  <Field label="Resultado esperado" className="form-span-2"><textarea required rows={2} maxLength={1000} value={goal.expected_result} onChange={event => changeGoal(index, "expected_result", event.target.value)} /></Field>
                  <Button type="button" variant="ghost" disabled={editor.data.goals.length === 1} onClick={() => changeField("goals", editor.data.goals.filter((_, i) => i !== index))} aria-label={`Remover meta ${index + 1}`}><Trash2 size={16} /> Remover meta</Button>
                </fieldset>)}
                <Button type="button" variant="secondary" disabled={editor.data.goals.length >= 30} onClick={() => changeField("goals", [...editor.data.goals, emptyPerformanceGoal()])}><Plus size={16} /> Adicionar meta</Button>
              </div>
            </fieldset>
            <div className="form-actions"><Button type="button" variant="secondary" disabled={saving} onClick={leaveEditor}>Cancelar</Button><Button type="submit" loading={saving}>Salvar acordo</Button></div>
          </form>
        </section> : visible.length === 0 ? <section className="content-card"><EmptyState icon={<Target size={24} />} title="Nenhum acordo neste momento"
          description={canEdit ? "Cadastre o primeiro ciclo para registrar as metas e expectativas." : "Seu líder direto cadastrará o ciclo e as metas do seu acordo."} action={canEdit ? <Button onClick={startNew}>Cadastrar acordo</Button> : undefined} /></section> : selected ? <div className="performance-layout">
          <nav className="performance-cycles content-card" aria-label="Ciclos de performance">
            {visible.map(agreement => <button key={agreement.id} type="button" className={selected.id === agreement.id ? "active" : ""}
              aria-current={selected.id === agreement.id ? "true" : undefined} onClick={() => { setSelectedId(agreement.id); setFeedback(null); }}>
              <strong>{agreement.cycle}</strong><span>{dateBr(agreement.starts_on)} a {dateBr(agreement.ends_on)}</span>
            </button>)}
          </nav>
          <section className="content-card performance-detail">
            <div className="performance-toolbar"><div><span className="eyebrow">{nameOf(owner)}</span><h2>{selected.cycle}</h2>
              <p>{dateBr(selected.starts_on)} a {dateBr(selected.ends_on)}</p></div>{canEdit ? <Button variant="secondary" onClick={editSelected}>Editar acordo</Button> : null}</div>
            {selected.expectations ? <div><h3>Expectativas e observações</h3><p className="performance-text">{selected.expectations}</p></div> : null}
            <h3>Metas do ciclo</h3>
            {selected.goals.map((goal, index) => <article key={index} className="performance-goal">
              <h3>{index + 1}. {goal.title}</h3><dl><dt>Indicador</dt><dd>{goal.indicator}</dd><dt>Resultado esperado</dt><dd>{goal.expected_result}</dd><dt>Prazo</dt><dd>{dateBr(goal.due_date)}</dd></dl>
            </article>)}
            <small>Último salvamento: {new Date(selected.updated_at).toLocaleString("pt-BR")} · Revisão {selected.version}</small>
          </section>
        </div> : null}
      </> : <p>Nenhum colaborador disponível nesta visão. Recarregue os acordos para atualizar seus vínculos.</p>}
    </>}
  </div>;
}
