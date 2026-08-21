"use client";

import { Button, Dialog, EmptyState, Field, PageIntro, StatusPill, Toast } from "@/components/ui";
import { dateBr, todayIso } from "@/lib/format";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { Project, ProjectTask, RaAgendaItem, RaAgendaSection, RaDecision, RaItemKind, RaMeeting, RaMeetingProject, RaParticipant, UserProfile } from "@/lib/types";
import { ArrowRight, CalendarDays, Check, ClipboardList, FileText, FolderKanban, ListPlus, Mail, Play, Plus, Save, Users } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const statusLabel = { rascunho: "Em preparação", em_andamento: "RA em andamento", encerrada: "Encerrada" } as const;
const kindLabel: Record<RaItemKind, string> = { topico: "Tópico", acao: "Ação", definicao: "A definir" };

function defaultMeetingDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function RaPage() {
  const supabase = getSupabase();
  const [meetings, setMeetings] = useState<RaMeeting[]>([]);
  const [participants, setParticipants] = useState<RaParticipant[]>([]);
  const [meetingProjects, setMeetingProjects] = useState<RaMeetingProject[]>([]);
  const [sections, setSections] = useState<RaAgendaSection[]>([]);
  const [items, setItems] = useState<RaAgendaItem[]>([]);
  const [decisions, setDecisions] = useState<RaDecision[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectTasks, setProjectTasks] = useState<ProjectTask[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [meetingDialog, setMeetingDialog] = useState(false);
  const [sectionDialog, setSectionDialog] = useState(false);
  const [itemDialog, setItemDialog] = useState(false);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [decisionDrafts, setDecisionDrafts] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [meetingForm, setMeetingForm] = useState({ title: "RA semanal", scheduled_at: defaultMeetingDate(), participant_ids: [] as string[], project_ids: [] as string[] });
  const [sectionForm, setSectionForm] = useState({ title: "", project_id: "" });
  const [itemForm, setItemForm] = useState({ content: "", kind: "topico" as RaItemKind, owner_user_id: "", due_date: "", project_id: "" });

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data: auth } = await supabase.auth.getUser();
    const [meetingResult, participantResult, selectedProjectResult, sectionResult, itemResult, decisionResult, projectResult, taskResult, userResult, manageResult] = await Promise.all([
      supabase.from("ra_meetings").select("*").order("scheduled_at", { ascending: false }),
      supabase.from("ra_participants").select("*"),
      supabase.from("ra_meeting_projects").select("*"),
      supabase.from("ra_agenda_sections").select("*").order("position"),
      supabase.from("ra_agenda_items").select("*").order("position"),
      supabase.from("ra_decisions").select("*").order("decided_at", { ascending: false }),
      supabase.from("project_progress_summary").select("*").eq("status", "ativo").is("archived_at", null).order("name"),
      supabase.from("project_tasks").select("*").neq("status", "concluida").order("due_date"),
      supabase.from("profiles").select("user_id,full_name,email,active,is_admin").eq("active", true).order("full_name"),
      supabase.rpc("can_manage_ra"),
    ]);
    const error = meetingResult.error || participantResult.error || selectedProjectResult.error || sectionResult.error || itemResult.error || decisionResult.error || projectResult.error || taskResult.error || userResult.error || manageResult.error;
    if (error) setToast({ message: friendlyError(error), type: "error" });
    const nextMeetings = (meetingResult.data || []) as RaMeeting[];
    setMeetings(nextMeetings);
    setParticipants((participantResult.data || []) as RaParticipant[]);
    setMeetingProjects((selectedProjectResult.data || []) as RaMeetingProject[]);
    setSections((sectionResult.data || []) as RaAgendaSection[]);
    setItems((itemResult.data || []) as RaAgendaItem[]);
    setDecisions((decisionResult.data || []) as RaDecision[]);
    setProjects((projectResult.data || []) as Project[]);
    setProjectTasks((taskResult.data || []) as ProjectTask[]);
    setUsers((userResult.data || []) as UserProfile[]);
    setCurrentUserId(auth.user?.id || "");
    setCanManage(Boolean(manageResult.data));
    setSelectedId((current) => nextMeetings.some((meeting) => meeting.id === current) ? current : nextMeetings[0]?.id || "");
    setLoading(false);
  }, [supabase]);

  useEffect(() => { const timer = window.setTimeout(() => void loadData(), 0); return () => window.clearTimeout(timer); }, [loadData]);

  const selected = meetings.find((meeting) => meeting.id === selectedId) || null;
  const canManageSelected = Boolean(selected && canManage && (selected.leader_user_id === currentUserId || users.find((user) => user.user_id === currentUserId)?.is_admin));
  const selectedParticipants = participants.filter((participant) => participant.meeting_id === selectedId);
  const selectedProjectIds = meetingProjects.filter((item) => item.meeting_id === selectedId).map((item) => item.project_id);
  const selectedSections = sections.filter((section) => section.meeting_id === selectedId).sort((a, b) => a.position - b.position);
  const selectedDecisions = decisions.filter((decision) => decision.meeting_id === selectedId);
  const openProjectTasks = useMemo(() => projectTasks.filter((task) => task.project_id && selectedProjectIds.includes(task.project_id)), [projectTasks, selectedProjectIds]);
  const userName = (id: string | null) => users.find((user) => user.user_id === id)?.full_name || users.find((user) => user.user_id === id)?.email || "A definir";
  const projectName = (id: string | null) => projects.find((project) => project.id === id)?.name || "Projeto";

  function toggleMeetingChoice(field: "participant_ids" | "project_ids", id: string) {
    setMeetingForm((current) => ({ ...current, [field]: current[field].includes(id) ? current[field].filter((item) => item !== id) : [...current[field], id] }));
  }

  async function createMeeting(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !canManage || !currentUserId) return;
    setSaving(true);
    const result = await supabase.from("ra_meetings").insert({ title: meetingForm.title.trim(), scheduled_at: new Date(meetingForm.scheduled_at).toISOString(), leader_user_id: currentUserId }).select("id").single();
    if (result.error || !result.data) { setSaving(false); return setToast({ message: friendlyError(result.error), type: "error" }); }
    const meetingId = result.data.id;
    const participantIds = [...new Set([currentUserId, ...meetingForm.participant_ids])];
    const writes = await Promise.all([
      supabase.from("ra_participants").insert(participantIds.map((user_id) => ({ meeting_id: meetingId, user_id }))),
      meetingForm.project_ids.length ? supabase.from("ra_meeting_projects").insert(meetingForm.project_ids.map((project_id) => ({ meeting_id: meetingId, project_id }))) : Promise.resolve({ error: null }),
      meetingForm.project_ids.length ? supabase.from("ra_agenda_sections").insert(meetingForm.project_ids.map((project_id, position) => ({ meeting_id: meetingId, project_id, title: projectName(project_id), position }))) : Promise.resolve({ error: null }),
    ]);
    setSaving(false);
    const error = writes.find((write) => write.error)?.error;
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setMeetingDialog(false);
    setMeetingForm({ title: "RA semanal", scheduled_at: defaultMeetingDate(), participant_ids: [], project_ids: [] });
    setSelectedId(meetingId);
    setToast({ message: "Pauta criada para preparação.", type: "success" });
    await loadData();
  }

  async function addSection(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !selected || !canManageSelected) return;
    setSaving(true);
    const { error } = await supabase.from("ra_agenda_sections").insert({ meeting_id: selected.id, title: sectionForm.title.trim(), project_id: sectionForm.project_id || null, position: selectedSections.length });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setSectionDialog(false); setSectionForm({ title: "", project_id: "" }); await loadData();
  }

  function openItem(sectionId: string) {
    const section = selectedSections.find((item) => item.id === sectionId);
    setSelectedSectionId(sectionId);
    setItemForm({ content: "", kind: "topico", owner_user_id: "", due_date: "", project_id: section?.project_id || "" });
    setItemDialog(true);
  }

  async function addItem(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !selectedSectionId || !canManageSelected) return;
    const sectionItems = items.filter((item) => item.section_id === selectedSectionId);
    setSaving(true);
    const { error } = await supabase.from("ra_agenda_items").insert({ section_id: selectedSectionId, content: itemForm.content.trim(), kind: itemForm.kind, owner_user_id: itemForm.owner_user_id || null, due_date: itemForm.due_date || null, project_id: itemForm.project_id || null, position: sectionItems.length });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setItemDialog(false); await loadData();
  }

  async function convertToTask(item: RaAgendaItem) {
    if (!supabase || !item.owner_user_id || !item.due_date) return setToast({ message: "Defina responsável e prazo no tópico antes de criar a tarefa.", type: "error" });
    setSaving(true);
    const { error } = await supabase.rpc("convert_ra_item_to_task", { p_item_id: item.id, p_assignee_user_id: item.owner_user_id, p_due_date: item.due_date, p_project_id: item.project_id || null });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setToast({ message: `Tarefa criada para ${userName(item.owner_user_id)}.`, type: "success" }); await loadData();
  }

  async function recordDecision(item: RaAgendaItem) {
    if (!supabase) return;
    const text = (decisionDrafts[item.id] || item.decision_text || "").trim();
    if (!text) return setToast({ message: "Registre a definição tomada na reunião.", type: "error" });
    setSaving(true);
    const { error } = await supabase.rpc("record_ra_decision", { p_item_id: item.id, p_decision_text: text });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setToast({ message: "Definição adicionada ao catálogo.", type: "success" }); await loadData();
  }

  async function startMeeting() {
    if (!supabase || !selected) return;
    const { error } = await supabase.from("ra_meetings").update({ status: "em_andamento" }).eq("id", selected.id);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    await loadData();
  }

  async function closeMeeting() {
    if (!supabase || !selected) return;
    setSaving(true);
    const { data } = await supabase.auth.getSession();
    const response = await fetch(`/api/ra/${selected.id}/close`, { method: "POST", headers: { Authorization: `Bearer ${data.session?.access_token || ""}` } });
    const result = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return setToast({ message: result.error || "Não foi possível encerrar a RA.", type: "error" });
    setToast({ message: `RA encerrada e ATA enviada para ${result.recipientCount} participante(s).`, type: "success" }); await loadData();
  }

  return <>
    <PageIntro eyebrow="Departamento · Pauta e RA" title="Reuniões de alinhamento" description="Prepare a pauta, registre definições e transforme combinados em tarefas." action={canManage ? <Button onClick={() => setMeetingDialog(true)}><Plus size={17} /> Nova RA</Button> : undefined} />
    {loading ? <div className="list-loading">Carregando reuniões…</div> : <div className="ra-layout">
      <aside className="content-card ra-meeting-list"><div className="content-card-head"><div><h2>Reuniões</h2><p>{meetings.length} RA(s) visível(is)</p></div></div>{meetings.length ? meetings.map((meeting) => <button type="button" key={meeting.id} className={selectedId === meeting.id ? "active" : ""} onClick={() => setSelectedId(meeting.id)}><CalendarDays size={17} /><span><strong>{meeting.title}</strong><small>{dateBr(meeting.scheduled_at)} · {userName(meeting.leader_user_id)}</small></span><StatusPill tone={meeting.status === "encerrada" ? "success" : meeting.status === "em_andamento" ? "warning" : "neutral"}>{statusLabel[meeting.status]}</StatusPill></button>) : <EmptyState icon={<ClipboardList size={22} />} title="Nenhuma RA" description="As reuniões em que você participa aparecerão aqui." />}</aside>
      <main className="ra-main">
        {selected ? <>
          <section className="content-card ra-header"><div><span className="eyebrow">{statusLabel[selected.status]}</span><h2>{selected.title}</h2><p>{dateBr(selected.scheduled_at)} · Líder: {userName(selected.leader_user_id)}</p><div className="ra-participant-chips">{selectedParticipants.map((participant) => <span key={participant.user_id}><Users size={12} /> {userName(participant.user_id)}</span>)}</div></div>{canManageSelected && selected.status !== "encerrada" ? <div className="page-action-group">{selected.status === "rascunho" ? <Button variant="secondary" onClick={() => void startMeeting()}><Play size={15} /> Iniciar RA</Button> : null}<Button onClick={() => void closeMeeting()} loading={saving}><Mail size={15} /> Encerrar e enviar ATA</Button></div> : null}</section>

          {selected.status === "encerrada" ? <section className="content-card ra-minutes"><div className="content-card-head"><div><h2><FileText size={18} /> ATA da reunião</h2><p>Registro final enviado aos participantes</p></div></div><pre>{selected.minutes_text}</pre></section> : <>
            {selectedProjectIds.length ? <section className="content-card ra-project-snapshot"><div className="content-card-head"><div><h2>Projetos para discussão</h2><p>Tarefas abertas e vencidas dos projetos selecionados</p></div></div><div>{selectedProjectIds.map((projectId) => { const tasks = openProjectTasks.filter((task) => task.project_id === projectId); const overdue = tasks.filter((task) => task.due_date < todayIso()); return <article key={projectId}><div><FolderKanban size={17} /><span><strong>{projectName(projectId)}</strong><small>{overdue.length} atrasada(s) · {tasks.length} aberta(s)</small></span></div>{tasks.length ? <ul>{tasks.slice(0, 8).map((task) => <li key={task.id} className={task.due_date < todayIso() ? "danger" : ""}><span>{task.title}</span><small>{task.assignee_name} · {dateBr(task.due_date)}</small></li>)}</ul> : <p>Nenhuma tarefa aberta.</p>}</article>; })}</div></section> : null}

            <section className="content-card ra-agenda"><div className="content-card-head"><div><h2>Pauta da RA</h2><p>Tópicos, ações e itens a definir durante a reunião</p></div>{canManageSelected ? <Button variant="secondary" onClick={() => setSectionDialog(true)}><ListPlus size={15} /> Novo bloco</Button> : null}</div><div className="ra-section-list">{selectedSections.map((section, sectionIndex) => { const sectionItems = items.filter((item) => item.section_id === section.id); return <article key={section.id}><header><span>{sectionIndex + 1}</span><div><strong>{section.title}</strong>{section.project_id ? <small>{projectName(section.project_id)}</small> : null}</div>{canManageSelected ? <button type="button" onClick={() => openItem(section.id)}><Plus size={15} /> Tópico</button> : null}</header><div className="ra-item-list">{sectionItems.length ? sectionItems.map((item) => <div key={item.id}><span className="ra-bullet">•</span><div><strong>{item.owner_user_id ? `${userName(item.owner_user_id)}: ` : ""}{item.content}</strong><small>{kindLabel[item.kind]}{item.due_date ? ` · prazo ${dateBr(item.due_date)}` : ""}{item.project_id ? ` · ${projectName(item.project_id)}` : ""}</small>{item.decision_text ? <p><Check size={13} /> {item.decision_text}</p> : null}{item.task_id ? <p><ArrowRight size={13} /> Tarefa criada no TLU Space</p> : null}{canManageSelected && !item.task_id ? <div className="ra-item-controls"><Button variant="secondary" onClick={() => void convertToTask(item)} disabled={!item.owner_user_id || !item.due_date}><Save size={14} /> Transformar em tarefa</Button>{item.kind === "definicao" || item.kind === "topico" ? <><input value={decisionDrafts[item.id] ?? item.decision_text ?? ""} onChange={(event) => setDecisionDrafts({ ...decisionDrafts, [item.id]: event.target.value })} placeholder="Definição tomada na reunião" /><Button variant="secondary" onClick={() => void recordDecision(item)}><Check size={14} /> Registrar definição</Button></> : null}</div> : null}</div></div>) : <div className="mini-empty">Nenhum tópico neste bloco.</div>}</div></article>; })}{!selectedSections.length ? <EmptyState icon={<ClipboardList size={22} />} title="Pauta vazia" description="Adicione blocos como projetos, entregas ou assuntos gerais." /> : null}</div></section>
          </>}

          <section className="content-card ra-decision-catalog"><div className="content-card-head"><div><h2>Catálogo de definições</h2><p>Decisões formalizadas nas reuniões RA</p></div><StatusPill tone={selectedDecisions.length ? "info" : "neutral"}>{selectedDecisions.length} registro(s)</StatusPill></div>{selectedDecisions.length ? <div>{selectedDecisions.map((decision) => <article key={decision.id}><Check size={16} /><span><strong>{decision.title}</strong><p>{decision.decision_text}</p><small>{dateBr(decision.decided_at)}</small></span></article>)}</div> : <div className="mini-empty">Nenhuma definição registrada nesta RA.</div>}</section>
        </> : <EmptyState icon={<ClipboardList size={22} />} title="Selecione uma RA" description="Escolha uma reunião para preparar ou consultar a pauta." />}
      </main>
    </div>}

    <Dialog open={meetingDialog} onClose={() => setMeetingDialog(false)} title="Nova reunião RA" description="Defina participantes e projetos que entrarão na pauta." wide><form className="form-grid" onSubmit={createMeeting}><Field label="Título"><input value={meetingForm.title} onChange={(event) => setMeetingForm({ ...meetingForm, title: event.target.value })} required maxLength={180} /></Field><Field label="Data e horário"><input type="datetime-local" value={meetingForm.scheduled_at} onChange={(event) => setMeetingForm({ ...meetingForm, scheduled_at: event.target.value })} required /></Field><fieldset className="department-access-fieldset form-span-2"><legend>Participantes</legend><div className="ra-choice-grid">{users.filter((user) => user.user_id !== currentUserId).map((user) => <label key={user.user_id} className={meetingForm.participant_ids.includes(user.user_id) ? "selected" : ""}><input type="checkbox" checked={meetingForm.participant_ids.includes(user.user_id)} onChange={() => toggleMeetingChoice("participant_ids", user.user_id)} /><span>{user.full_name || user.email}</span></label>)}</div></fieldset><fieldset className="department-access-fieldset form-span-2"><legend>Projetos ativos para discussão</legend><div className="ra-choice-grid">{projects.map((project) => <label key={project.id} className={meetingForm.project_ids.includes(project.id) ? "selected" : ""}><input type="checkbox" checked={meetingForm.project_ids.includes(project.id)} onChange={() => toggleMeetingChoice("project_ids", project.id)} /><span>{project.name}</span></label>)}</div></fieldset><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setMeetingDialog(false)}>Cancelar</Button><Button type="submit" loading={saving}>Criar pauta</Button></div></form></Dialog>
    <Dialog open={sectionDialog} onClose={() => setSectionDialog(false)} title="Novo bloco da pauta" description="Crie um assunto geral ou vincule o bloco a um projeto."><form className="form-grid" onSubmit={addSection}><Field label="Título"><input value={sectionForm.title} onChange={(event) => setSectionForm({ ...sectionForm, title: event.target.value })} required /></Field><Field label="Projeto" hint="Opcional"><select value={sectionForm.project_id} onChange={(event) => setSectionForm({ ...sectionForm, project_id: event.target.value })}><option value="">Assunto geral</option>{selectedProjectIds.map((id) => <option key={id} value={id}>{projectName(id)}</option>)}</select></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setSectionDialog(false)}>Cancelar</Button><Button type="submit" loading={saving}>Adicionar bloco</Button></div></form></Dialog>
    <Dialog open={itemDialog} onClose={() => setItemDialog(false)} title="Adicionar tópico" description="O responsável e o prazo permitirão transformar o item em tarefa."><form className="form-grid" onSubmit={addItem}><Field label="Tópico" className="form-span-2"><textarea value={itemForm.content} onChange={(event) => setItemForm({ ...itemForm, content: event.target.value })} required maxLength={2000} /></Field><Field label="Tipo"><select value={itemForm.kind} onChange={(event) => setItemForm({ ...itemForm, kind: event.target.value as RaItemKind })}><option value="topico">Tópico para discussão</option><option value="acao">Ação a executar</option><option value="definicao">Item a definir</option></select></Field><Field label="Responsável" hint="Opcional"><select value={itemForm.owner_user_id} onChange={(event) => setItemForm({ ...itemForm, owner_user_id: event.target.value })}><option value="">A definir</option>{selectedParticipants.map((participant) => <option key={participant.user_id} value={participant.user_id}>{userName(participant.user_id)}</option>)}</select></Field><Field label="Prazo" hint="Opcional"><input type="date" min={todayIso()} value={itemForm.due_date} onChange={(event) => setItemForm({ ...itemForm, due_date: event.target.value })} /></Field><Field label="Projeto" hint="Opcional; vazio cria tarefa avulsa"><select value={itemForm.project_id} onChange={(event) => setItemForm({ ...itemForm, project_id: event.target.value })}><option value="">Tarefa avulsa</option>{selectedProjectIds.map((id) => <option key={id} value={id}>{projectName(id)}</option>)}</select></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setItemDialog(false)}>Cancelar</Button><Button type="submit" loading={saving}>Adicionar tópico</Button></div></form></Dialog>
    {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
  </>;
}
