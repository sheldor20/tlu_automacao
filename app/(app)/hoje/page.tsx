"use client";

import { Button, Dialog, EmptyState, Field, KpiCard, PageIntro, StatusPill, Toast } from "@/components/ui";
import { BUSINESS_STAGES } from "@/lib/constants";
import { dateBr, daysBetween, todayIso } from "@/lib/format";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { Business, Construction, Project, ProjectTask, Rental, RentalStatus, TaskStatus } from "@/lib/types";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarCheck,
  Check,
  Clock3,
  Home,
  ListTodo,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type TodayTask = ProjectTask & { project_name: string };

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
  return { label: `Vence em ${days} dia(s)`, tone: "info" as const, order: 2 };
}

const rentalStatusLabel: Record<RentalStatus, string> = {
  alugado: "Alugado",
  desocupado: "Desocupado",
  aguardando_reforma: "Aguardando reforma",
};

export default function TodayPage() {
  const supabase = getSupabase();
  const [tasks, setTasks] = useState<TodayTask[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [works, setWorks] = useState<Construction[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rescheduleTask, setRescheduleTask] = useState<TodayTask | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState(todayIso());
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setToast(null);
    const [taskResult, projectResult, workResult, rentalResult, businessResult, businessHistoryResult] = await Promise.all([
      supabase.from("project_tasks").select("*").neq("status", "concluida").lte("due_date", new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)).order("due_date"),
      supabase.from("project_progress_summary").select("*").is("archived_at", null),
      supabase.from("construction_progress_summary").select("*").is("archived_at", null).neq("status", "concluida"),
      supabase.from("rentals").select("*").order("lease_end_date"),
      supabase.from("businesses").select("*").is("archived_at", null).neq("stage", "obra"),
      supabase.from("business_stage_history").select("business_id,entered_at").is("exited_at", null),
    ]);
    const failedQueries = [
      ["tarefas", taskResult.error],
      ["projetos", projectResult.error],
      ["obras", workResult.error],
      ["aluguéis", rentalResult.error],
      ["novos negócios", businessResult.error],
      ["histórico dos negócios", businessHistoryResult.error],
    ] as const;
    const firstFailure = failedQueries.find(([, error]) => Boolean(error));
    if (firstFailure) {
      setToast({
        message: `Não foi possível carregar ${firstFailure[0]}: ${friendlyError(firstFailure[1])}`,
        type: "error",
      });
    }
    const projectRows = (projectResult.data || []) as Project[];
    const projectName = new Map(projectRows.map((project) => [project.id, project.name]));
    const stageEnteredAt = new Map(
      (businessHistoryResult.data || []).map((history) => [history.business_id, history.entered_at]),
    );
    const businessRows = ((businessResult.data || []) as Business[]).map((business) => {
      const enteredAt = stageEnteredAt.get(business.id) || business.updated_at || business.created_at;
      return {
        ...business,
        current_stage_entered_at: enteredAt,
        days_in_stage: daysBetween(enteredAt),
      };
    });
    setTasks(((taskResult.data || []) as ProjectTask[]).map((task) => ({ ...task, project_name: projectName.get(task.project_id) || "Projeto" })));
    setProjects(projectRows);
    setWorks((workResult.data || []) as Construction[]);
    setRentals((rentalResult.data || []) as Rental[]);
    setBusinesses(businessRows);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const operationalTasks = useMemo(() => [...tasks].sort((a, b) => {
    const windowDifference = taskWindow(a).order - taskWindow(b).order;
    return windowDifference || a.due_date.localeCompare(b.due_date);
  }), [tasks]);
  const staleWorks = useMemo(() => works.filter((work) => daysBetween(work.last_activity_at || work.created_at) >= 7), [works]);
  const overBudgetWorks = useMemo(() => works.filter((work) => Number(work.planned_budget) > 0 && Number(work.realized_total || 0) > Number(work.planned_budget)), [works]);
  const vacantRentals = useMemo(() => rentals.filter((rental) => rental.status === "desocupado"), [rentals]);
  const expiringRentals = useMemo(() => rentals.filter((rental) => {
    const days = daysUntil(rental.lease_end_date);
    return rental.status === "alugado" && days >= 0 && days <= 60;
  }), [rentals]);
  const stalledBusinesses = useMemo(() => businesses.filter((business) => Number(business.days_in_stage || 0) >= 30), [businesses]);
  const exceptionCount = operationalTasks.filter((task) => daysUntil(task.due_date) < 0).length
    + new Set([...staleWorks, ...overBudgetWorks].map((work) => work.id)).size
    + new Set([...vacantRentals, ...expiringRentals].map((rental) => rental.id)).size
    + stalledBusinesses.length;

  async function updateTask(task: TodayTask, updates: { status?: TaskStatus; due_date?: string }) {
    if (!supabase) return;
    setSaving(true);
    const { error } = await supabase.from("project_tasks").update(updates).eq("id", task.id);
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setRescheduleTask(null);
    setToast({ message: updates.status === "concluida" ? "Tarefa concluída." : "Prazo reagendado.", type: "success" });
    await loadData();
  }

  async function reschedule(event: FormEvent) {
    event.preventDefault();
    if (rescheduleTask) await updateTask(rescheduleTask, { due_date: rescheduleDate });
  }

  async function advanceBusiness(business: Business) {
    if (!supabase) return;
    const index = BUSINESS_STAGES.findIndex((stage) => stage.key === business.stage);
    const nextStage = BUSINESS_STAGES[index + 1];
    if (!nextStage) return;
    setSaving(true);
    const { error } = await supabase.from("businesses").update({ stage: nextStage.key }).eq("id", business.id);
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setToast({ message: `${business.name} avançou para ${nextStage.shortLabel}.`, type: "success" });
    await loadData();
  }

  async function changeRentalStatus(rental: Rental, status: RentalStatus) {
    if (!supabase || status === rental.status) return;
    if (status === "alugado" && !rental.lease_start_date) {
      setToast({ message: "Abra o imóvel e informe o início da locação antes de marcá-lo como alugado.", type: "error" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("rentals").update({ status }).eq("id", rental.id);
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setToast({ message: `Imóvel marcado como ${rentalStatusLabel[status].toLowerCase()}.`, type: "success" });
    await loadData();
  }

  return (
    <>
      <PageIntro
        eyebrow="Centro operacional"
        title="Hoje"
        description="Somente o que precisa de atenção agora, com a próxima ação no mesmo lugar."
        action={<Button variant="secondary" onClick={() => void loadData()} disabled={loading}><RefreshCw size={17} /> Atualizar</Button>}
      />

      <section className="kpi-grid today-kpis">
        <KpiCard label="Exceções abertas" value={String(exceptionCount)} helper="itens que exigem decisão" tone={exceptionCount ? "warning" : "success"} icon={<AlertTriangle size={17} />} />
        <KpiCard label="Tarefas próximas" value={String(operationalTasks.length)} helper="vencidas ou em até 7 dias" icon={<ListTodo size={17} />} />
        <KpiCard label="Obras ativas" value={String(works.length)} helper={`${staleWorks.length} sem atualização recente`} icon={<Building2 size={17} />} />
        <KpiCard label="Projetos ativos" value={String(projects.filter((project) => project.status === "ativo").length)} helper={`${projects.reduce((sum, project) => sum + Number(project.overdue_tasks || 0), 0)} tarefas atrasadas`} icon={<CalendarCheck size={17} />} />
      </section>

      {loading ? <div className="list-loading today-loading">Carregando prioridades…</div> : (
        <div className="today-layout">
          <section className="content-card today-primary-card">
            <div className="content-card-head"><div><h2>Tarefas e prazos</h2><p>Vencidas, para hoje e para os próximos sete dias</p></div><StatusPill tone={operationalTasks.some((task) => daysUntil(task.due_date) < 0) ? "danger" : "success"}>{operationalTasks.length} abertas</StatusPill></div>
            {operationalTasks.length ? <div className="today-action-list">{operationalTasks.map((task) => {
              const window = taskWindow(task);
              return <article key={task.id}>
                <span className={`exception-mark exception-${window.tone}`}><Clock3 size={16} /></span>
                <div className="today-item-main"><div><StatusPill tone={window.tone}>{window.label}</StatusPill><small>{task.project_name}</small></div><strong>{task.title}</strong><span>{task.assignee_name} · {dateBr(task.due_date)}</span></div>
                <div className="today-item-actions"><Button variant="ghost" onClick={() => { setRescheduleTask(task); setRescheduleDate(task.due_date); }}>Reagendar</Button><Button variant="secondary" onClick={() => void updateTask(task, { status: "concluida" })} disabled={saving}><Check size={15} /> Concluir</Button><Link className="button button-primary" href={`/projetos/${task.project_id}?tab=tarefas`}>Abrir</Link></div>
              </article>;
            })}</div> : <EmptyState icon={<Check size={22} />} title="Prazos em dia" description="Nenhuma tarefa vencida ou próxima nos próximos sete dias." />}
          </section>

          <section className="content-card">
            <div className="content-card-head"><div><h2>Obras com atenção</h2><p>Sem evidência recente ou acima do orçamento</p></div><StatusPill tone={staleWorks.length || overBudgetWorks.length ? "warning" : "success"}>{new Set([...staleWorks, ...overBudgetWorks].map((work) => work.id)).size} obra(s)</StatusPill></div>
            {[...new Map([...overBudgetWorks, ...staleWorks].map((work) => [work.id, work])).values()].length ? <div className="today-compact-list">{[...new Map([...overBudgetWorks, ...staleWorks].map((work) => [work.id, work])).values()].map((work) => <article key={work.id}><span className="exception-mark exception-warning"><Building2 size={15} /></span><div><strong>{work.name}</strong><span>{overBudgetWorks.some((item) => item.id === work.id) ? "Orçamento excedido" : `Sem atualização há ${daysBetween(work.last_activity_at || work.created_at)} dias`}</span></div><Link href={`/obras/${work.id}?tab=${overBudgetWorks.some((item) => item.id === work.id) ? "financeiro" : "etapas"}`}>Atualizar <ArrowRight size={14} /></Link></article>)}</div> : <div className="mini-empty">Nenhuma exceção aberta em Obras.</div>}
          </section>

          <section className="content-card">
            <div className="content-card-head"><div><h2>Aluguéis</h2><p>Contratos vencendo e imóveis desocupados</p></div><StatusPill tone={vacantRentals.length || expiringRentals.length ? "warning" : "success"}>{vacantRentals.length + expiringRentals.length} alerta(s)</StatusPill></div>
            {[...new Map([...expiringRentals, ...vacantRentals].map((rental) => [rental.id, rental])).values()].length ? <div className="today-compact-list">{[...new Map([...expiringRentals, ...vacantRentals].map((rental) => [rental.id, rental])).values()].map((rental) => <article key={rental.id}><span className="exception-mark exception-warning"><Home size={15} /></span><div><strong>{rental.name}</strong><span>{rental.status === "desocupado" ? "Imóvel desocupado" : `Contrato termina em ${daysUntil(rental.lease_end_date)} dia(s)`}</span></div>{rental.status === "desocupado" ? <select value={rental.status} onChange={(event) => void changeRentalStatus(rental, event.target.value as RentalStatus)} disabled={saving}><option value="desocupado">Desocupado</option><option value="aguardando_reforma">Aguardando reforma</option><option value="alugado">Alugado</option></select> : <Link href={`/alugueis/${rental.id}`}>Revisar <ArrowRight size={14} /></Link>}</article>)}</div> : <div className="mini-empty">Nenhuma exceção aberta em Aluguéis.</div>}
          </section>

          <section className="content-card">
            <div className="content-card-head"><div><h2>Negócios parados</h2><p>Há 30 dias ou mais na mesma fase</p></div><StatusPill tone={stalledBusinesses.length ? "warning" : "success"}>{stalledBusinesses.length} negócio(s)</StatusPill></div>
            {stalledBusinesses.length ? <div className="today-compact-list">{stalledBusinesses.map((business) => {
              const currentIndex = BUSINESS_STAGES.findIndex((stage) => stage.key === business.stage);
              const nextStage = BUSINESS_STAGES[currentIndex + 1];
              return <article key={business.id}><span className="exception-mark exception-warning"><TrendingUp size={15} /></span><div><strong>{business.name}</strong><span>{business.days_in_stage} dias em {BUSINESS_STAGES[currentIndex]?.shortLabel}</span></div>{nextStage ? <Button variant="ghost" onClick={() => void advanceBusiness(business)} disabled={saving}>Avançar <ArrowRight size={14} /></Button> : <Link href="/novos-negocios">Abrir <ArrowRight size={14} /></Link>}</article>;
            })}</div> : <div className="mini-empty">Nenhum negócio parado no funil.</div>}
          </section>
        </div>
      )}

      <Dialog open={Boolean(rescheduleTask)} onClose={() => setRescheduleTask(null)} title="Reagendar tarefa" description={rescheduleTask?.title}>
        <form className="form-grid" onSubmit={reschedule}>
          <Field label="Nova data de entrega"><input type="date" min={todayIso()} value={rescheduleDate} onChange={(event) => setRescheduleDate(event.target.value)} required /></Field>
          <div className="form-actions"><Button type="button" variant="secondary" onClick={() => setRescheduleTask(null)}>Cancelar</Button><Button type="submit" loading={saving}>Salvar novo prazo</Button></div>
        </form>
      </Dialog>
      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}
