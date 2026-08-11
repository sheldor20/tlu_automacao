"use client";

import { Button, Dialog, EmptyState, Field, KpiCard, PageIntro, ProgressBar, StatusPill, Toast } from "@/components/ui";
import { dateBr, todayIso } from "@/lib/format";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { Project, ProjectStatus } from "@/lib/types";
import { AlertTriangle, ArrowUpRight, CalendarCheck, CheckCircle2, FolderKanban, Plus, Users } from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const statusLabel: Record<ProjectStatus, string> = {
  planejamento: "Planejamento",
  ativo: "Ativo",
  pausado: "Pausado",
  concluido: "Concluído",
};

export default function ProjectsPage() {
  const supabase = getSupabase();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [form, setForm] = useState({ name: "", start_date: todayIso(), end_date: "", owner_name: "", owner_email: "", objective: "" });

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase.from("project_progress_summary").select("*").order("updated_at", { ascending: false });
    if (error) setToast({ message: friendlyError(error), type: "error" });
    setProjects((data || []) as Project[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const metrics = useMemo(() => {
    const active = projects.filter((project) => project.status === "ativo").length;
    const completed = projects.reduce((sum, project) => sum + Number(project.completed_tasks || 0), 0);
    const total = projects.reduce((sum, project) => sum + Number(project.total_tasks || 0), 0);
    const overdue = projects.reduce((sum, project) => sum + Number(project.overdue_tasks || 0), 0);
    const average = projects.length ? projects.reduce((sum, project) => sum + Number(project.progress_percent || 0), 0) / projects.length : 0;
    return { active, completed, total, overdue, average };
  }, [projects]);

  async function createProject(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    const { error } = await supabase.from("projects").insert({
      name: form.name.trim(),
      start_date: form.start_date,
      end_date: form.end_date || null,
      owner_name: form.owner_name.trim(),
      owner_email: form.owner_email.trim().toLowerCase(),
      objective: form.objective.trim(),
      status: "ativo",
    });
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setDialogOpen(false);
    setForm({ name: "", start_date: todayIso(), end_date: "", owner_name: "", owner_email: "", objective: "" });
    setToast({ message: "Projeto criado e pronto para receber tarefas.", type: "success" });
    await loadData();
  }

  return (
    <>
      <PageIntro eyebrow="Departamento · Projetos" title="Projetos e entregas" description="Uma visão simples, combinando tarefas visuais com contexto, arquivos e colaboração." action={<Button onClick={() => setDialogOpen(true)}><Plus size={18} /> Novo projeto</Button>} />
      <section className="kpi-grid">
        <KpiCard label="Projetos ativos" value={String(metrics.active)} helper={`${projects.length} no total`} icon={<FolderKanban size={17} />} />
        <KpiCard label="Avanço médio" value={`${metrics.average.toFixed(0)}%`} helper="baseado nas tarefas" tone="success" icon={<CheckCircle2 size={17} />} />
        <KpiCard label="Tarefas concluídas" value={`${metrics.completed}/${metrics.total}`} helper="em todo o departamento" icon={<CalendarCheck size={17} />} />
        <KpiCard label="Tarefas atrasadas" value={String(metrics.overdue)} helper={metrics.overdue ? "precisam de atenção" : "nenhum alerta aberto"} tone={metrics.overdue ? "warning" : "success"} icon={<AlertTriangle size={17} />} />
      </section>

      <section className="content-card">
        <div className="content-card-head"><div><h2>Todos os projetos</h2><p>Progresso, responsáveis e alertas</p></div><StatusPill tone={metrics.overdue ? "warning" : "success"}>{metrics.overdue ? `${metrics.overdue} tarefas atrasadas` : "Prazos em dia"}</StatusPill></div>
        {loading ? <div className="list-loading">Carregando projetos…</div> : projects.length === 0 ? (
          <EmptyState icon={<FolderKanban size={23} />} title="Crie o primeiro projeto" description="Organize objetivo, responsáveis, tarefas, comentários e arquivos em uma visão única." action={<Button onClick={() => setDialogOpen(true)}><Plus size={17} /> Criar projeto</Button>} />
        ) : (
          <div className="projects-grid">
            {projects.map((project) => (
              <Link href={`/projetos/${project.id}`} className="project-card" key={project.id}>
                <div className="project-card-top"><StatusPill tone={project.status === "concluido" ? "success" : project.status === "pausado" ? "warning" : "info"}>{statusLabel[project.status]}</StatusPill>{Number(project.overdue_tasks || 0) > 0 ? <StatusPill tone="danger"><AlertTriangle size={11} /> {project.overdue_tasks} atrasadas</StatusPill> : null}</div>
                <div className="project-card-title"><h3>{project.name}</h3><p>{project.objective}</p></div>
                <ProgressBar value={Number(project.progress_percent || 0)} label="Progresso das tarefas" />
                <div className="project-stats"><div><span>Responsável</span><strong>{project.owner_name}</strong></div><div><span>Prazo</span><strong>{dateBr(project.end_date)}</strong></div><div><span>Tarefas</span><strong>{project.completed_tasks || 0}/{project.total_tasks || 0}</strong></div></div>
                <div className="project-card-footer"><span><Users size={13} /> {project.owner_email}</span><span className="inline-link">Abrir projeto <ArrowUpRight size={14} /></span></div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Novo projeto" description="Defina o contexto essencial; as tarefas e envolvidos entram na próxima etapa." wide>
        <form className="form-grid" onSubmit={createProject}>
          <Field label="Nome do projeto"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={140} required /></Field>
          <Field label="Responsável"><input value={form.owner_name} onChange={(event) => setForm({ ...form, owner_name: event.target.value })} maxLength={140} required /></Field>
          <Field label="E-mail do responsável"><input type="email" value={form.owner_email} onChange={(event) => setForm({ ...form, owner_email: event.target.value })} required /></Field>
          <Field label="Data de início"><input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} required /></Field>
          <Field label="Previsão de fim"><input type="date" min={form.start_date} value={form.end_date} onChange={(event) => setForm({ ...form, end_date: event.target.value })} /></Field>
          <Field label="Objetivo" hint="Descreva o resultado que define o sucesso deste projeto."><textarea value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} maxLength={2500} required /></Field>
          <div className="form-actions"><Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button type="submit" loading={saving}>Criar projeto</Button></div>
        </form>
      </Dialog>
      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}
