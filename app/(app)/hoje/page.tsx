"use client";

import { Button, EmptyState, KpiCard, PageIntro, StatusPill, Toast } from "@/components/ui";
import { DEPARTMENTS } from "@/lib/constants";
import { dateBr, todayIso } from "@/lib/format";
import { PROJECT_TASK_RELATIONS } from "@/lib/project-tasks";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { Construction, DepartmentSlug, ProjectTask, Rental, RentalStatus, TaskStatus, TodayVisibleUser, UserNotification } from "@/lib/types";
import { AlertTriangle, ArrowRight, Bell, Building2, Check, ClipboardCheck, Clock3, Home, ListChecks, ListTodo, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type TaskRow = ProjectTask & { projects?: { name: string; category: "operational" | "governance" } | null };
type TodayTask = ProjectTask & { project_name: string };
type UnifiedAlert = {
  id: string;
  title: string;
  description: string;
  category: "notification" | "task" | "inspection" | "rental";
  tone: "danger" | "warning" | "info";
  href: string;
  actionLabel: string;
  order: number;
  notification?: UserNotification;
};

function daysUntil(value: string | null | undefined) {
  if (!value) return Number.POSITIVE_INFINITY;
  const start = new Date(`${todayIso()}T12:00:00`).getTime();
  const end = new Date(`${value.slice(0, 10)}T12:00:00`).getTime();
  return Math.ceil((end - start) / 86_400_000);
}

function taskWindow(task: TodayTask) {
  const days = daysUntil(task.due_date);
  if (days < 0) return { label: `${Math.abs(days)} dia(s) atrasada`, tone: "danger" as const, order: 0 };
  if (days === 0) return { label: "Vence hoje", tone: "warning" as const, order: 1 };
  if (days <= 7) return { label: `Vence em ${days} dia(s)`, tone: "info" as const, order: 2 };
  return { label: dateBr(task.due_date), tone: "neutral" as const, order: 3 };
}

function taskHref(task: ProjectTask) {
  const base = task.category === "governance" ? "/governanca" : "/projetos";
  return task.project_id ? `${base}/${task.project_id}?tab=tarefas` : `${base}#quadro-tarefas`;
}

function nextAdjustmentDays(rental: Rental) {
  if (!rental.lease_start_date || rental.status !== "alugado") return Number.POSITIVE_INFINITY;
  const start = new Date(`${rental.lease_start_date.slice(0, 10)}T12:00:00`);
  const today = new Date(`${todayIso()}T12:00:00`);
  const next = new Date(today.getFullYear(), start.getMonth(), start.getDate(), 12);
  if (next < today) next.setFullYear(next.getFullYear() + 1);
  return Math.ceil((next.getTime() - today.getTime()) / 86_400_000);
}

const rentalStatusLabel: Record<RentalStatus, string> = {
  alugado: "Alugado",
  desocupado: "Desocupado",
  aguardando_reforma: "Aguardando reforma",
};

export default function TodayPage() {
  const supabase = getSupabase();
  const [tasks, setTasks] = useState<TodayTask[]>([]);
  const [works, setWorks] = useState<Construction[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [visibleUsers, setVisibleUsers] = useState<TodayVisibleUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [authorizedDepartments, setAuthorizedDepartments] = useState<DepartmentSlug[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const loadData = useCallback(async (requestedUserId?: string) => {
    if (!supabase) return;
    setLoading(true);
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setToast({ message: "Sua sessão expirou. Entre novamente.", type: "error" });
      setLoading(false);
      return;
    }
    const ownUserId = authData.user.id;
    const [profileResult, accessResult, visibleUserResult] = await Promise.all([
      supabase.from("profiles").select("full_name,email,is_admin").eq("user_id", ownUserId).single(),
      supabase.from("profile_departments").select("department_slug").eq("user_id", ownUserId),
      supabase.rpc("visible_today_users"),
    ]);
    if (profileResult.error || accessResult.error || visibleUserResult.error) {
      setToast({ message: `Não foi possível carregar suas permissões: ${friendlyError(profileResult.error || accessResult.error || visibleUserResult.error)}`, type: "error" });
      setLoading(false);
      return;
    }
    const departments = profileResult.data?.is_admin
      ? DEPARTMENTS.map((department) => department.slug)
      : (accessResult.data || []).map((item) => item.department_slug as DepartmentSlug);
    const availableUsers = (visibleUserResult.data || []) as TodayVisibleUser[];
    const targetUserId = requestedUserId && availableUsers.some((user) => user.user_id === requestedUserId)
      ? requestedUserId
      : selectedUserId && availableUsers.some((user) => user.user_id === selectedUserId)
        ? selectedUserId
        : ownUserId;
    const hasAccess = (department: DepartmentSlug) => departments.includes(department);
    const hasProjectAccess = hasAccess("projetos") || hasAccess("governanca");
    const emptyResult = Promise.resolve({ data: [], error: null });
    const [taskResult, workResult, rentalResult, notificationResult] = await Promise.all([
      hasProjectAccess ? supabase.from("project_tasks").select(`*,${PROJECT_TASK_RELATIONS},projects(name,category)`).neq("status", "concluida").order("due_date") : emptyResult,
      hasAccess("obras") ? supabase.from("construction_progress_summary").select("*").eq("responsible_user_id", targetUserId).is("archived_at", null).eq("status", "em_andamento") : emptyResult,
      hasAccess("alugueis") ? supabase.from("rentals").select("*").order("lease_end_date") : emptyResult,
      hasProjectAccess ? supabase.from("user_notifications").select("*").eq("recipient_user_id", targetUserId).is("read_at", null).order("created_at", { ascending: false }).limit(30) : emptyResult,
    ]);
    const failure = [taskResult.error, workResult.error, rentalResult.error, notificationResult.error].find(Boolean);
    if (failure) setToast({ message: friendlyError(failure), type: "error" });
    setCurrentUserId(ownUserId);
    setAuthorizedDepartments(departments);
    setVisibleUsers(availableUsers);
    setSelectedUserId(targetUserId);
    setTasks(((taskResult.data || []) as TaskRow[])
      .filter((task) => task.assignees?.some((assignee) => assignee.user_id === targetUserId)
        || task.subtasks?.some((subtask) => subtask.assignees?.some((assignee) => assignee.user_id === targetUserId)))
      .map((task) => ({ ...task, project_name: task.project_id ? task.projects?.name || "Projeto" : "Atividade avulsa" })));
    setWorks((workResult.data || []) as Construction[]);
    setRentals((rentalResult.data || []) as Rental[]);
    setNotifications((notificationResult.data || []) as UserNotification[]);
    setLoading(false);
  }, [selectedUserId, supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const selectedUser = visibleUsers.find((user) => user.user_id === selectedUserId);
  const hasProjectAccess = authorizedDepartments.includes("projetos") || authorizedDepartments.includes("governanca");
  const sortedTasks = useMemo(() => [...tasks].sort((a, b) => taskWindow(a).order - taskWindow(b).order || a.due_date.localeCompare(b.due_date)), [tasks]);
  const todoTasks = useMemo(() => tasks.filter((task) => task.status === "a_fazer"), [tasks]);
  const progressTasks = useMemo(() => tasks.filter((task) => task.status === "em_andamento"), [tasks]);
  const overdueTasks = useMemo(() => tasks.filter((task) => daysUntil(task.due_date) < 0), [tasks]);
  const dueSoonTasks = useMemo(() => tasks.filter((task) => daysUntil(task.due_date) >= 0 && daysUntil(task.due_date) <= 7), [tasks]);
  const inspectionAlerts = useMemo(() => works.filter((work) => daysUntil(work.next_inspection_at) <= 3), [works]);
  const rentalAlerts = useMemo(() => rentals.flatMap((rental) => {
    const alerts: Array<{ id: string; rental: Rental; message: string; danger: boolean }> = [];
    const contractDays = daysUntil(rental.lease_end_date);
    const adjustmentDays = nextAdjustmentDays(rental);
    if (rental.status === "aguardando_reforma") alerts.push({ id: `${rental.id}-reforma`, rental, message: "Imóvel aguardando reforma", danger: true });
    if (rental.status === "alugado" && contractDays < 0) alerts.push({ id: `${rental.id}-contrato`, rental, message: `Contrato vencido há ${Math.abs(contractDays)} dia(s)`, danger: true });
    else if (rental.status === "alugado" && contractDays <= 60) alerts.push({ id: `${rental.id}-renovacao`, rental, message: `Renovação/contrato vence em ${contractDays} dia(s)`, danger: contractDays <= 15 });
    if (adjustmentDays <= 45) alerts.push({ id: `${rental.id}-reajuste`, rental, message: `Reajuste anual em ${adjustmentDays} dia(s)`, danger: adjustmentDays <= 7 });
    return alerts;
  }), [rentals]);
  const unifiedAlerts = useMemo<UnifiedAlert[]>(() => [
    ...overdueTasks.map((task) => ({
      id: `overdue-${task.id}`,
      title: task.title,
      description: `${task.project_name} · atraso de ${Math.abs(daysUntil(task.due_date))} dia(s)`,
      category: "task" as const,
      tone: "danger" as const,
      href: taskHref(task),
      actionLabel: "Resolver",
      order: daysUntil(task.due_date),
    })),
    ...inspectionAlerts.map((work) => {
      const days = daysUntil(work.next_inspection_at);
      return {
        id: `inspection-${work.id}`,
        title: work.name,
        description: `${days < 0 ? `Vistoria atrasada há ${Math.abs(days)} dia(s)` : days === 0 ? "Vistoria vence hoje" : `Vistoria vence em ${days} dia(s)`} · ciclo de ${work.inspection_interval_days} dia(s)`,
        category: "inspection" as const,
        tone: days <= 0 ? "danger" as const : "warning" as const,
        href: `/obras/${work.id}?tab=atualizacoes`,
        actionLabel: "Abrir",
        order: days <= 0 ? 100 + days : 300 + days,
      };
    }),
    ...rentalAlerts.map((alert) => ({
      id: alert.id,
      title: alert.rental.name,
      description: `${alert.message} · ${rentalStatusLabel[alert.rental.status]}`,
      category: "rental" as const,
      tone: alert.danger ? "danger" as const : "warning" as const,
      href: `/alugueis/${alert.rental.id}`,
      actionLabel: "Revisar",
      order: alert.danger ? 200 : 400,
    })),
    ...notifications.map((notification) => ({
      id: `notification-${notification.id}`,
      title: notification.title,
      description: `${notification.message} · ${dateBr(notification.created_at)}`,
      category: "notification" as const,
      tone: "info" as const,
      href: tasks.find((task) => task.id === notification.entity_id) ? taskHref(tasks.find((task) => task.id === notification.entity_id)!) : "/projetos#quadro-tarefas",
      actionLabel: "Abrir",
      order: 500,
      notification,
    })),
  ].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)), [inspectionAlerts, notifications, overdueTasks, rentalAlerts, tasks]);

  async function updateTask(task: TodayTask, status: TaskStatus) {
    if (!supabase) return;
    setSaving(true);
    const { error } = await supabase.from("project_tasks").update({ status }).eq("id", task.id);
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setToast({ message: "Tarefa concluída.", type: "success" });
    await loadData(selectedUserId);
    window.dispatchEvent(new Event("today-alert-count-changed"));
  }

  async function markNotificationRead(notification: UserNotification) {
    if (!supabase || notification.recipient_user_id !== currentUserId) return;
    const { error } = await supabase.from("user_notifications").update({ read_at: new Date().toISOString() }).eq("id", notification.id);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setNotifications((current) => current.filter((item) => item.id !== notification.id));
    window.dispatchEvent(new Event("today-alert-count-changed"));
  }

  return (
    <>
      <PageIntro
        eyebrow="Centro operacional"
        title="Hoje"
        description={`Tarefas e alertas de ${selectedUser?.full_name || selectedUser?.email || "seu usuário"}.`}
        action={<div className="page-action-group">{visibleUsers.length > 1 ? <select value={selectedUserId} onChange={(event) => void loadData(event.target.value)} aria-label="Selecionar visão do usuário">{visibleUsers.map((user) => <option key={user.user_id} value={user.user_id}>{user.is_self ? "Minha visão" : user.full_name || user.email}</option>)}</select> : null}<Button variant="secondary" onClick={() => void loadData(selectedUserId)} disabled={loading}><RefreshCw size={17} /> Atualizar</Button></div>}
      />

      {hasProjectAccess ? <section className="kpi-grid today-kpis">
        <KpiCard label="A fazer" value={String(todoTasks.length)} helper="tarefas ainda não iniciadas" icon={<ListTodo size={17} />} />
        <KpiCard label="Em andamento" value={String(progressTasks.length)} helper="tarefas em execução" icon={<ListChecks size={17} />} />
        <KpiCard label="Atrasadas" value={String(overdueTasks.length)} helper={overdueTasks.length ? "exigem atenção" : "nenhuma pendência"} tone={overdueTasks.length ? "warning" : "success"} icon={<AlertTriangle size={17} />} />
        <KpiCard label="Próximos 7 dias" value={String(dueSoonTasks.length)} helper="incluindo vencimentos de hoje" icon={<Clock3 size={17} />} />
      </section> : null}

      {loading ? <div className="list-loading today-loading">Carregando tarefas e alertas…</div> : <div className="today-layout">
        {hasProjectAccess ? <section className="content-card today-primary-card">
          <div className="content-card-head"><div><h2>Visão geral das tarefas</h2><p>A fazer, em andamento, prazos e responsáveis</p></div><StatusPill tone={overdueTasks.length ? "danger" : "success"}>{tasks.length} abertas</StatusPill></div>
          {sortedTasks.length ? <div className="today-action-list">{sortedTasks.map((task) => { const window = taskWindow(task); const assignees = task.assignees?.map((assignee) => assignee.assignee_name).join(", ") || task.assignee_name; return <article key={task.id}><span className={`exception-mark exception-${window.tone}`}><Clock3 size={16} /></span><div className="today-item-main"><div><StatusPill tone={window.tone}>{window.label}</StatusPill><small>{task.project_name}</small></div><strong>{task.title}</strong><span>{task.status === "em_andamento" ? "Em andamento" : "A fazer"} · {assignees}</span></div><div className="today-item-actions">{selectedUserId === currentUserId ? <Button variant="secondary" onClick={() => void updateTask(task, "concluida")} disabled={saving}><Check size={15} /> Concluir</Button> : null}<Link className="button button-primary" href={taskHref(task)}>Abrir</Link></div></article>; })}</div> : <EmptyState icon={<Check size={22} />} title="Nenhuma atividade aberta" description="Não há atividades a fazer ou em andamento nesta visão." />}
        </section> : null}

        {authorizedDepartments.some((department) => ["projetos", "governanca", "obras", "alugueis"].includes(department)) ? <section className="content-card today-primary-card">
          <div className="content-card-head"><div><h2>Alertas</h2><p>Tarefas, vistorias e imóveis que precisam de atenção</p></div><StatusPill tone={unifiedAlerts.length ? "danger" : "success"}>{unifiedAlerts.length} pendente(s)</StatusPill></div>
          {unifiedAlerts.length ? <div className="today-compact-list today-alert-list">{unifiedAlerts.map((alert) => <article key={alert.id}>
            <span className={`exception-mark exception-${alert.tone}`}>
              {alert.category === "notification" ? <Bell size={15} /> : alert.category === "task" ? <AlertTriangle size={15} /> : alert.category === "inspection" ? <ClipboardCheck size={15} /> : <Home size={15} />}
            </span>
            <div><strong>{alert.title}</strong><span>{alert.description}</span></div>
            <div className="today-compact-actions">
              {alert.notification?.recipient_user_id === currentUserId ? <Button variant="ghost" onClick={() => void markNotificationRead(alert.notification!)}>Marcar como lido</Button> : null}
              <Link href={alert.href}>{alert.actionLabel} <ArrowRight size={14} /></Link>
            </div>
          </article>)}</div> : <div className="mini-empty">Nenhum alerta exige atenção agora.</div>}
        </section> : null}

        {!authorizedDepartments.some((department) => ["projetos", "governanca", "obras", "alugueis"].includes(department)) ? <EmptyState icon={<Building2 size={22} />} title="Sem áreas operacionais" description="Solicite acesso a Projetos, Governança, Obras ou Aluguéis para visualizar atividades e alertas." /> : null}
      </div>}
      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}
