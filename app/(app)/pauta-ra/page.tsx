"use client";

import { Button, Dialog, EmptyState, Field, PageIntro, StatusPill, Toast } from "@/components/ui";
import { dateBr, todayIso } from "@/lib/format";
import { parseInitialAgendaTopics } from "@/lib/ra";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { Project, ProjectTask, RaAgendaItem, RaAgendaSection, RaDecision, RaItemKind, RaMeeting, RaMeetingProject, RaParticipant, UserProfile } from "@/lib/types";
import { Archive, ArchiveRestore, ArrowRight, CalendarDays, Check, ClipboardList, FileText, FolderKanban, ListPlus, Mail, Pencil, Play, Plus, Save, Trash2, Users } from "lucide-react";
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
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [meetingDialog, setMeetingDialog] = useState(false);
  const [sectionDialog, setSectionDialog] = useState(false);
  const [itemDialog, setItemDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<RaAgendaItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<RaAgendaItem | null>(null);
  const [taskItem, setTaskItem] = useState<RaAgendaItem | null>(null);
  const [meetingAction, setMeetingAction] = useState<{ kind: "archive" | "delete"; meeting: RaMeeting } | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [decisionDrafts, setDecisionDrafts] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [meetingForm, setMeetingForm] = useState({ title: "RA semanal", scheduled_at: defaultMeetingDate(), participant_ids: [] as string[], project_ids: [] as string[], initial_topics: "" });
  const [sectionForm, setSectionForm] = useState({ title: "", project_id: "" });
  const [itemForm, setItemForm] = useState({ content: "", kind: "topico" as RaItemKind, owner_user_id: "", due_date: "", project_id: "" });
  const [itemEditContent, setItemEditContent] = useState("");
  const [taskForm, setTaskForm] = useState({ owner_user_id: "", due_date: "", project_id: "" });

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data: auth } = await supabase.auth.getUser();
    const meetingQuery = showArchived
      ? supabase.from("ra_meetings").select("*").not("archived_at", "is", null).order("scheduled_at", { ascending: false })
      : supabase.from("ra_meetings").select("*").is("archived_at", null).order("scheduled_at", { ascending: false });
    const [meetingResult, participantResult, selectedProjectResult, sectionResult, itemResult, decisionResult, projectResult, taskResult, userResult, manageResult] = await Promise.all([
      meetingQuery,
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
  }, [showArchived, supabase]);

  useEffect(() => { const timer = window.setTimeout(() => void loadData(), 0); return () => window.clearTimeout(timer); }, [loadData]);

  const selected = meetings.find((meeting) => meeting.id === selectedId) || null;
  const canManageSelected = Boolean(selected && canManage && (selected.leader_user_id === currentUserId || users.find((user) => user.user_id === currentUserId)?.is_admin));
  const canOperateSelected = Boolean(canManageSelected && !selected?.archived_at);
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
    const initialTopics = parseInitialAgendaTopics(meetingForm.initial_topics);
    if (initialTopics.length > 50) return setToast({ message: "Informe no máximo 50 tópicos iniciais.", type: "error" });
    if (initialTopics.some((topic) => topic.length < 2)) return setToast({ message: "Cada tópico inicial deve ter pelo menos 2 caracteres.", type: "error" });
    if (initialTopics.some((topic) => topic.length > 2000)) return setToast({ message: "Cada tópico inicial deve ter no máximo 2.000 caracteres.", type: "error" });
    setSaving(true);
    const result = await supabase.from("ra_meetings").insert({ title: meetingForm.title.trim(), scheduled_at: new Date(meetingForm.scheduled_at).toISOString(), leader_user_id: currentUserId }).select("id").single();
    if (result.error || !result.data) { setSaving(false); return setToast({ message: friendlyError(result.error), type: "error" }); }
    const meetingId = result.data.id;
    const participantIds = [...new Set([currentUserId, ...meetingForm.participant_ids])];
    const sectionRows = [
      ...(initialTopics.length ? [{ meeting_id: meetingId, project_id: null, title: "Assuntos gerais", position: 0 }] : []),
      ...meetingForm.project_ids.map((project_id, position) => ({ meeting_id: meetingId, project_id, title: projectName(project_id), position: position + (initialTopics.length ? 1 : 0) })),
    ];
    const [participantResult, projectResult, sectionResult] = await Promise.all([
      supabase.from("ra_participants").insert(participantIds.map((user_id) => ({ meeting_id: meetingId, user_id }))),
      meetingForm.project_ids.length ? supabase.from("ra_meeting_projects").insert(meetingForm.project_ids.map((project_id) => ({ meeting_id: meetingId, project_id }))) : Promise.resolve({ error: null }),
      sectionRows.length ? supabase.from("ra_agenda_sections").insert(sectionRows).select("id,project_id,position") : Promise.resolve({ data: [], error: null }),
    ]);
    const writeError = participantResult.error || projectResult.error || sectionResult.error;
    if (writeError) {
      await supabase.from("ra_meetings").delete().eq("id", meetingId);
      setSaving(false);
      return setToast({ message: `Não foi possível criar a pauta: ${friendlyError(writeError)}`, type: "error" });
    }
    if (initialTopics.length) {
      const generalSection = sectionResult.data?.find((section) => section.project_id === null);
      const topicResult = generalSection
        ? await supabase.from("ra_agenda_items").insert(initialTopics.map((content, position) => ({ section_id: generalSection.id, content, kind: "topico", position })))
        : { error: new Error("Bloco de assuntos gerais não encontrado.") };
      if (topicResult.error) {
        await supabase.from("ra_meetings").delete().eq("id", meetingId);
        setSaving(false);
        return setToast({ message: `Não foi possível salvar os tópicos iniciais: ${friendlyError(topicResult.error)}`, type: "error" });
      }
    }
    setSaving(false);
    setMeetingDialog(false);
    setMeetingForm({ title: "RA semanal", scheduled_at: defaultMeetingDate(), participant_ids: [], project_ids: [], initial_topics: "" });
    setSelectedId(meetingId);
    setToast({ message: "Pauta criada para preparação.", type: "success" });
    await loadData();
  }

  async function addSection(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !selected || !canOperateSelected) return;
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
    if (!supabase || !selectedSectionId || !canOperateSelected) return;
    const sectionItems = items.filter((item) => item.section_id === selectedSectionId);
    setSaving(true);
    const { error } = await supabase.from("ra_agenda_items").insert({ section_id: selectedSectionId, content: itemForm.content.trim(), kind: itemForm.kind, owner_user_id: itemForm.owner_user_id || null, due_date: itemForm.due_date || null, project_id: itemForm.project_id || null, position: sectionItems.length });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setItemDialog(false); await loadData();
  }

  function openItemEditor(item: RaAgendaItem) {
    setEditingItem(item);
    setItemEditContent(item.content);
  }

  async function updateItem(event: FormEvent) {
    event.preventDefault();
    const content = itemEditContent.trim();
    if (!supabase || !editingItem || !canOperateSelected || content.length < 2) return;
    setSaving(true);
    const { error } = await supabase.from("ra_agenda_items").update({ content }).eq("id", editingItem.id);
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setEditingItem(null);
    setToast({ message: "Assunto atualizado.", type: "success" });
    await loadData();
  }

  async function deleteItem() {
    if (!supabase || !deletingItem || !canOperateSelected) return;
    setSaving(true);
    const { error } = await supabase.from("ra_agenda_items").delete().eq("id", deletingItem.id);
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setDeletingItem(null);
    setToast({ message: "Assunto excluído da pauta.", type: "success" });
    await loadData();
  }

  function openTaskDialog(item: RaAgendaItem) {
    setTaskItem(item);
    setTaskForm({ owner_user_id: item.owner_user_id || "", due_date: item.due_date || "", project_id: item.project_id || "" });
  }

  async function performTaskConversion(item: RaAgendaItem, ownerUserId: string, dueDate: string, projectId: string) {
    if (!supabase) return;
    setSaving(true);
    const { error } = await supabase.rpc("convert_ra_item_to_task", { p_item_id: item.id, p_assignee_user_id: ownerUserId, p_due_date: dueDate, p_project_id: projectId || null });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setTaskItem(null);
    setToast({ message: `Tarefa criada para ${userName(ownerUserId)}.`, type: "success" }); await loadData();
  }

  async function convertToTask(item: RaAgendaItem) {
    if (!item.owner_user_id || !item.due_date) return openTaskDialog(item);
    await performTaskConversion(item, item.owner_user_id, item.due_date, item.project_id || "");
  }

  async function submitTaskConversion(event: FormEvent) {
    event.preventDefault();
    if (!taskItem || !taskForm.owner_user_id || !taskForm.due_date) return setToast({ message: "Selecione o responsável e o prazo da tarefa.", type: "error" });
    await performTaskConversion(taskItem, taskForm.owner_user_id, taskForm.due_date, taskForm.project_id);
  }

  async function recordDecision(item: RaAgendaItem) {
    if (!supabase) return;
    const text = (decisionDrafts[item.id] || "").trim();
    if (!text) return setToast({ message: "Registre a definição tomada na reunião.", type: "error" });
    setSaving(true);
    const { error } = await supabase.rpc("record_ra_decision", { p_item_id: item.id, p_decision_text: text });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setDecisionDrafts((current) => ({ ...current, [item.id]: "" }));
    setToast({ message: "Definição adicionada ao catálogo.", type: "success" }); await loadData();
  }

  async function startMeeting() {
    if (!supabase || !selected) return;
    const { error } = await supabase.from("ra_meetings").update({ status: "em_andamento" }).eq("id", selected.id);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    await loadData();
  }

  async function closeMeeting(resend = false) {
    if (!supabase || !selected) return;
    setSaving(true);
    const { data } = await supabase.auth.getSession();
    const response = await fetch(`/api/ra/${selected.id}/close${resend ? "?resend=true" : ""}`, { method: "POST", headers: { Authorization: `Bearer ${data.session?.access_token || ""}` } });
    const result = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return setToast({ message: result.error || "Não foi possível encerrar a RA.", type: "error" });
    const message = result.emailSent
      ? `${resend ? "ATA reenviada" : "RA encerrada, ATA salva e enviada"} para ${result.recipientCount} destinatário(s).${result.emailWarning ? ` ${result.emailWarning}` : ""}`
      : `${resend ? "A ATA continua salva, mas o reenvio falhou." : "RA encerrada e ATA salva."} ${result.emailWarning || "O e-mail não foi enviado."}`;
    setToast({ message, type: result.emailSent || !resend ? "success" : "error" }); await loadData();
  }

  async function changeMeetingArchive(meeting: RaMeeting, archive: boolean) {
    if (!supabase || !canManageSelected || selected?.id !== meeting.id) return;
    setSaving(true);
    const { data, error } = await supabase.from("ra_meetings").update({ archived_at: archive ? new Date().toISOString() : null, archived_by: archive ? currentUserId : null }).eq("id", meeting.id).select("id").maybeSingle();
    setSaving(false);
    if (error || !data) return setToast({ message: error ? friendlyError(error) : "Você não tem permissão para alterar esta RA.", type: "error" });
    setMeetingAction(null);
    setSelectedId("");
    setToast({ message: archive ? "RA arquivada com todo o histórico." : "RA restaurada.", type: "success" });
    await loadData();
  }

  async function deleteMeeting(meeting: RaMeeting) {
    if (!supabase || !canManageSelected || selected?.id !== meeting.id) return;
    setSaving(true);
    const { error } = await supabase.from("ra_meetings").delete().eq("id", meeting.id).select("id").single();
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setMeetingAction(null);
    setSelectedId("");
    setToast({ message: "RA excluída definitivamente. Tarefas já criadas foram preservadas.", type: "success" });
    await loadData();
  }

  return <>
    <PageIntro eyebrow="Departamento · Pauta e RA" title="Reuniões de alinhamento" description="Prepare a pauta, registre definições e transforme combinados em tarefas." action={canManage ? <Button onClick={() => setMeetingDialog(true)}><Plus size={17} /> Nova RA</Button> : undefined} />
    {loading ? <div className="list-loading">Carregando reuniões…</div> : <div className="ra-layout">
      <aside className="content-card ra-meeting-list"><div className="content-card-head"><div><h2>{showArchived ? "RAs arquivadas" : "Reuniões"}</h2><p>{meetings.length} RA(s) {showArchived ? "arquivada(s)" : "visível(is)"}</p></div><Button variant="ghost" onClick={() => setShowArchived((current) => !current)}>{showArchived ? <ClipboardList size={15} /> : <Archive size={15} />}{showArchived ? " Ver ativas" : " Ver arquivadas"}</Button></div>{meetings.length ? meetings.map((meeting) => <button type="button" key={meeting.id} className={selectedId === meeting.id ? "active" : ""} onClick={() => setSelectedId(meeting.id)}><CalendarDays size={17} /><span><strong>{meeting.title}</strong><small>{dateBr(meeting.scheduled_at)} · {userName(meeting.leader_user_id)}</small></span><StatusPill tone={meeting.archived_at ? "neutral" : meeting.status === "encerrada" ? "success" : meeting.status === "em_andamento" ? "warning" : "neutral"}>{meeting.archived_at ? "Arquivada" : statusLabel[meeting.status]}</StatusPill></button>) : <EmptyState icon={showArchived ? <Archive size={22} /> : <ClipboardList size={22} />} title={showArchived ? "Nenhuma RA arquivada" : "Nenhuma RA"} description={showArchived ? "As reuniões arquivadas aparecerão aqui." : "As reuniões em que você participa aparecerão aqui."} />}</aside>
      <main className="ra-main">
        {selected ? <>
          <section className="content-card ra-header"><div><span className="eyebrow">{selected.archived_at ? `Arquivada · ${statusLabel[selected.status]}` : statusLabel[selected.status]}</span><h2>{selected.title}</h2><p>{dateBr(selected.scheduled_at)} · Líder: {userName(selected.leader_user_id)}</p><div className="ra-participant-chips">{selectedParticipants.map((participant) => <span key={participant.user_id}><Users size={12} /> {userName(participant.user_id)}</span>)}</div></div>{canManageSelected ? <div className="page-action-group">{canOperateSelected && selected.status !== "encerrada" ? <>{selected.status === "rascunho" ? <Button variant="secondary" onClick={() => void startMeeting()}><Play size={15} /> Iniciar RA</Button> : null}<Button onClick={() => void closeMeeting()} loading={saving}><Mail size={15} /> Encerrar e enviar ATA</Button></> : null}{selected.archived_at ? <Button variant="secondary" onClick={() => void changeMeetingArchive(selected, false)} loading={saving}><ArchiveRestore size={15} /> Restaurar</Button> : <Button variant="secondary" onClick={() => setMeetingAction({ kind: "archive", meeting: selected })}><Archive size={15} /> Arquivar</Button>}<Button variant="danger" onClick={() => setMeetingAction({ kind: "delete", meeting: selected })}><Trash2 size={15} /> Excluir</Button></div> : null}</section>

          {selected.status === "encerrada" ? <section className="content-card ra-minutes"><div className="content-card-head"><div><h2><FileText size={18} /> ATA da reunião</h2><p>Registro final da reunião</p></div>{canOperateSelected ? <Button variant="secondary" onClick={() => void closeMeeting(true)} loading={saving}><Mail size={15} /> Reenviar ATA</Button> : null}</div><pre>{selected.minutes_text}</pre></section> : <>
            {selectedProjectIds.length ? <section className="content-card ra-project-snapshot"><div className="content-card-head"><div><h2>Projetos para discussão</h2><p>Tarefas abertas e vencidas dos projetos selecionados</p></div></div><div>{selectedProjectIds.map((projectId) => { const tasks = openProjectTasks.filter((task) => task.project_id === projectId); const overdue = tasks.filter((task) => task.due_date < todayIso()); return <article key={projectId}><div><FolderKanban size={17} /><span><strong>{projectName(projectId)}</strong><small>{overdue.length} atrasada(s) · {tasks.length} aberta(s)</small></span></div>{tasks.length ? <ul>{tasks.slice(0, 8).map((task) => <li key={task.id} className={task.due_date < todayIso() ? "danger" : ""}><span>{task.title}</span><small>{task.assignee_name} · {dateBr(task.due_date)}</small></li>)}</ul> : <p>Nenhuma tarefa aberta.</p>}</article>; })}</div></section> : null}

            <section className="content-card ra-agenda">
              <div className="content-card-head">
                <div><h2>Pauta da RA</h2><p>{selected.archived_at ? "Histórico preservado em modo somente leitura" : "Tópicos, ações e itens a definir durante a reunião"}</p></div>
                {canOperateSelected ? <Button variant="secondary" onClick={() => setSectionDialog(true)}><ListPlus size={15} /> Novo bloco</Button> : null}
              </div>
              <div className="ra-section-list">
                {selectedSections.map((section, sectionIndex) => {
                  const sectionItems = items.filter((item) => item.section_id === section.id);
                  return <article key={section.id}>
                    <header>
                      <span>{sectionIndex + 1}</span>
                      <div><strong>{section.title}</strong>{section.project_id ? <small>{projectName(section.project_id)}</small> : null}</div>
                      {canOperateSelected ? <button type="button" onClick={() => openItem(section.id)}><Plus size={15} /> Assunto</button> : null}
                    </header>
                    <div className="ra-item-list">
                      {sectionItems.length ? sectionItems.map((item) => {
                        const itemDecisions = selectedDecisions.filter((decision) => decision.item_id === item.id);
                        return <div key={item.id}>
                          <span className="ra-bullet">•</span>
                          <div>
                            <div className="ra-item-heading">
                              <strong>{item.owner_user_id ? `${userName(item.owner_user_id)}: ` : ""}{item.content}</strong>
                              {canOperateSelected ? <div className="ra-item-actions">
                                <button type="button" onClick={() => openItemEditor(item)}><Pencil size={14} /> Editar</button>
                                <button type="button" className="danger" onClick={() => setDeletingItem(item)}><Trash2 size={14} /> Excluir</button>
                              </div> : null}
                            </div>
                            <small>{kindLabel[item.kind]}{item.due_date ? ` · prazo ${dateBr(item.due_date)}` : ""}{item.project_id ? ` · ${projectName(item.project_id)}` : ""}</small>
                            {itemDecisions.map((decision) => <p key={decision.id}><Check size={13} /> {decision.decision_text}</p>)}
                            {item.task_id ? <p><ArrowRight size={13} /> Tarefa criada no TLU Space</p> : null}
                            {canOperateSelected ? <div className="ra-item-controls">
                              {!item.task_id ? <Button variant="secondary" onClick={() => void convertToTask(item)}><Save size={14} /> Transformar em tarefa</Button> : null}
                              {item.kind === "definicao" || item.kind === "topico" ? <>
                                <input value={decisionDrafts[item.id] ?? ""} onChange={(event) => setDecisionDrafts({ ...decisionDrafts, [item.id]: event.target.value })} placeholder="Nova definição sobre este assunto" />
                                <Button variant="secondary" onClick={() => void recordDecision(item)}><Check size={14} /> Registrar definição</Button>
                              </> : null}
                            </div> : null}
                          </div>
                        </div>;
                      }) : <div className="mini-empty">Nenhum assunto neste bloco.</div>}
                    </div>
                  </article>;
                })}
                {!selectedSections.length ? <EmptyState icon={<ClipboardList size={22} />} title="Pauta vazia" description="Adicione blocos como projetos, entregas ou assuntos gerais." /> : null}
              </div>
            </section>
          </>}

          <section className="content-card ra-decision-catalog"><div className="content-card-head"><div><h2>Catálogo de definições</h2><p>Decisões formalizadas nas reuniões RA</p></div><StatusPill tone={selectedDecisions.length ? "info" : "neutral"}>{selectedDecisions.length} registro(s)</StatusPill></div>{selectedDecisions.length ? <div>{selectedDecisions.map((decision) => <article key={decision.id}><Check size={16} /><span><strong>{decision.title}</strong><p>{decision.decision_text}</p><small>{dateBr(decision.decided_at)}</small></span></article>)}</div> : <div className="mini-empty">Nenhuma definição registrada nesta RA.</div>}</section>
        </> : <EmptyState icon={<ClipboardList size={22} />} title="Selecione uma RA" description="Escolha uma reunião para preparar ou consultar a pauta." />}
      </main>
    </div>}

    <Dialog open={meetingDialog} onClose={() => setMeetingDialog(false)} title="Nova reunião RA" description="Defina participantes, projetos e os tópicos que entrarão na pauta." wide><form className="form-grid" onSubmit={createMeeting}><Field label="Título"><input value={meetingForm.title} onChange={(event) => setMeetingForm({ ...meetingForm, title: event.target.value })} required maxLength={180} /></Field><Field label="Data e horário"><input type="datetime-local" value={meetingForm.scheduled_at} onChange={(event) => setMeetingForm({ ...meetingForm, scheduled_at: event.target.value })} required /></Field><Field label="Tópicos iniciais" hint="Um tópico por linha; bullets são opcionais." className="form-span-2"><textarea value={meetingForm.initial_topics} onChange={(event) => setMeetingForm({ ...meetingForm, initial_topics: event.target.value })} rows={5} maxLength={12000} placeholder={'• Resultados da semana\n• Pendências e próximos passos'} /></Field><fieldset className="department-access-fieldset form-span-2"><legend>Participantes</legend><div className="ra-choice-grid">{users.filter((user) => user.user_id !== currentUserId).map((user) => <label key={user.user_id} className={meetingForm.participant_ids.includes(user.user_id) ? "selected" : ""}><input type="checkbox" checked={meetingForm.participant_ids.includes(user.user_id)} onChange={() => toggleMeetingChoice("participant_ids", user.user_id)} /><span>{user.full_name || user.email}</span></label>)}</div></fieldset><fieldset className="department-access-fieldset form-span-2"><legend>Projetos ativos para discussão</legend><div className="ra-choice-grid">{projects.map((project) => <label key={project.id} className={meetingForm.project_ids.includes(project.id) ? "selected" : ""}><input type="checkbox" checked={meetingForm.project_ids.includes(project.id)} onChange={() => toggleMeetingChoice("project_ids", project.id)} /><span>{project.name}</span></label>)}</div></fieldset><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setMeetingDialog(false)}>Cancelar</Button><Button type="submit" loading={saving}>Criar pauta</Button></div></form></Dialog>
    <Dialog open={sectionDialog} onClose={() => setSectionDialog(false)} title="Novo bloco da pauta" description="Crie um assunto geral ou vincule o bloco a um projeto."><form className="form-grid" onSubmit={addSection}><Field label="Título"><input value={sectionForm.title} onChange={(event) => setSectionForm({ ...sectionForm, title: event.target.value })} required /></Field><Field label="Projeto" hint="Opcional"><select value={sectionForm.project_id} onChange={(event) => setSectionForm({ ...sectionForm, project_id: event.target.value })}><option value="">Assunto geral</option>{selectedProjectIds.map((id) => <option key={id} value={id}>{projectName(id)}</option>)}</select></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setSectionDialog(false)}>Cancelar</Button><Button type="submit" loading={saving}>Adicionar bloco</Button></div></form></Dialog>
    <Dialog open={itemDialog} onClose={() => setItemDialog(false)} title="Adicionar assunto" description="O responsável e o prazo permitirão transformar o item em tarefa."><form className="form-grid" onSubmit={addItem}><Field label="Assunto" className="form-span-2"><textarea value={itemForm.content} onChange={(event) => setItemForm({ ...itemForm, content: event.target.value })} required minLength={2} maxLength={2000} /></Field><Field label="Tipo"><select value={itemForm.kind} onChange={(event) => setItemForm({ ...itemForm, kind: event.target.value as RaItemKind })}><option value="topico">Tópico para discussão</option><option value="acao">Ação a executar</option><option value="definicao">Item a definir</option></select></Field><Field label="Responsável" hint="Opcional"><select value={itemForm.owner_user_id} onChange={(event) => setItemForm({ ...itemForm, owner_user_id: event.target.value })}><option value="">A definir</option>{selectedParticipants.map((participant) => <option key={participant.user_id} value={participant.user_id}>{userName(participant.user_id)}</option>)}</select></Field><Field label="Prazo" hint="Opcional"><input type="date" min={todayIso()} value={itemForm.due_date} onChange={(event) => setItemForm({ ...itemForm, due_date: event.target.value })} /></Field><Field label="Projeto" hint="Opcional; vazio cria tarefa avulsa"><select value={itemForm.project_id} onChange={(event) => setItemForm({ ...itemForm, project_id: event.target.value })}><option value="">Tarefa avulsa</option>{selectedProjectIds.map((id) => <option key={id} value={id}>{projectName(id)}</option>)}</select></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setItemDialog(false)}>Cancelar</Button><Button type="submit" loading={saving}>Adicionar assunto</Button></div></form></Dialog>
    <Dialog open={Boolean(editingItem)} onClose={() => setEditingItem(null)} title="Editar assunto" description="Atualize o texto usado na pauta e no catálogo de novas definições.">
      <form className="form-grid" onSubmit={updateItem}>
        <Field label="Assunto"><textarea value={itemEditContent} onChange={(event) => setItemEditContent(event.target.value)} required minLength={2} maxLength={2000} rows={5} /></Field>
        <div className="form-actions"><Button type="button" variant="secondary" onClick={() => setEditingItem(null)}>Cancelar</Button><Button type="submit" loading={saving}><Save size={15} /> Salvar alterações</Button></div>
      </form>
    </Dialog>
    <Dialog open={Boolean(deletingItem)} onClose={() => setDeletingItem(null)} title="Excluir assunto?" description="O assunto e suas definições serão removidos da pauta. Uma tarefa já criada continuará no TLU Space.">
      <div className="confirmation-content"><strong>{deletingItem?.content}</strong><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setDeletingItem(null)}>Cancelar</Button><Button type="button" variant="danger" loading={saving} onClick={() => void deleteItem()}><Trash2 size={16} /> Excluir assunto</Button></div></div>
    </Dialog>
    <Dialog open={Boolean(taskItem)} onClose={() => setTaskItem(null)} title="Transformar tópico em tarefa" description="Defina o responsável, o prazo e, se necessário, o projeto."><form className="form-grid" onSubmit={submitTaskConversion}><Field label="Responsável"><select value={taskForm.owner_user_id} onChange={(event) => setTaskForm({ ...taskForm, owner_user_id: event.target.value })} required><option value="">Selecione</option>{selectedParticipants.map((participant) => <option key={participant.user_id} value={participant.user_id}>{userName(participant.user_id)}</option>)}</select></Field><Field label="Prazo"><input type="date" min={todayIso()} value={taskForm.due_date} onChange={(event) => setTaskForm({ ...taskForm, due_date: event.target.value })} required /></Field><Field label="Projeto" hint="Opcional; vazio cria tarefa avulsa" className="form-span-2"><select value={taskForm.project_id} onChange={(event) => setTaskForm({ ...taskForm, project_id: event.target.value })}><option value="">Tarefa avulsa</option>{selectedProjectIds.map((id) => <option key={id} value={id}>{projectName(id)}</option>)}</select></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setTaskItem(null)}>Cancelar</Button><Button type="submit" loading={saving}>Criar tarefa</Button></div></form></Dialog>
    <Dialog open={Boolean(meetingAction)} onClose={() => setMeetingAction(null)} title={meetingAction?.kind === "delete" ? "Excluir RA?" : "Arquivar RA?"} description={meetingAction?.kind === "delete" ? "A exclusão é definitiva e remove a pauta, a ATA, as definições e o histórico de envios. Tarefas já criadas permanecem no sistema." : "A RA ficará somente para consulta, preservando a pauta, a ATA e as definições. Ela poderá ser restaurada depois."}>
      <div className="confirmation-content"><strong>{meetingAction?.meeting.title}</strong><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setMeetingAction(null)}>Cancelar</Button>{meetingAction?.kind === "delete" ? <Button type="button" variant="danger" loading={saving} onClick={() => meetingAction && void deleteMeeting(meetingAction.meeting)}><Trash2 size={16} /> Excluir definitivamente</Button> : <Button type="button" loading={saving} onClick={() => meetingAction && void changeMeetingArchive(meetingAction.meeting, true)}><Archive size={16} /> Arquivar RA</Button>}</div></div>
    </Dialog>
    {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
  </>;
}
