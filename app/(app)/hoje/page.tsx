"use client";

import { Button, EmptyState, KpiCard, PageIntro, StatusPill, Toast } from "@/components/ui";
import { TodayIdeaButton } from "@/components/today-idea-button";
import { dateBr, todayIso } from "@/lib/format";
import { createRefreshScheduler } from "@/lib/refresh-scheduler";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { DepartmentSlug, ProjectTask, TaskStatus, TodayVisibleUser } from "@/lib/types";
import { AlertTriangle, ArrowRight, Bell, Building2, Check, ClipboardCheck, Clock3, Home, ListChecks, ListTodo, RefreshCw, Undo2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TodayTask = Pick<ProjectTask, "id" | "project_id" | "category" | "title" | "due_date" | "status" | "assignee_name"> & {
  project_name: string;
  assignees: Array<{ assignee_name: string }>;
};
type TodayDashboard = {
  current_user_id: string;
  selected_user_id: string;
  users: TodayVisibleUser[];
  departments: DepartmentSlug[];
  tasks: TodayTask[];
  alerts: UnifiedAlert[];
};
type UnifiedAlert = {
  id: string;
  title: string;
  description: string;
  category: "notification" | "task" | "inspection" | "rental";
  tone: "danger" | "warning" | "info";
  href: string;
  occurrence_key: string;
  sort_order: number;
  resolved_at: string | null;
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

function taskHref(task: Pick<ProjectTask, "category" | "project_id">) {
  const base = task.category === "governance" ? "/governanca" : "/projetos";
  return task.project_id ? `${base}/${task.project_id}?tab=tarefas` : `${base}#quadro-tarefas`;
}

export default function TodayPage() {
  const supabase = getSupabase();
  const [tasks, setTasks] = useState<TodayTask[]>([]);
  const [alerts, setAlerts] = useState<UnifiedAlert[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [savingAlertId, setSavingAlertId] = useState<string | null>(null);
  const [visibleUsers, setVisibleUsers] = useState<TodayVisibleUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const selectedUserRef = useRef("");
  const loadVersion = useRef(0);
  const [currentUserId, setCurrentUserId] = useState("");
  const [authorizedDepartments, setAuthorizedDepartments] = useState<DepartmentSlug[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const loadData = useCallback(async (requestedUserId?: string) => {
    if (!supabase) return;
    const version = ++loadVersion.current;
    setLoading(true);
    setAuthorizedDepartments([]);
    setTasks([]);
    setAlerts([]);
    try {
      const { data, error } = await supabase.rpc("today_dashboard", {
        p_user_id: requestedUserId || selectedUserRef.current || null,
      });
      if (version !== loadVersion.current) return;
      if (error) throw error;
      if (!data) throw new Error("Não foi possível carregar suas tarefas e permissões.");
      const dashboard = data as TodayDashboard;
      if (selectedUserRef.current !== dashboard.selected_user_id) setShowResolved(false);
      selectedUserRef.current = dashboard.selected_user_id;
      setSelectedUserId(dashboard.selected_user_id);
      setCurrentUserId(dashboard.current_user_id);
      setAuthorizedDepartments(dashboard.departments);
      setVisibleUsers(dashboard.users);
      setTasks(dashboard.tasks);
      setAlerts(dashboard.alerts);
    } catch (error) {
      if (version === loadVersion.current) setToast({ message: friendlyError(error), type: "error" });
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    const scheduler = createRefreshScheduler(() => loadData());
    const refresh = scheduler.schedule;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(timer);
      scheduler.dispose();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      loadVersion.current += 1;
    };
  }, [loadData]);

  const selectedUser = visibleUsers.find((user) => user.user_id === selectedUserId);
  const hasProjectAccess = authorizedDepartments.includes("projetos") || authorizedDepartments.includes("governanca");
  const sortedTasks = useMemo(() => [...tasks].sort((a, b) => taskWindow(a).order - taskWindow(b).order || a.due_date.localeCompare(b.due_date)), [tasks]);
  const todoTasks = useMemo(() => tasks.filter((task) => task.status === "a_fazer"), [tasks]);
  const progressTasks = useMemo(() => tasks.filter((task) => task.status === "em_andamento"), [tasks]);
  const overdueTasks = useMemo(() => tasks.filter((task) => daysUntil(task.due_date) < 0), [tasks]);
  const dueSoonTasks = useMemo(() => tasks.filter((task) => daysUntil(task.due_date) >= 0 && daysUntil(task.due_date) <= 7), [tasks]);
  const pendingAlerts = useMemo(() => alerts.filter((alert) => !alert.resolved_at), [alerts]);
  const resolvedAlerts = useMemo(() => alerts.filter((alert) => alert.resolved_at), [alerts]);
  const unifiedAlerts = showResolved ? resolvedAlerts : pendingAlerts;

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

  async function setAlertResolved(alert: UnifiedAlert, resolved: boolean) {
    if (!supabase || selectedUserId !== currentUserId || savingAlertId) return;
    const userId = selectedUserId;
    const version = loadVersion.current;
    setSavingAlertId(alert.id);
    try {
      const { data, error } = await supabase.rpc(resolved ? "resolve_today_alert" : "reopen_today_alert", {
        p_alert_id: alert.id,
        p_occurrence_key: alert.occurrence_key,
      });
      if (error) throw error;
      if (selectedUserRef.current === userId && loadVersion.current === version) {
        setAlerts((current) => current.map((item) => item.id === alert.id && item.occurrence_key === alert.occurrence_key
          ? { ...item, resolved_at: resolved ? data as string : null } : item));
        setToast({ message: resolved ? "Alerta resolvido." : "Alerta reaberto.", type: "success" });
      } else if (selectedUserRef.current === userId) {
        await loadData(userId);
      }
      window.dispatchEvent(new Event("today-alert-count-changed"));
    } catch (error) {
      setToast({ message: friendlyError(error), type: "error" });
    } finally {
      setSavingAlertId(null);
    }
  }

  return (
    <>
      <PageIntro
        eyebrow="Centro operacional"
        title="Hoje"
        description={`Tarefas e alertas de ${selectedUser?.full_name || selectedUser?.email || "seu usuário"}.`}
        action={<div className="page-action-group">{visibleUsers.length > 1 ? <select value={selectedUserId} onChange={(event) => void loadData(event.target.value)} aria-label="Selecionar visão do usuário">{visibleUsers.map((user) => <option key={user.user_id} value={user.user_id}>{user.is_self ? "Minha visão" : user.full_name || user.email}</option>)}</select> : null}<Button variant="secondary" onClick={() => void loadData(selectedUserId)} disabled={loading}><RefreshCw size={17} /> Atualizar</Button><TodayIdeaButton /></div>}
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
          <div className="content-card-head"><div><h2>{showResolved ? "Alertas resolvidos" : "Alertas"}</h2><p>{showResolved ? "Alertas tratados; você pode reabri-los se precisar." : "Resolver retira o alerta dos pendentes e mantém o item vinculado como está."}</p></div><div className="page-action-group"><StatusPill tone={pendingAlerts.length ? "danger" : "success"}>{pendingAlerts.length} pendente(s)</StatusPill>{resolvedAlerts.length || showResolved ? <Button variant="ghost" onClick={() => setShowResolved((current) => !current)}>{showResolved ? "Ver pendentes" : `Resolvidos (${resolvedAlerts.length})`}</Button> : null}</div></div>
          {unifiedAlerts.length ? <div className="today-compact-list today-alert-list">{unifiedAlerts.map((alert) => <article key={`${alert.id}-${alert.occurrence_key}`}>
            <span className={`exception-mark exception-${alert.resolved_at ? "success" : alert.tone}`}>
              {alert.resolved_at ? <Check size={15} /> : alert.category === "notification" ? <Bell size={15} /> : alert.category === "task" ? <AlertTriangle size={15} /> : alert.category === "inspection" ? <ClipboardCheck size={15} /> : <Home size={15} />}
            </span>
            <div><strong>{alert.title}</strong><span>{alert.description}</span>{alert.resolved_at ? <small>Resolvido em {dateBr(alert.resolved_at)}</small> : null}</div>
            <div className="today-compact-actions">
              {selectedUserId === currentUserId ? <Button variant="secondary" disabled={savingAlertId !== null} aria-label={`${alert.resolved_at ? "Reabrir" : "Resolver"} alerta: ${alert.title}`} onClick={() => void setAlertResolved(alert, !alert.resolved_at)}>{alert.resolved_at ? <Undo2 size={14} /> : <Check size={14} />}{savingAlertId === alert.id ? "Salvando…" : alert.resolved_at ? "Reabrir" : "Resolver"}</Button> : null}
              <Link href={alert.href}>Abrir <ArrowRight size={14} /></Link>
            </div>
          </article>)}</div> : <div className="mini-empty">{showResolved ? "Nenhum alerta resolvido nesta visão." : "Nenhum alerta exige atenção agora."}</div>}
        </section> : null}

        {!authorizedDepartments.some((department) => ["projetos", "governanca", "obras", "alugueis"].includes(department)) ? <EmptyState icon={<Building2 size={22} />} title="Sem áreas operacionais" description="Solicite acesso a Projetos, Governança, Obras ou Aluguéis para visualizar atividades e alertas." /> : null}
      </div>}
      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}
