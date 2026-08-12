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
import { ListToolbar } from "@/components/list-toolbar";
import { BRAZIL_STATES, BUSINESS_STAGES } from "@/lib/constants";
import { currency, dateBr, daysBetween, todayIso } from "@/lib/format";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { Business, BusinessStage, Project, StageHistory } from "@/lib/types";
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  Building2,
  Clock3,
  ExternalLink,
  MapPin,
  Pencil,
  Plus,
  Route,
  TrendingUp,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type BusinessForm = {
  project_id: string;
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
  project_id: "",
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

type BusinessFilter = "current" | "archived";
type BusinessAction = "archive" | "delete";
type ProjectOption = Pick<Project, "id" | "name" | "status" | "archived_at" | "owner_name">;

export default function NewBusinessPage() {
  const supabase = getSupabase();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [history, setHistory] = useState<StageHistory[]>([]);
  const [filter, setFilter] = useState<BusinessFilter>("current");
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<BusinessStage | "all">("all");
  const [exceptionOnly, setExceptionOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Business | null>(null);
  const [actionBusiness, setActionBusiness] = useState<Business | null>(null);
  const [businessAction, setBusinessAction] = useState<BusinessAction>("archive");
  const [form, setForm] = useState<BusinessForm>(emptyForm);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [{ data: businessData, error }, { data: historyData }, { data: projectData, error: projectError }] = await Promise.all([
      supabase.from("business_operational_summary").select("*").order("updated_at", { ascending: false }),
      supabase.from("business_stage_history").select("*").order("entered_at"),
      supabase.rpc("business_project_options"),
    ]);
    if (error) setToast({ message: friendlyError(error), type: "error" });
    if (projectError) setToast({ message: friendlyError(projectError), type: "error" });
    const options = (projectData || []) as ProjectOption[];
    setBusinesses(((businessData || []) as Business[]).map((business) => ({
      ...business,
      project: options.find((project) => project.id === business.project_id) || null,
    })));
    setProjects(options);
    setHistory((historyData || []) as StageHistory[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const currentBusinesses = useMemo(() => businesses.filter((business) => !business.archived_at), [businesses]);
  const archivedBusinesses = useMemo(() => businesses.filter((business) => Boolean(business.archived_at)), [businesses]);
  const visibleBusinesses = useMemo(() => {
    const source = filter === "current" ? currentBusinesses : archivedBusinesses;
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return source.filter((business) => {
      const matchesSearch = !normalized || [
        business.name,
        business.address,
        business.city,
        business.state,
        business.project?.name,
        business.project?.owner_name,
      ].some((value) => value?.toLocaleLowerCase("pt-BR").includes(normalized));
      const matchesStage = stageFilter === "all" || business.stage === stageFilter;
      const matchesException = !exceptionOnly || Number(business.days_in_stage || 0) >= 30;
      return matchesSearch && matchesStage && matchesException;
    });
  }, [archivedBusinesses, currentBusinesses, exceptionOnly, filter, query, stageFilter]);
  const currentHistory = useMemo(() => {
    const ids = new Set(currentBusinesses.map((business) => business.id));
    return history.filter((item) => ids.has(item.business_id));
  }, [currentBusinesses, history]);

  const metrics = useMemo(() => {
    const total = currentBusinesses.length;
    const totalVgv = currentBusinesses.reduce((sum, item) => sum + Number(item.potential_vgv || 0), 0);
    const workCount = currentBusinesses.filter((item) => item.stage === "obra").length;
    const averageDays = currentHistory.length
      ? Math.round(currentHistory.reduce((sum, item) => sum + daysBetween(item.entered_at, item.exited_at), 0) / currentHistory.length)
      : 0;
    return { total, totalVgv, workCount, averageDays };
  }, [currentBusinesses, currentHistory]);

  const byStage = useMemo(() => {
    return BUSINESS_STAGES.map((stage, index) => {
      const items = currentBusinesses.filter((business) => business.stage === stage.key);
      const reached = currentBusinesses.filter(
        (business) => BUSINESS_STAGES.findIndex((item) => item.key === business.stage) >= index,
      ).length;
      const durations = currentHistory.filter((item) => item.stage === stage.key);
      const avgDays = durations.length
        ? Math.round(durations.reduce((sum, item) => sum + daysBetween(item.entered_at, item.exited_at), 0) / durations.length)
        : 0;
      return {
        ...stage,
        items,
        vgv: items.reduce((sum, item) => sum + Number(item.potential_vgv || 0), 0),
        conversion: currentBusinesses.length ? Math.round((reached / currentBusinesses.length) * 100) : 0,
        avgDays,
      };
    });
  }, [currentBusinesses, currentHistory]);

  function openNew() {
    setEditing(null);
    setForm({ ...emptyForm });
    setDialogOpen(true);
  }

  function openEdit(business: Business) {
    setEditing(business);
    setForm({
      project_id: business.project_id || "",
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
      project_id: form.project_id,
      start_date: editing ? form.start_date : todayIso(),
      address: editing ? form.address.trim() : "A definir",
      city: editing ? form.city.trim() : "A definir",
      state: editing ? form.state : "PR",
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

  async function quickStageChange(business: Business, stage: BusinessStage) {
    if (!supabase || business.stage === stage) return;
    const previous = businesses;
    setBusinesses((items) => items.map((item) => item.id === business.id ? { ...item, stage, days_in_stage: 0 } : item));
    const { error } = await supabase.from("businesses").update({ stage }).eq("id", business.id);
    if (error) {
      setBusinesses(previous);
      return setToast({ message: friendlyError(error), type: "error" });
    }
    setToast({ message: `Fase de ${business.name} atualizada.`, type: "success" });
    await loadData();
  }

  function requestAction(business: Business, action: BusinessAction) {
    setActionBusiness(business);
    setBusinessAction(action);
  }

  async function archiveBusiness(business: Business) {
    if (!supabase) return;
    setSaving(true);
    const { data } = await supabase.auth.getUser();
    const archived = Boolean(business.archived_at);
    const { error } = await supabase
      .from("businesses")
      .update({ archived_at: archived ? null : new Date().toISOString(), archived_by: archived ? null : data.user?.id || null })
      .eq("id", business.id);
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setActionBusiness(null);
    setToast({ message: archived ? "Negócio restaurado ao funil." : "Negócio arquivado sem perder o histórico.", type: "success" });
    await loadData();
  }

  async function deleteBusiness(business: Business) {
    if (!supabase) return;
    setSaving(true);
    const { error } = await supabase.from("businesses").delete().eq("id", business.id);
    setSaving(false);
    if (error) return setToast({ message: friendlyError(error), type: "error" });
    setActionBusiness(null);
    setToast({ message: "Negócio excluído definitivamente.", type: "success" });
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
        <div className="content-card-head project-list-head">
          <div>
            <h2>{filter === "current" ? "Negócios atuais" : "Negócios arquivados"}</h2>
            <p>Dados gerais, localização, fase atual e gestão do histórico</p>
          </div>
          <div className="segmented" aria-label="Filtrar negócios"><button type="button" className={filter === "current" ? "active" : ""} onClick={() => setFilter("current")}>Atuais · {currentBusinesses.length}</button><button type="button" className={filter === "archived" ? "active" : ""} onClick={() => setFilter("archived")}>Arquivados · {archivedBusinesses.length}</button></div>
        </div>
        <ListToolbar query={query} onQueryChange={setQuery}>
          <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value as BusinessStage | "all")} aria-label="Filtrar por fase">
            <option value="all">Todas as fases</option>
            {BUSINESS_STAGES.map((stage) => <option key={stage.key} value={stage.key}>{stage.shortLabel}</option>)}
          </select>
          <label className="filter-check"><input type="checkbox" checked={exceptionOnly} onChange={(event) => setExceptionOnly(event.target.checked)} /> Parados há 30+ dias</label>
        </ListToolbar>
        {loading ? (
          <div className="list-loading">Carregando negócios…</div>
        ) : visibleBusinesses.length === 0 ? (
          <EmptyState
            icon={filter === "current" ? <TrendingUp size={23} /> : <Archive size={23} />}
            title={filter === "current" ? "Seu funil está pronto" : "Nenhum negócio arquivado"}
            description={filter === "current" ? "Cadastre o primeiro negócio para começar a acompanhar VGV, conversão e tempo entre fases." : "Negócios arquivados aparecerão aqui e poderão ser restaurados."}
            action={filter === "current" ? <Button onClick={openNew}><Plus size={17} /> Adicionar negócio</Button> : undefined}
          />
        ) : (
          <div className="business-table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Negócio</th><th>Projeto conectado</th><th>Fase atual</th><th>VGV potencial</th><th>Início</th><th>Localização</th><th aria-label="Ações" /></tr>
              </thead>
              <tbody>
                {visibleBusinesses.map((business) => {
                  const stage = BUSINESS_STAGES.find((item) => item.key === business.stage);
                  return (
                    <tr key={business.id} className={Number(business.days_in_stage || 0) >= 30 ? "exception-row" : ""}>
                      <td><strong>{business.name}</strong><small>{business.archived_at ? `Arquivado em ${dateBr(business.archived_at)}` : Number(business.days_in_stage || 0) >= 30 ? `${business.days_in_stage} dias sem avançar` : `Atualizado em ${dateBr(business.updated_at)}`}</small></td>
                      <td className="business-project-cell"><strong>{business.project?.name || "Vínculo pendente"}</strong><small>{business.project?.owner_name || (business.project ? "Projeto relacionado" : "Registro anterior à nova regra")}</small></td>
                      <td>{business.archived_at ? <StatusPill tone={business.stage === "obra" ? "success" : "neutral"}>{stage?.shortLabel}</StatusPill> : <select className="quick-select" value={business.stage} onChange={(event) => void quickStageChange(business, event.target.value as BusinessStage)} aria-label={`Fase de ${business.name}`}>{BUSINESS_STAGES.map((option) => <option key={option.key} value={option.key}>{option.shortLabel}</option>)}</select>}</td>
                      <td><strong>{currency(business.potential_vgv)}</strong></td>
                      <td>{dateBr(business.start_date)}</td>
                      <td>
                        <a href={mapUrl(business)} target="_blank" rel="noreferrer" className="map-link">
                          <MapPin size={14} /> {business.city || "Ver mapa"} <ExternalLink size={12} />
                        </a>
                      </td>
                      <td><div className="table-actions">{business.archived_at ? null : <button className="table-action" onClick={() => openEdit(business)} aria-label={`Editar ${business.name}`} title="Editar negócio"><Pencil size={16} /></button>}<button className="table-action" onClick={() => business.archived_at ? void archiveBusiness(business) : requestAction(business, "archive")} aria-label={business.archived_at ? `Restaurar ${business.name}` : `Arquivar ${business.name}`} title={business.archived_at ? "Restaurar negócio" : "Arquivar negócio"}>{business.archived_at ? <ArchiveRestore size={16} /> : <Archive size={16} />}</button><button className="table-action danger" onClick={() => requestAction(business, "delete")} aria-label={`Excluir ${business.name}`} title="Excluir negócio"><Trash2 size={16} /></button></div></td>
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
        description={editing ? "Atualize os dados completos do negócio." : "Comece com o essencial. Os demais dados ficam disponíveis na edição."}
        wide
      >
        <form className="form-grid" onSubmit={saveBusiness}>
          <Field
            label="Projeto relacionado"
            hint="Selecione um projeto ativo ou concluído. O vínculo ficará visível nos dois módulos."
            className="form-span-2"
          >
            <select value={form.project_id} onChange={(event) => setForm({ ...form, project_id: event.target.value })} required>
              <option value="">Selecione o projeto</option>
              {editing?.project && !projects.some((project) => project.id === editing.project_id) ? (
                <option value={editing.project.id}>{editing.project.name} · vínculo atual</option>
              ) : null}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name} · {project.status === "concluido" ? "Concluído" : "Em andamento"}</option>
              ))}
            </select>
            {projects.length === 0 && !editing?.project ? (
              <span className="field-empty-hint">Nenhum projeto elegível. <Link href="/projetos">Crie um projeto primeiro.</Link></span>
            ) : null}
          </Field>
          <Field label="Nome do negócio">
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} disabled={Boolean(editing)} maxLength={140} required />
          </Field>
          {editing ? <Field label="Data de início">
            <input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} required />
          </Field> : null}
          {editing ? (
            <Field label="Fase atual" hint="Ao chegar em Obra, o projeto aparece automaticamente no departamento de Obras.">
              <select value={form.stage} onChange={(event) => setForm({ ...form, stage: event.target.value as BusinessStage })}>
                {BUSINESS_STAGES.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
              </select>
            </Field>
          ) : null}
          <Field label="VGV potencial" hint={editing ? undefined : "Pode ficar em zero e ser atualizado depois."}>
            <input type="number" min="0" step="0.01" value={form.potential_vgv} onChange={(event) => setForm({ ...form, potential_vgv: event.target.value })} placeholder="0,00" />
          </Field>
          {editing ? <><Field label="Endereço" hint="Use o endereço principal do terreno ou empreendimento.">
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
          <Field label="Observações" hint="Informações rápidas para contextualizar a oportunidade." className="form-span-2">
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength={2000} />
          </Field></> : null}
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button type="submit" loading={saving} disabled={!form.project_id}>{editing ? "Salvar alterações" : "Criar negócio"}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={Boolean(actionBusiness)} onClose={() => setActionBusiness(null)} title={businessAction === "delete" ? "Excluir negócio?" : "Arquivar negócio?"} description={businessAction === "delete" ? "A exclusão é definitiva e remove o histórico do funil. Se existir uma obra vinculada, ela será preservada como obra avulsa." : "O negócio sairá do funil atual, mas todo o histórico será preservado e poderá ser restaurado."}><div className="confirmation-content"><strong>{actionBusiness?.name}</strong><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setActionBusiness(null)}>Cancelar</Button><Button type="button" variant={businessAction === "delete" ? "danger" : "primary"} loading={saving} onClick={() => actionBusiness && (businessAction === "delete" ? void deleteBusiness(actionBusiness) : void archiveBusiness(actionBusiness))}>{businessAction === "delete" ? <><Trash2 size={16} /> Excluir definitivamente</> : <><Archive size={16} /> Arquivar negócio</>}</Button></div></div></Dialog>

      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}
