"use client";

import {
  Button,
  Dialog,
  EmptyState,
  Field,
  KpiCard,
  PageIntro,
  ProgressBar,
  StatusPill,
  Toast,
} from "@/components/ui";
import { currency, dateBr, todayIso } from "@/lib/format";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { Construction } from "@/lib/types";
import {
  ArrowUpRight,
  Banknote,
  Building2,
  CalendarClock,
  CircleDollarSign,
  Hammer,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const statusLabel: Record<Construction["status"], string> = {
  planejamento: "Planejamento",
  em_andamento: "Em andamento",
  pausada: "Pausada",
  concluida: "Concluída",
};

export default function WorksPage() {
  const supabase = getSupabase();
  const [works, setWorks] = useState<Construction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [form, setForm] = useState({
    name: "",
    type: "loteamento" as Construction["type"],
    start_date: todayIso(),
    expected_end_date: "",
    planned_budget: "",
    address: "",
    notes: "",
  });

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("construction_progress_summary")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) setToast({ message: friendlyError(error), type: "error" });
    setWorks((data || []) as Construction[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const metrics = useMemo(() => {
    const planned = works.reduce((sum, work) => sum + Number(work.planned_budget || 0), 0);
    const realized = works.reduce((sum, work) => sum + Number(work.realized_total || 0), 0);
    const month = works.reduce((sum, work) => sum + Number(work.realized_current_month || 0), 0);
    const progress = works.length
      ? works.reduce((sum, work) => sum + Number(work.progress_percent || 0), 0) / works.length
      : 0;
    return { planned, realized, month, progress };
  }, [works]);

  async function createWork(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    const { error } = await supabase.from("constructions").insert({
      name: form.name.trim(),
      type: form.type,
      start_date: form.start_date,
      expected_end_date: form.expected_end_date || null,
      planned_budget: Number(form.planned_budget || 0),
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
    });
    if (error) {
      setToast({ message: friendlyError(error), type: "error" });
      setSaving(false);
      return;
    }
    setDialogOpen(false);
    setSaving(false);
    setToast({ message: "Obra criada. Agora estruture as macro e micro etapas.", type: "success" });
    setForm({ name: "", type: "loteamento", start_date: todayIso(), expected_end_date: "", planned_budget: "", address: "", notes: "" });
    await loadData();
  }

  return (
    <>
      <PageIntro
        eyebrow="Departamento · Obras"
        title="Gestão de obras"
        description="Avanço físico, evidências e controle financeiro de loteamentos e construções."
        action={<Button onClick={() => setDialogOpen(true)}><Plus size={18} /> Nova obra</Button>}
      />

      <section className="kpi-grid">
        <KpiCard label="Avanço médio" value={`${metrics.progress.toFixed(0)}%`} helper={`${works.length} obras no portfólio`} tone="success" icon={<Hammer size={17} />} />
        <KpiCard label="Orçamento previsto" value={currency(metrics.planned, true)} helper="total do departamento" icon={<CircleDollarSign size={17} />} />
        <KpiCard label="Realizado acumulado" value={currency(metrics.realized, true)} helper={`${metrics.planned ? (metrics.realized / metrics.planned * 100).toFixed(0) : 0}% do previsto`} icon={<Banknote size={17} />} />
        <KpiCard label="Gasto no mês" value={currency(metrics.month, true)} helper="competência atual" icon={<CalendarClock size={17} />} />
      </section>

      <section className="content-card">
        <div className="content-card-head">
          <div><h2>Portfólio de obras</h2><p>Visão geral do departamento</p></div>
          <StatusPill tone={metrics.realized > metrics.planned && metrics.planned > 0 ? "danger" : "success"}>
            {metrics.realized > metrics.planned && metrics.planned > 0 ? "Atenção ao orçamento" : "Financeiro acompanhado"}
          </StatusPill>
        </div>
        {loading ? (
          <div className="list-loading">Carregando obras…</div>
        ) : works.length === 0 ? (
          <EmptyState
            icon={<Building2 size={23} />}
            title="Nenhuma obra em andamento"
            description="As oportunidades que chegam à fase Obra aparecem aqui automaticamente. Você também pode criar uma obra avulsa."
            action={<Button onClick={() => setDialogOpen(true)}><Plus size={17} /> Criar obra</Button>}
          />
        ) : (
          <div className="works-grid">
            {works.map((work) => {
              const realized = Number(work.realized_total || 0);
              const budgetPercent = work.planned_budget ? realized / Number(work.planned_budget) * 100 : 0;
              return (
                <Link href={`/obras/${work.id}`} className="work-card" key={work.id}>
                  <div className="work-card-head">
                    <div className="work-type-icon"><Building2 size={20} /></div>
                    <StatusPill tone={work.status === "concluida" ? "success" : work.status === "pausada" ? "warning" : "neutral"}>{statusLabel[work.status]}</StatusPill>
                  </div>
                  <div className="work-title">
                    <span>{work.type === "loteamento" ? "Loteamento" : "Construção"}</span>
                    <h3>{work.name}</h3>
                    <p>{work.address || "Localização não informada"}</p>
                  </div>
                  <ProgressBar value={Number(work.progress_percent || 0)} label="Avanço físico" />
                  <div className="work-financial">
                    <div><span>Previsto</span><strong>{currency(work.planned_budget, true)}</strong></div>
                    <div><span>Realizado</span><strong>{currency(realized, true)}</strong></div>
                    <div><span>Uso</span><strong className={budgetPercent > 100 ? "value-danger" : ""}>{budgetPercent.toFixed(0)}%</strong></div>
                  </div>
                  <div className="work-card-footer">
                    <span>{dateBr(work.start_date)} → {dateBr(work.expected_end_date)}</span>
                    <span className="inline-link">Abrir obra <ArrowUpRight size={14} /></span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Nova obra" description="Crie uma obra avulsa ou acompanhe automaticamente as vindas do funil." wide>
        <form className="form-grid" onSubmit={createWork}>
          <Field label="Nome da obra"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required maxLength={140} /></Field>
          <Field label="Tipo"><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as Construction["type"] })}><option value="loteamento">Loteamento</option><option value="construcao">Construção</option></select></Field>
          <Field label="Data de início"><input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} required /></Field>
          <Field label="Previsão de fim"><input type="date" min={form.start_date} value={form.expected_end_date} onChange={(event) => setForm({ ...form, expected_end_date: event.target.value })} /></Field>
          <Field label="Orçamento previsto"><input type="number" min="0" step="0.01" value={form.planned_budget} onChange={(event) => setForm({ ...form, planned_budget: event.target.value })} required /></Field>
          <Field label="Localização"><input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder="Endereço ou cidade" /></Field>
          <Field label="Observações"><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength={2000} /></Field>
          <div className="form-actions"><Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button type="submit" loading={saving}>Criar obra</Button></div>
        </form>
      </Dialog>
      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}
