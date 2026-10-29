"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LockKeyhole, Plus, Target, Trash2 } from "lucide-react";
import { PerformanceContractViewer, PerformanceSignatureForm } from "@/components/performance-contract";
import { PERFORMANCE_CONTRACT_TERMS, performanceDate, performanceTimestamp } from "@/lib/performance-contract-document";
import { Button, EmptyState, Field, PageIntro } from "@/components/ui";
import { getSupabase } from "@/lib/supabase";
import {
  emptyPerformanceGoal, performanceAgreementError, performanceAgreementSchema,
  type PerformanceAgreement, type PerformanceAgreementInput, type PerformanceGoal, type PerformanceAcknowledgment, type PerformanceContract, type PerformanceContractAcceptance,
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
  const [view, setView] = useState<"self" | "team" | "all">("self");
  const [reportId, setReportId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const [signatures, setSignatures] = useState<PerformanceAcknowledgment[]>([]);
  const [canReview, setCanReview] = useState(false);
  const [reportIds, setReportIds] = useState<string[]>([]);
  const [contracts, setContracts] = useState<PerformanceContract[]>([]);
  const [acceptances, setAcceptances] = useState<PerformanceContractAcceptance[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [fileResult, setFileResult] = useState<{
    agreementId: string; reload: number;
    files: {name: string; path: string; created_at: string}[]; error: string;
  } | null>(null);
  const [filesReload, setFilesReload] = useState(0);
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
        const [profiles, records, acknowledgments, permission, documents, signedDocuments] = await Promise.all([
          supabase!.from("profiles").select("user_id, full_name, email").is("deleted_at", null).order("full_name"),
          supabase!.from("performance_agreements").select("*").order("starts_on", { ascending: false }).order("created_at", { ascending: false }),
          supabase!.from("performance_acknowledgments").select("*").order("signed_at", { ascending: false }),
          supabase!.rpc("can_review_performance_agreements"),
          supabase!.from("performance_agreement_contracts").select("*").order("leader_signed_at", { ascending: false }),
          supabase!.from("performance_contract_acceptances").select("*").order("signed_at", { ascending: false }),
        ]);
        if (acknowledgments.error || permission.error || documents.error || signedDocuments.error) throw acknowledgments.error || permission.error || documents.error || signedDocuments.error;
        if (profiles.error || records.error) throw profiles.error || records.error;
        if (!active) return;
        setSignatures((acknowledgments.data || []) as PerformanceAcknowledgment[]);
        const requestedId = new URL(window.location.href).searchParams.get("agreement");
        const requested = (records.data || []).find(record => record.id === requestedId);
        if (requested) {
          setSelectedId(requested.id);
          if (requested.report_user_id !== userId) { setView("team"); setReportId(requested.report_user_id); }
          else setView("self");
        }
        setCanReview(Boolean(permission.data));
        setReportIds(ids.filter(id => id !== userId));
        setContracts((documents.data || []) as PerformanceContract[]);
        setAcceptances((signedDocuments.data || []) as PerformanceContractAcceptance[]);
        setSelf(userId);
        setPeople(profiles.data || []);
        setAgreements((records.data || []) as PerformanceAgreement[]);
      } catch {
        if (active) {
          setAgreements([]);
          setPeople([]);
          setContracts([]);
          setAcceptances([]);
          setCanReview(false);
          setLoadError("Não foi possível carregar os acordos. Verifique sua conexão e tente novamente.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [supabase, reload]);

  const reports = people.filter(person => reportIds.includes(person.user_id));
  const ownerId = view === "self" ? self : view === "team" ? reportId : "";
  const owner = people.find(person => person.user_id === ownerId);
  const visible = agreements.filter(agreement => (view === "all" && canReview || agreement.report_user_id === ownerId) && (includeArchived || !agreement.archived_at));
  const selected = visible.find(agreement => agreement.id === selectedId) || visible[0];
  const selectedAgreementId = selected?.id || "";
  const currentFiles = fileResult?.agreementId === selectedAgreementId && fileResult.reload === filesReload ? fileResult : null;
  const files = currentFiles?.files || [];
  const filesError = currentFiles?.error || "";

  const currentSignature = selected && signatures.find(item => item.agreement_id === selected.id && item.agreement_version === selected.version);
  const canEdit = view === "team" && reports.some(person => person.user_id === ownerId);
  const currentContract = selected && contracts.find(item => item.agreement_id === selected.id && item.agreement_version === selected.version);
  const currentAcceptance = currentContract && acceptances.find(item => item.contract_id === currentContract.id);
  const leaderIdentity = people.find(person => person.user_id === self);
  const draftContract: PerformanceContract | undefined = selected && canEdit ? {
    id: "MINUTA", agreement_id: selected.id, agreement_version: selected.version,
    report_user_id: selected.report_user_id, leader_user_id: self,
    report_identity: { user_id: selected.report_user_id, full_name: nameOf(owner), email: owner?.email || "" },
    leader_identity: { user_id: self, full_name: nameOf(leaderIdentity), email: leaderIdentity?.email || "" },
    snapshot: selected, terms: PERFORMANCE_CONTRACT_TERMS, content_hash: "", leader_signature_name: "", leader_signed_at: "",
  } : undefined;

  useEffect(() => {
    let active = true;
    if (!selectedAgreementId || !supabase) return;
    const id = selectedAgreementId;
    void (async () => {
      try {
        const folders = await supabase.storage.from("performance-files").list(id, { limit: 1000 });
        if (folders.error) throw folders.error;
        const groups = await Promise.all((folders.data || []).map(async folder => {
          const result = await supabase.storage.from("performance-files").list(`${id}/${folder.name}`, { limit: 1000 });
          if (result.error) throw result.error;
          return (result.data || []).filter(file => file.id).map(file => ({ name: file.name.slice(37), path: `${id}/${folder.name}/${file.name}`, created_at: file.created_at || "" }));
        }));
        if (active) setFileResult({ agreementId: id, reload: filesReload, files: groups.flat(), error: "" });
      } catch { if (active) setFileResult({ agreementId: id, reload: filesReload, files: [], error: "Não foi possível carregar os anexos. Tente novamente." }); }
    })();
    return () => { active = false; };
  }, [selectedAgreementId, supabase, filesReload]);

  async function issueContract(name: string) {
    if (!selected || !canEdit || selected.archived_at || !supabase || saving) return;
    setSaving(true);
    try {
      const result = await supabase.from("performance_agreement_contracts").insert({ agreement_id: selected.id, agreement_version: selected.version, leader_signature_name: name }).select("*").single();
      if (result.error) throw result.error;
      setContracts(current => [result.data as PerformanceContract, ...current]);
      setFeedback({text: "Documento emitido e assinado. O liderado já pode abrir e assinar o acordo.", error: false});
    } catch { setFeedback({text: "Não foi possível emitir o documento. Recarregue para verificar se esta revisão já foi emitida ou alterada.", error: true}); }
    finally { setSaving(false); }
  }

  async function signContract(name: string, location?: { description: string; latitude?: number; longitude?: number }) {
    if (!currentContract || currentContract.report_user_id !== self || !supabase || saving || selected?.archived_at) return;
    setSaving(true);
    try {
      const result = await supabase.from("performance_contract_acceptances").insert({ contract_id: currentContract.id, signature_name: name, location_description: location?.description || "", latitude: location?.latitude ?? null, longitude: location?.longitude ?? null }).select("*").single();
      if (result.error) throw result.error;
      setAcceptances(current => [result.data as PerformanceContractAcceptance, ...current]);
      window.dispatchEvent(new Event("today-alert-count-changed"));
      setFeedback({text: "Acordo assinado. Data, hora e local registrados no documento disponível para você e seu líder.", error: false});
    } catch { setFeedback({text: "Não foi possível assinar. Recarregue o acordo e tente novamente.", error: true}); }
    finally { setSaving(false); }
  }

  async function archiveSelected() {
    if (!selected || !canEdit || !supabase || saving || selected.archived_at) return;
    if (!window.confirm("Excluir este acordo da lista ativa? Os documentos e as assinaturas serão preservados no histórico.")) return;
    setSaving(true);
    try {
      const result = await supabase.from("performance_agreements").update({ archived_at: new Date().toISOString() }).eq("id", selected.id).eq("version", selected.version).select("*").maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("performance_agreement_conflict");
      setAgreements(current => current.map(item => item.id === selected.id ? result.data as PerformanceAgreement : item));
      setSelectedId("");
      setFeedback({text: "Acordo excluído da lista ativa. Documentos e assinaturas preservados no histórico.", error: false});
    } catch (error) { setFeedback({text: performanceAgreementError(error), error: true}); }
    finally { setSaving(false); }
  }

  async function upload(file: File) {
    if (!selected || selected.archived_at || !supabase || saving) return;
    if (file.size > 20 * 1024 * 1024 || file.size === 0) { setFeedback({text: "Selecione um arquivo entre 1 byte e 20 MB.", error: true}); return; }
    setSaving(true);
    try {
      const path = `${selected.id}/${self}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9. _-]/g, "_")}`;
      const result = await supabase.storage.from("performance-files").upload(path, file, { upsert: false });
      if (result.error) throw result.error;
      setFilesReload(value => value + 1);
      setFeedback({text: "Arquivo anexado ao ciclo.", error: false});
    } catch { setFeedback({text: "Não foi possível anexar o arquivo. Tente novamente.", error: true}); }
    finally { setSaving(false); }
  }

  async function download(path: string, name: string) {
    if (!supabase) return;
    const result = await supabase.storage.from("performance-files").download(path);
    if (result.error) { setFeedback({text: "Não foi possível baixar o arquivo.", error: true}); return; }
    const url = URL.createObjectURL(result.data);
    const link = document.createElement("a"); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

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
    if (!canEdit || !selected || selected.archived_at || !leaveEditor()) return;
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
      description="Registre os entregáveis e expectativas de cada ciclo em um espaço privado entre colaborador e líder direto." />
    <p className="performance-privacy"><LockKeyhole size={17} aria-hidden="true" /> Acesso ao colaborador, ao líder e a quem recebeu autorização de consulta no ADM.</p>
    {loading ? <p role="status">Carregando acordos…</p> : loadError ? <section className="content-card">
      <p role="alert">{loadError}</p><Button onClick={() => setReload(value => value + 1)}>Tentar novamente</Button>
    </section> : <>
      <div className="performance-toolbar">
        <div className="performance-tabs" role="group" aria-label="Visão dos acordos">
          <Button variant={view === "self" ? "primary" : "secondary"} aria-pressed={view === "self"} disabled={saving}
            onClick={() => { if (view !== "self" && leaveEditor()) { setView("self"); setSelectedId(""); } }}>Meu acordo</Button>
          {reports.length > 0 ? <Button variant={view === "team" ? "primary" : "secondary"} aria-pressed={view === "team"} disabled={saving}
            onClick={() => { if (view !== "team" && leaveEditor()) { setView("team"); setReportId(reports[0].user_id); setSelectedId(""); } }}>Meus liderados</Button> : null}
          {canReview ? <Button variant={view === "all" ? "primary" : "secondary"} aria-pressed={view === "all"} disabled={saving} onClick={() => { if (view !== "all" && leaveEditor()) { setView("all"); setSelectedId(""); } }}>Todos os acordos</Button> : null}
        </div>
        <Button variant="secondary" disabled={saving} onClick={() => { if (leaveEditor()) setReload(value => value + 1); }}>Recarregar acordos</Button>
      </div>
      {view === "team" ? <Field label="Colaborador" className="performance-person"><select value={reportId} disabled={saving}
        onChange={event => { if (leaveEditor()) { setReportId(event.target.value); setSelectedId(""); } }}>
        {reports.map(person => <option key={person.user_id} value={person.user_id}>{nameOf(person)}</option>)}
      </select></Field> : null}
      {feedback ? <p className={feedback.error ? "performance-feedback error" : "performance-feedback"} role={feedback.error ? "alert" : "status"}>{feedback.text}</p> : null}
      <label><input type="checkbox" checked={includeArchived} disabled={saving} onChange={event => { if (leaveEditor()) setIncludeArchived(event.target.checked); }} /> Incluir acordos excluídos</label>
      {(owner || view === "all" && canReview) ? <>
        <div className="performance-toolbar"><h2>{view === "all" ? "Acordos registrados" : view === "self" ? "Meus ciclos" : `Ciclos de ${nameOf(owner)}`}</h2>
          {canEdit ? <Button onClick={startNew} disabled={saving || Boolean(editor)}><Plus size={17} /> Novo acordo</Button> : null}</div>
        {visible.length > 0 && !editor ? <div className="performance-register content-card"><table><caption>Períodos e assinaturas dos acordos</caption><thead><tr><th>Ciclo / colaborador</th><th>Início</th><th>Fim</th><th>Assinatura do líder</th><th>Assinatura do liderado</th><th>Situação</th><th>Ação</th></tr></thead><tbody>
          {visible.map(agreement => {
            const document = contracts.find(item => item.agreement_id === agreement.id && (agreement.archived_at || item.agreement_version === agreement.version));
            const acceptance = document && acceptances.find(item => item.contract_id === document.id);
            const legacy = signatures.find(item => item.agreement_id === agreement.id && item.agreement_version === agreement.version);
            return <tr key={agreement.id}><td><strong>{agreement.cycle}</strong><br />{nameOf(people.find(person => person.user_id === agreement.report_user_id)) === "Colaborador" ? document?.report_identity.full_name || "Colaborador" : nameOf(people.find(person => person.user_id === agreement.report_user_id))}</td><td>{performanceDate(agreement.starts_on)}</td><td>{performanceDate(agreement.ends_on)}</td><td>{document ? performanceTimestamp(document.leader_signed_at) : "Pendente"}</td><td>{acceptance ? performanceTimestamp(acceptance.signed_at) : legacy ? `${performanceTimestamp(legacy.signed_at)} (ciência anterior)` : "Pendente"}</td><td>{agreement.archived_at ? "Excluído · histórico preservado" : acceptance ? "Acordado" : document ? "Aguardando assinatura" : "Aguardando emissão"}</td><td><Button variant="secondary" disabled={saving} onClick={() => { setSelectedId(agreement.id); setFeedback(null); window.document.getElementById("performance-agreement-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Abrir</Button></td></tr>;
          })}
        </tbody></table></div> : null}
        {editor && canEdit ? <section className="content-card">
          <h2>{editor.id ? "Editar acordo" : "Novo acordo"}</h2>
          <p>{nameOf(owner)} · Preencha o período e os entregáveis deste ciclo.</p>
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
                  <legend>Entregável {index + 1}</legend>
                  <Field label="Descrição do entregável" className="form-span-2"><input required maxLength={300} value={goal.title} onChange={event => changeGoal(index, "title", event.target.value)} /></Field>
                  <Field label="Indicador"><input required maxLength={500} value={goal.indicator} onChange={event => changeGoal(index, "indicator", event.target.value)} /></Field>
                  <Field label="Prazo"><input required type="date" min={editor.data.starts_on || undefined} max={editor.data.ends_on || undefined} value={goal.due_date} onChange={event => changeGoal(index, "due_date", event.target.value)} /></Field>
                  <Field label="Resultado esperado" className="form-span-2"><textarea required rows={2} maxLength={1000} value={goal.expected_result} onChange={event => changeGoal(index, "expected_result", event.target.value)} /></Field>
                  <Button type="button" variant="ghost" disabled={editor.data.goals.length === 1} onClick={() => changeField("goals", editor.data.goals.filter((_, i) => i !== index))} aria-label={`Remover entregável ${index + 1}`}><Trash2 size={16} /> Remover entregável</Button>
                </fieldset>)}
                <Button type="button" variant="secondary" disabled={editor.data.goals.length >= 30} onClick={() => changeField("goals", [...editor.data.goals, emptyPerformanceGoal()])}><Plus size={16} /> Adicionar entregável</Button>
              </div>
            </fieldset>
            <div className="form-actions"><Button type="button" variant="secondary" disabled={saving} onClick={leaveEditor}>Cancelar</Button><Button type="submit" loading={saving}>Salvar acordo</Button></div>
          </form>
        </section> : visible.length === 0 ? <section className="content-card"><EmptyState icon={<Target size={24} />} title="Nenhum acordo neste momento"
          description={canEdit ? "Cadastre o primeiro ciclo para registrar os entregáveis e expectativas." : "Seu líder cadastrará o ciclo e os entregáveis para você ler e assinar."} action={canEdit ? <Button onClick={startNew}>Cadastrar acordo</Button> : undefined} /></section> : selected ? <div className="performance-layout" id="performance-agreement-detail">
          <nav className="performance-cycles content-card" aria-label="Ciclos de performance">
            {visible.map(agreement => <button key={agreement.id} type="button" className={selected.id === agreement.id ? "active" : ""}
              aria-current={selected.id === agreement.id ? "true" : undefined} disabled={saving} onClick={() => { setSelectedId(agreement.id); setFeedback(null); }}>
              <strong>{agreement.cycle}</strong><span>{agreement.archived_at ? "Excluído" : contracts.some(document => document.agreement_id === agreement.id && document.agreement_version === agreement.version && acceptances.some(acceptance => acceptance.contract_id === document.id)) ? "Acordado" : contracts.some(document => document.agreement_id === agreement.id && document.agreement_version === agreement.version) ? "Aguardando assinatura" : "Aguardando emissão"}</span><span>{dateBr(agreement.starts_on)} a {dateBr(agreement.ends_on)}</span>
            </button>)}
          </nav>
          <section className="content-card performance-detail">
            <div className="performance-toolbar"><div><span className="eyebrow">{nameOf(people.find(person => person.user_id === selected.report_user_id))}</span><h2>{selected.cycle}</h2>
              <p>{dateBr(selected.starts_on)} a {dateBr(selected.ends_on)}</p></div>{canEdit && !selected.archived_at ? <div className="performance-tabs"><Button variant="secondary" disabled={saving} onClick={editSelected}>Editar acordo</Button><Button variant="ghost" disabled={saving} onClick={() => void archiveSelected()}><Trash2 size={16} /> Excluir acordo</Button></div> : null}</div>
            {selected.expectations ? <div><h3>Expectativas e observações</h3><p className="performance-text">{selected.expectations}</p></div> : null}
            <h3>Entregáveis do ciclo</h3>
            {selected.goals.map((goal, index) => <article key={index} className="performance-goal">
              <h3>{index + 1}. {goal.title}</h3><dl><dt>Indicador</dt><dd>{goal.indicator}</dd><dt>Resultado esperado</dt><dd>{goal.expected_result}</dd><dt>Prazo</dt><dd>{dateBr(goal.due_date)}</dd></dl>
            </article>)}
            <section className="performance-goal">
              <h3>Documento e assinaturas · Revisão {selected.version}</h3>
              {selected.archived_at ? <p>Este acordo foi excluído da lista ativa. Seus documentos permanecem disponíveis abaixo.</p> : currentContract ? <>
                <p>Líder: <strong>{currentContract.leader_signature_name}</strong> · {performanceTimestamp(currentContract.leader_signed_at)}</p>
                <PerformanceContractViewer contract={currentContract} acceptance={currentAcceptance} />
                {currentAcceptance ? <p><strong>Acordado</strong> · Assinado por {currentAcceptance.signature_name} em {performanceTimestamp(currentAcceptance.signed_at)} · {currentAcceptance.location_description}</p> : <><p>Aguardando assinatura do liderado.</p>{currentContract.report_user_id === self ? <PerformanceSignatureForm key={currentContract.id} kind="report" busy={saving} onSign={signContract} /> : null}</>}
              </> : <>
                <p>O líder deve emitir e assinar o documento desta revisão para disponibilizá-lo ao liderado.</p>
                {canEdit ? <>{draftContract ? <PerformanceContractViewer contract={draftContract} draft /> : null}<p>O documento identifica as partes, o ciclo, a vigência, os entregáveis e estes compromissos: comunicar as expectativas, acompanhar a execução, atuar para alcançar os entregáveis e comunicar impedimentos. Alterações geram uma nova revisão e exigem novas assinaturas. O acordo não altera, por si só, as condições do vínculo de trabalho.</p><PerformanceSignatureForm key={`${selected.id}-${selected.version}`} kind="leader" busy={saving} onSign={issueContract} /></> : null}
                {currentSignature ? <p>Ciência anterior registrada por {currentSignature.signature_name} em {performanceTimestamp(currentSignature.signed_at)}. Esse registro não substitui a assinatura do documento formalizado.</p> : null}
              </>}
              {contracts.filter(item => item.agreement_id === selected.id && item.id !== currentContract?.id).map(document => <div key={document.id}><p>Documento preservado · Revisão {document.agreement_version}</p><PerformanceContractViewer contract={document} acceptance={acceptances.find(item => item.contract_id === document.id)} /></div>)}
              {signatures.filter(item => item.agreement_id === selected.id && item.agreement_version !== selected.version).map(item => <details key={item.id}><summary>Ciência anterior · Revisão {item.agreement_version} · {item.signature_name} · {performanceTimestamp(item.signed_at)}</summary><p>{item.statement}</p><p>{item.snapshot.cycle} · {item.snapshot.expectations}</p></details>)}
            </section>
            <section className="performance-goal"><h3>Arquivos do ciclo</h3><p>Líder e liderado podem anexar arquivos de até 20 MB.</p>
              {!selected.archived_at && (selected.report_user_id === self || reportIds.includes(selected.report_user_id)) ? <input type="file" aria-label="Anexar arquivo ao ciclo" disabled={saving} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} /> : null}
              {filesError ? <p role="alert">{filesError} <Button variant="secondary" onClick={() => setFilesReload(value => value + 1)}>Tentar novamente</Button></p> : files.length === 0 ? <p>Nenhum arquivo anexado.</p> : <ul>{files.map(file => <li key={file.path}><Button variant="ghost" onClick={() => void download(file.path, file.name)}>{file.name}</Button> · {new Date(file.created_at).toLocaleString("pt-BR")}</li>)}</ul>}
            </section>
            <small>Último salvamento: {new Date(selected.updated_at).toLocaleString("pt-BR")} · Revisão {selected.version}</small>
          </section>
        </div> : null}
      </> : <p>Nenhum colaborador disponível nesta visão. Recarregue os acordos para atualizar seus vínculos.</p>}
      {contracts.length > 0 ? <section className="content-card performance-document-archive"><h2>Documentos preservados</h2><p>Os documentos de cada revisão permanecem disponíveis às partes, inclusive após mudança de liderança.</p>{contracts.map(document => <div className="performance-archive-row" key={document.id}><span><strong>{document.snapshot.cycle}</strong> · {document.report_identity.full_name}<br />{performanceDate(document.snapshot.starts_on)} a {performanceDate(document.snapshot.ends_on)} · Revisão {document.agreement_version}</span><PerformanceContractViewer contract={document} acceptance={acceptances.find(item => item.contract_id === document.id)} /></div>)}</section> : null}
    </>}
  </div>;
}
