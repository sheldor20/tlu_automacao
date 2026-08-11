"use client";

import {
  Button,
  Dialog,
  EmptyState,
  Field,
  KpiCard,
  PageIntro,
  StatusPill,
  Toast,
} from "@/components/ui";
import { BRAZIL_STATES, BUSINESS_STAGES } from "@/lib/constants";
import { currency, dateBr, daysBetween, todayIso } from "@/lib/format";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { Business, BusinessStage, StageHistory } from "@/lib/types";
import {
  ArrowRight,
  Building2,
  Clock3,
  ExternalLink,
  MapPin,
  Pencil,
  Plus,
  Route,
  TrendingUp,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type BusinessForm = {
  name: string;
  start_date: string;
  address: string;
  city: string;
  state: string;
  latitude: string;
  longitude: string;
  potential_vgv: string;
  notes: string;
  stage: BusinessStage;
};

const emptyForm: BusinessForm = {
  name: "",
  start_date: todayIso(),
  address: "",
  city: "",
  state: "PR",
  latitude: "",
  longitude: "",
  potential_vgv: "",
  notes: "",
  stage: "prospeccao",
};

export default function NewBusinessPage() {
  const supabase = getSupabase();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [history, setHistory] = useState<StageHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Business | null>(null);
  const [form, setForm] = useState<BusinessForm>(emptyForm);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [{ data: businessData, error }, { data: historyData }] = await Promise.all([
      supabase.from("businesses").select("*").order("updated_at", { ascending: false }),
      supabase.from("business_stage_history").select("*").order("entered_at"),
    ]);
    if (error) setToast({ message: friendlyError(error), type: "error" });
    setBusinesses((businessData || []) as Business[]);
    setHistory((historyData || []) as StageHistory[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const metrics = useMemo(() => {
    const total = businesses.length;
    const totalVgv = businesses.reduce((sum, item) => sum + Number(item.potential_vgv || 0), 0);
    const workCount = businesses.filter((item) => item.stage === "obra").length;
    const averageDays = history.length
      ? Math.round(history.reduce((sum, item) => sum + daysBetween(item.entered_at, item.exited_at), 0) / history.length)
      : 0;
    return { total, totalVgv, workCount, averageDays };
  }, [businesses, history]);

  const byStage = useMemo(() => {
    return BUSINESS_STAGES.map((stage, index) => {
      const items = businesses.filter((business) => business.stage === stage.key);
      const reached = businesses.filter(
        (business) => BUSINESS_STAGES.findIndex((item) => item.key === business.stage) >= index,
      ).length;
      const durations = history.filter((item) => item.stage === stage.key);
      const avgDays = durations.length
        ? Math.round(durations.reduce((sum, item) => sum + daysBetween(item.entered_at, item.exited_at), 0) / durations.length)
        : 0;
      return {
        ...stage,
        items,
        vgv: items.reduce((sum, item) => sum + Number(item.potential_vgv || 0), 0),
        conversion: businesses.length ? Math.round((reached / businesses.length) * 100) : 0,
        avgDays,
      };
    });
  }, [businesses, history]);

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(business: Business) {
    setEditing(business);
    setForm({
      name: business.name,
      start_date: business.start_date,
      address: business.address,
      city: business.city,
      state: business.state,
      latitude: business.latitude?.toString() || "",
      longitude: business.longitude?.toString() || "",
      potential_vgv: business.potential_vgv?.toString() || "",
      notes: business.notes || "",
      stage: business.stage,
    });
    setDialogOpen(true);
  }

  async function saveBusiness(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    const payload = {
      start_date: form.start_date,
      address: form.address.trim(),
      city: form.city.trim(),
      state: form.state,
      latitude: form.latitude ? Number(form.latitude) : null,
      longitude: form.longitude ? Number(form.longitude) : null,
      potential_vgv: Number(form.potential_vgv || 0),
      notes: form.notes.trim() || null,
      stage: form.stage,
    };

    const result = editing
      ? await supabase.from("businesses").update(payload).eq("id", editing.id)
      : await supabase.from("businesses").insert({ ...payload, name: form.name.trim() });

    if (result.error) {
      setToast({ message: friendlyError(result.error), type: "error" });
      setSaving(false);
      return;
    }
    setToast({
      message: editing ? "Negócio atualizado com sucesso." : "Novo negócio adicionado ao funil.",
      type: "success",
    });
    setDialogOpen(false);
    setSaving(false);
    await loadData();
  }

  function mapUrl(business: Business) {
    if (business.latitude != null && business.longitude != null) {
      return `https://www.openstreetmap.org/?mlat=${business.latitude}&mlon=${business.longitude}#map=16/${business.latitude}/${business.longitude}`;
    }
    return `https://www.openstreetmap.org/search?query=${encodeURIComponent(
      [business.address, business.city, business.state].filter(Boolean).join(", "),
    )}`;
  }

  return (
    <>
      <PageIntro
        eyebrow="Departamento · Novos negócios"
        title="Funil de desenvolvimento"
        description="Acompanhe cada oportunidade, o VGV potencial e a velocidade de avanço até o início da obra."
        action={<Button onClick={openNew}><Plus size={18} /> Novo negócio</Button>}
      />

      <section className="kpi-grid">
        <KpiCard label="VGV potencial" value={currency(metrics.totalVgv, true)} helper="soma de todo o funil" icon={<TrendingUp size={17} />} />
        <KpiCard label="Negócios ativos" value={String(metrics.total)} helper="em todas as fases" icon={<Building2 size={17} />} />
        <KpiCard label="Conversão até obra" value={`${metrics.total ? Math.round(metrics.workCount / metrics.total * 100) : 0}%`} helper={`${metrics.workCount} em obra`} tone="success" icon={<Route size={17} />} />
        <KpiCard label="Tempo médio por fase" value={`${metrics.averageDays} dias`} helper="histórico do funil" icon={<Clock3 size={17} />} />
      </section>

      <section className="content-card funnel-card">
        <div className="content-card-head">
          <div>
            <h2>Visão do funil</h2>
            <p>Conversão acumulada e tempo médio por fase</p>
          </div>
          <StatusPill tone="info">Atualização em tempo real</StatusPill>
        </div>
        <div className="funnel-scroll">
          <div className="funnel-grid">
            {byStage.map((stage, index) => (
              <div className="funnel-stage" key={stage.key}>
                <div className="funnel-stage-top">
                  <span className="stage-number">{String(index + 1).padStart(2, "0")}</span>
                  {index < byStage.length - 1 ? <ArrowRight className="stage-arrow" size={16} /> : null}
                </div>
                <h3>{stage.shortLabel}</h3>
                <strong>{stage.items.length}</strong>
                <span className="stage-vgv">{currency(stage.vgv, true)}</span>
                <div className="stage-meta">
                  <span>{stage.conversion}% conversão</span>
                  <span>{stage.avgDays} dias</span>
                </div>
                <div className="stage-projects">
                  {stage.items.slice(0, 3).map((business) => (
                    <button key={business.id} onClick={() => openEdit(business)}>
                      <span>{business.name}</span>
                      <small>{business.city || "Local a definir"}</small>
                    </button>
                  ))}
                  {stage.items.length > 3 ? <small>+ {stage.items.length - 3} negócios</small> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="content-card business-list-card">
        <div className="content-card-head">
          <div>
            <h2>Todos os negócios</h2>
            <p>Dados gerais, localização e fase atual</p>
          </div>
        </div>
        {loading ? (
          <div className="list-loading">Carregando negócios…</div>
        ) : businesses.length === 0 ? (
          <EmptyState
            icon={<TrendingUp size={23} />}
            title="Seu funil está pronto"
            description="Cadastre o primeiro negócio para começar a acompanhar VGV, conversão e tempo entre fases."
            action={<Button onClick={openNew}><Plus size={17} /> Adicionar negócio</Button>}
          />
        ) : (
          <div className="business-table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Negócio</th><th>Fase atual</th><th>VGV potencial</th><th>Início</th><th>Localização</th><th aria-label="Ações" /></tr>
              </thead>
              <tbody>
                {businesses.map((business) => {
                  const stage = BUSINESS_STAGES.find((item) => item.key === business.stage);
                  return (
                    <tr key={business.id}>
                      <td><strong>{business.name}</strong><small>Atualizado em {dateBr(business.updated_at)}</small></td>
                      <td><StatusPill tone={business.stage === "obra" ? "success" : "neutral"}>{stage?.shortLabel}</StatusPill></td>
                      <td><strong>{currency(business.potential_vgv)}</strong></td>
                      <td>{dateBr(business.start_date)}</td>
                      <td>
                        <a href={mapUrl(business)} target="_blank" rel="noreferrer" className="map-link">
                          <MapPin size={14} /> {business.city || "Ver mapa"} <ExternalLink size={12} />
                        </a>
                      </td>
                      <td><button className="table-action" onClick={() => openEdit(business)} aria-label={`Editar ${business.name}`}><Pencil size={16} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? "Atualizar negócio" : "Novo negócio"}
        description={editing ? "O nome é preservado; os demais dados podem ser atualizados." : "Inclua a oportunidade na primeira fase do funil."}
        wide
      >
        <form className="form-grid" onSubmit={saveBusiness}>
          <Field label="Nome do negócio">
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} disabled={Boolean(editing)} maxLength={140} required />
          </Field>
          <Field label="Data de início">
            <input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} required />
          </Field>
          {editing ? (
            <Field label="Fase atual" hint="Ao chegar em Obra, o projeto aparece automaticamente no departamento de Obras.">
              <select value={form.stage} onChange={(event) => setForm({ ...form, stage: event.target.value as BusinessStage })}>
                {BUSINESS_STAGES.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
              </select>
            </Field>
          ) : null}
          <Field label="VGV potencial">
            <input type="number" min="0" step="0.01" value={form.potential_vgv} onChange={(event) => setForm({ ...form, potential_vgv: event.target.value })} placeholder="0,00" required />
          </Field>
          <Field label="Endereço" hint="Use o endereço principal do terreno ou empreendimento.">
            <input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} maxLength={220} placeholder="Rua, número ou referência" required />
          </Field>
          <Field label="Cidade">
            <input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} maxLength={100} required />
          </Field>
          <Field label="Estado">
            <select value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })}>
              {BRAZIL_STATES.map((state) => <option key={state}>{state}</option>)}
            </select>
          </Field>
          <Field label="Latitude" hint="Opcional, melhora a precisão no mapa.">
            <input type="number" step="any" min="-90" max="90" value={form.latitude} onChange={(event) => setForm({ ...form, latitude: event.target.value })} placeholder="-23.5505" />
          </Field>
          <Field label="Longitude" hint="Opcional, melhora a precisão no mapa.">
            <input type="number" step="any" min="-180" max="180" value={form.longitude} onChange={(event) => setForm({ ...form, longitude: event.target.value })} placeholder="-46.6333" />
          </Field>
          <Field label="Observações" hint="Informações rápidas para contextualizar a oportunidade.">
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength={2000} />
          </Field>
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button type="submit" loading={saving}>{editing ? "Salvar alterações" : "Criar negócio"}</Button>
          </div>
        </form>
      </Dialog>

      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}
