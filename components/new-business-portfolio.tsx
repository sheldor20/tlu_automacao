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
import { BusinessBudgetCurve } from "@/components/business-budget-curve";
import { ListToolbar } from "@/components/list-toolbar";
import { PlanDocumentManager } from "@/components/plan-document-manager";
import { BusinessDetail } from "@/components/business-detail";
import { suggestRegistrationNumber, validateRegistryFile, validateAreaImage } from "@/lib/business-registry";
import { BusinessFileManager } from "@/components/business-file-manager";
import {
  BUSINESS_PORTFOLIO_SECTIONS,
  BUSINESS_PORTFOLIO_STAGE_KEYS,
  BUSINESS_STAGES,
  businessPortfolioSectionForStage,
} from "@/lib/constants";
import { currency, dateBr, daysBetween, todayIso } from "@/lib/format";
import { extractKmzCenter, googleMapsUrl, kmzStoragePath } from "@/lib/kmz";
import { friendlyError, getSupabase, storagePath } from "@/lib/supabase";
import type { Business, BusinessPortfolioSection, BusinessStage, Project, StageHistory } from "@/lib/types";
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  Building2,
  Clock3,
  CalendarRange,
  ExternalLink,
  FileText,
  Eye,
  ImagePlus,
  MapPin,
  Map as MapIcon,
  Paperclip,
  Pencil,
  Plus,
  Route,
  TrendingUp,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { QlikWorkSelect } from "./qlik-work-select";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type BusinessForm = {
  qlik_work_key: string;
  project_id: string;
  name: string;
  property_registration: string;
  start_date: string;
  potential_vgv: string;
  notes: string;
  stage: BusinessStage;
  kmz_file: File | null;
  registration_file: File | null;
  area_image: File | null;
};

const emptyForm: BusinessForm = {
  qlik_work_key: "",
  project_id: "",
  name: "",
  property_registration: "",
  start_date: todayIso(),
  potential_vgv: "",
  notes: "",
  stage: "prospeccao",
  kmz_file: null,
  registration_file: null,
  area_image: null,
};

type BusinessFilter = "current" | "archived";
type BusinessAction = "archive" | "delete";
type ProjectOption = Pick<Project, "id" | "name" | "status" | "archived_at" | "owner_name" | "category">;

export default function NewBusinessPortfolio({ section }: { section: BusinessPortfolioSection }) {
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
  const [detailBusiness, setDetailBusiness] = useState<Business | null>(null);
  const [readingRegistry, setReadingRegistry] = useState(false);
  const [registryHint, setRegistryHint] = useState("");
  const registryReadId = useRef(0);
  const [editing, setEditing] = useState<Business | null>(null);
  const [actionBusiness, setActionBusiness] = useState<Business | null>(null);
  const [planBusiness, setPlanBusiness] = useState<Business | null>(null);
  const [curveBusiness, setCurveBusiness] = useState<Business | null>(null);
  const [fileBusiness, setFileBusiness] = useState<Business | null>(null);
  const [businessAction, setBusinessAction] = useState<BusinessAction>("archive");
  const [form, setForm] = useState<BusinessForm>(emptyForm);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const sectionInfo = BUSINESS_PORTFOLIO_SECTIONS.find((item) => item.key === section)!;
  const sectionStageKeys = BUSINESS_PORTFOLIO_STAGE_KEYS[section];
  const sectionStages = useMemo(
    () => BUSINESS_STAGES.filter((stage) => sectionStageKeys.includes(stage.key)),
    [sectionStageKeys],
  );
  const allowDelete = section === "prospeccao";

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [{ data: businessData, error }, { data: historyData }, { data: projectData, error: projectError }] = await Promise.all([
      supabase.from("business_operational_summary").select("*").in("stage", [...sectionStageKeys]).order("updated_at", { ascending: false }),
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
    setProjects(options.filter((project) => project.category === "operational" && !project.archived_at));
    setHistory((historyData || []) as StageHistory[]);
    setLoading(false);
  }, [sectionStageKeys, supabase]);

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
        business.property_registration,
        business.address,
        business.city,
        business.state,
        business.location_file_name,
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
    const finalStageCount = currentBusinesses.filter((item) => item.stage === sectionStageKeys[sectionStageKeys.length - 1]).length;
    const averageDays = currentHistory.length
      ? Math.round(currentHistory.reduce((sum, item) => sum + daysBetween(item.entered_at, item.exited_at), 0) / currentHistory.length)
      : 0;
    return { total, totalVgv, finalStageCount, averageDays };
  }, [currentBusinesses, currentHistory, sectionStageKeys]);

  const byStage = useMemo(() => {
    return sectionStages.map((stage, index) => {
      const items = currentBusinesses.filter((business) => business.stage === stage.key);
      const reached = currentBusinesses.filter(
        (business) => sectionStages.findIndex((item) => item.key === business.stage) >= index,
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
  }, [currentBusinesses, currentHistory, sectionStages]);

  function openNew() {
    registryReadId.current++;
    setReadingRegistry(false);
    setRegistryHint("");
    setEditing(null);
    setForm({ ...emptyForm, stage: sectionStageKeys[0] });
    setDialogOpen(true);
  }

  function openEdit(business: Business) {
    registryReadId.current++;
    setReadingRegistry(false);
    setRegistryHint("");
    setEditing(business);
    setForm({
      project_id: business.project_id || "",
      qlik_work_key: business.qlik_work_key || "",
      name: business.name,
      property_registration: business.property_registration || "",
      start_date: business.start_date,
      potential_vgv: business.potential_vgv?.toString() || "",
      notes: business.notes || "",
      stage: business.stage,
      kmz_file: null,
      registration_file: null,
      area_image: null,
    });
    setDialogOpen(true);
  }

  async function selectRegistry(file: File | null) {
    const readId = ++registryReadId.current;
    setForm((current) => ({ ...current, registration_file: null }));
    setRegistryHint("");
    setReadingRegistry(Boolean(file));
    if (!file) return;
    try {
      await validateRegistryFile(file);
      if (readId !== registryReadId.current) return;
      setForm((current) => ({ ...current, registration_file: file }));
      const suggestion = await suggestRegistrationNumber(file);
      if (readId !== registryReadId.current) return;
      setForm((current) => ({ ...current, property_registration: current.property_registration || suggestion.number || "" }));
      setRegistryHint(suggestion.number
        ? `Número sugerido ${suggestion.source === "pdf" ? "pelo PDF" : "pelo nome do arquivo"}: ${suggestion.number}. Confira o número da matrícula antes de salvar.`
        : "Não foi possível identificar o número. Digite a matrícula no campo abaixo.");
    } catch (error) {
      if (readId === registryReadId.current) setToast({ message: friendlyError(error), type: "error" });
    } finally {
      if (readId === registryReadId.current) setReadingRegistry(false);
    }
  }

  async function saveBusiness(event: FormEvent) {
    event.preventDefault();
    if (!supabase || readingRegistry || saving) return;
    if (!editing && !form.kmz_file) return setToast({ message: "Selecione o arquivo KMZ com a localização da área.", type: "error" });
    if ((form.registration_file || editing?.registration_file_path) && !form.property_registration.trim()) {
      return setToast({ message: "Informe o número da matrícula para registrar o PDF.", type: "error" });
    }
    setSaving(true);
    const businessId = editing?.id || crypto.randomUUID();
    const uploaded: { bucket: string; path: string }[] = [];
    const replaced: { bucket: string; path: string }[] = [];
    try {
      if (form.registration_file) await validateRegistryFile(form.registration_file);
      if (form.area_image) await validateAreaImage(form.area_image);
      const documents: Partial<Business> = {};
      if (form.kmz_file) {
        if (!/\.kmz$/i.test(form.kmz_file.name) || form.kmz_file.size > 20 * 1024 * 1024) throw new Error("O KMZ deve ser válido e ter até 20 MB.");
        Object.assign(documents, await extractKmzCenter(form.kmz_file));
        const path = kmzStoragePath(businessId, form.kmz_file.name);
        const upload = await supabase.storage.from("business-locations").upload(path, new Blob([form.kmz_file], { type: "application/vnd.google-earth.kmz" }), { contentType: "application/vnd.google-earth.kmz", upsert: false });
        if (upload.error) throw upload.error;
        uploaded.push({ bucket: "business-locations", path });
        documents.location_file_path = path;
        documents.location_file_name = form.kmz_file.name.slice(0, 240);
        if (editing?.location_file_path) replaced.push({ bucket: "business-locations", path: editing.location_file_path });
      }
      for (const kind of ["registration", "area"] as const) {
        const file = kind === "registration" ? form.registration_file : form.area_image;
        if (!file) continue;
        const path = storagePath(businessId, file.name, kind === "registration" ? "matricula" : "area");
        const mime = kind === "registration" ? "application/pdf" : /\.png$/i.test(file.name) ? "image/png" : /\.webp$/i.test(file.name) ? "image/webp" : "image/jpeg";
        const upload = await supabase.storage.from("business-documents").upload(path, new Blob([file], { type: mime }), { contentType: mime, upsert: false });
        if (upload.error) throw upload.error;
        uploaded.push({ bucket: "business-documents", path });
        if (kind === "registration") {
          documents.registration_file_path = path;
          documents.registration_file_name = file.name.slice(0, 240);
          if (editing?.registration_file_path) replaced.push({ bucket: "business-documents", path: editing.registration_file_path });
        } else {
          documents.area_image_path = path;
          documents.area_image_name = file.name.slice(0, 240);
          if (editing?.area_image_path) replaced.push({ bucket: "business-documents", path: editing.area_image_path });
        }
      }
      const payload = {
        qlik_work_key: form.qlik_work_key || null, project_id: form.project_id,
        property_registration: form.property_registration.trim() || null,
        start_date: editing ? form.start_date : todayIso(), potential_vgv: Number(form.potential_vgv || 0),
        notes: form.notes.trim() || null, stage: form.stage, ...documents,
      };
      const result = editing
        ? await supabase.from("businesses").update(payload).eq("id", editing.id).select("id").single()
        : await supabase.from("businesses").insert({ ...payload, id: businessId, name: form.name.trim(), address: "Área definida pelo arquivo KMZ", city: "Área mapeada", state: "PR" }).select("id").single();
      if (result.error) throw result.error;
    } catch (error) {
      await Promise.allSettled(uploaded.map((item) => supabase.storage.from(item.bucket).remove([item.path])));
      setToast({ message: error instanceof Error && error.message.startsWith("kmz_") ? "O KMZ não contém uma localização válida." : friendlyError(error), type: "error" });
      setSaving(false);
      return;
    }
    await Promise.allSettled(replaced.map((item) => supabase.storage.from(item.bucket).remove([item.path])));
    setToast({ message: editing ? "Negócio atualizado com sucesso." : "Novo negócio adicionado ao funil.", type: "success" });
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
    const destinationSection = businessPortfolioSectionForStage(stage);
    const destination = BUSINESS_PORTFOLIO_SECTIONS.find((item) => item.key === destinationSection)?.label;
    setToast({
      message: destinationSection === section
        ? `Fase de ${business.name} atualizada.`
        : `${business.name} avançou para ${destination}.`,
      type: "success",
    });
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
    if (!supabase || !allowDelete) return;
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
      return googleMapsUrl(business.latitude, business.longitude);
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      [business.address, business.city, business.state].filter(Boolean).join(", "),
    )}`;
  }

  return (
    <>
      <PageIntro
        eyebrow="Novos negócios"
        title={sectionInfo.label}
        description={`Acompanhe esta parte do funil único, o VGV potencial e a velocidade de avanço das áreas.`}
        action={<Button onClick={openNew}><Plus size={18} /> Novo negócio</Button>}
      />

      <section className="kpi-grid">
        <KpiCard label="VGV potencial" value={currency(metrics.totalVgv, true)} helper="soma desta parte do funil" icon={<TrendingUp size={17} />} />
        <KpiCard label="Negócios ativos" value={String(metrics.total)} helper="nesta parte do funil" icon={<Building2 size={17} />} />
        <KpiCard label={`Na fase ${sectionStages.at(-1)?.shortLabel}`} value={String(metrics.finalStageCount)} helper="fase final desta parte" tone="success" icon={<Route size={17} />} />
        <KpiCard label="Tempo médio por fase" value={`${metrics.averageDays} dias`} helper="histórico desta parte" icon={<Clock3 size={17} />} />
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
                    <button key={business.id} onClick={() => setDetailBusiness(business)}>
                      <span>{business.name}</span>
                      <small>{business.location_file_name || business.city || "Local a definir"}</small>
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
            <p>Dados gerais, arquivo de localização, fase atual e gestão do histórico</p>
          </div>
          <div className="segmented" aria-label="Filtrar negócios"><button type="button" className={filter === "current" ? "active" : ""} onClick={() => setFilter("current")}>Atuais · {currentBusinesses.length}</button><button type="button" className={filter === "archived" ? "active" : ""} onClick={() => setFilter("archived")}>Arquivados · {archivedBusinesses.length}</button></div>
        </div>
        <ListToolbar query={query} onQueryChange={setQuery} placeholder="Buscar por nome, matrícula, projeto ou arquivo KMZ">
          <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value as BusinessStage | "all")} aria-label="Filtrar por fase">
            <option value="all">Todas as fases</option>
            {sectionStages.map((stage) => <option key={stage.key} value={stage.key}>{stage.shortLabel}</option>)}
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
                      <td><button type="button" className="business-name-button" onClick={() => setDetailBusiness(business)}>{business.name}</button><small>Matrícula: {business.property_registration || "não informada"}</small><small>{business.archived_at ? `Arquivado em ${dateBr(business.archived_at)}` : Number(business.days_in_stage || 0) >= 30 ? `${business.days_in_stage} dias sem avançar` : `Atualizado em ${dateBr(business.updated_at)}`}</small></td>
                      <td className="business-project-cell"><strong>{business.project?.name || "Vínculo pendente"}</strong><small>{business.project?.owner_name || (business.project ? "Projeto relacionado" : "Registro anterior à nova regra")}</small></td>
                      <td>{business.archived_at ? <StatusPill tone={business.stage === "obra" ? "success" : "neutral"}>{stage?.shortLabel}</StatusPill> : <select className="quick-select" value={business.stage} onChange={(event) => void quickStageChange(business, event.target.value as BusinessStage)} aria-label={`Fase de ${business.name}`}>{BUSINESS_STAGES.map((option) => <option key={option.key} value={option.key}>{option.shortLabel}</option>)}</select>}</td>
                      <td><strong>{currency(business.potential_vgv)}</strong></td>
                      <td>{dateBr(business.start_date)}</td>
                      <td>
                        <a href={mapUrl(business)} target="_blank" rel="noreferrer" className="map-link" title="Abrir localização no Google Maps">
                          <MapPin size={14} /> <span>{business.location_file_name || "Ver no Google Maps"}</span> <ExternalLink size={12} />
                        </a>
                      </td>
                      <td><div className="table-actions"><button className="table-action" onClick={() => setDetailBusiness(business)} aria-label={`Abrir ${business.name}`} title="Visão geral e relatório PDF"><Eye size={16} /></button>{business.archived_at ? null : <><button className="table-action" onClick={() => setCurveBusiness(business)} aria-label={`Curva mensal de ${business.name}`} title="VGV e investimento mensal"><CalendarRange size={16} /></button><button className="table-action" onClick={() => setFileBusiness(business)} aria-label={`Arquivos de ${business.name}`} title="Imagens, PDFs e vídeos"><Paperclip size={16} /></button><button className="table-action" onClick={() => setPlanBusiness(business)} aria-label={`Plantas de ${business.name}`} title="Plantas técnicas"><MapIcon size={16} /></button><button className="table-action" onClick={() => openEdit(business)} aria-label={`Editar ${business.name}`} title="Editar negócio"><Pencil size={16} /></button></>}<button className="table-action" onClick={() => business.archived_at ? void archiveBusiness(business) : requestAction(business, "archive")} aria-label={business.archived_at ? `Restaurar ${business.name}` : `Arquivar ${business.name}`} title={business.archived_at ? "Restaurar negócio" : "Arquivar negócio"}>{business.archived_at ? <ArchiveRestore size={16} /> : <Archive size={16} />}</button>{allowDelete ? <button className="table-action danger" onClick={() => requestAction(business, "delete")} aria-label={`Excluir ${business.name}`} title="Excluir área"><Trash2 size={16} /></button> : null}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {detailBusiness ? <BusinessDetail business={detailBusiness} onClose={() => setDetailBusiness(null)} onEdit={() => { setDetailBusiness(null); openEdit(detailBusiness); }} onFiles={() => { setDetailBusiness(null); setFileBusiness(detailBusiness); }} /> : null}
      {curveBusiness ? <BusinessBudgetCurve business={curveBusiness} onClose={() => setCurveBusiness(null)} onSaved={() => void loadData()} /> : null}
      <Dialog
        open={dialogOpen}
        onClose={() => { if (!saving) { registryReadId.current++; setDialogOpen(false); } }}
        title={editing ? "Atualizar negócio" : "Novo negócio"}
        description={editing ? "Atualize os dados e, se necessário, substitua o KMZ da área." : `Cadastre uma área em ${sectionInfo.label} com sua localização em KMZ.`}
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
          <QlikWorkSelect value={form.qlik_work_key} onChange={qlik_work_key=>setForm({...form,qlik_work_key})}/>
          <Field label="Nome do negócio">
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} disabled={Boolean(editing)} maxLength={140} required />
          </Field>
          <Field label="PDF da matrícula" hint={registryHint || "Até 20 MB. O número será sugerido quando identificado; confira antes de salvar."} className="form-span-2">
            <label className="file-drop business-kmz-drop">
              <FileText size={20} /><span>{readingRegistry ? "Lendo matrícula…" : form.registration_file?.name || editing?.registration_file_name || "Selecionar PDF da matrícula"}</span>
              <input aria-label="PDF da matrícula" type="file" accept=".pdf,application/pdf" disabled={saving} onChange={(event) => void selectRegistry(event.target.files?.[0] || null)} />
            </label>
          </Field>
          <Field label="Número da matrícula" hint="Confira o número registrado no Cartório de Registro de Imóveis.">
            <input value={form.property_registration} onChange={(event) => setForm({ ...form, property_registration: event.target.value })} required={Boolean(form.registration_file || editing?.registration_file_path)} maxLength={120} placeholder="Ex.: 112.755" />
          </Field>
          {editing ? <Field label="Data de início">
            <input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} required />
          </Field> : null}
          {editing ? (
            <Field label="Fase atual" hint="A fase define automaticamente em qual menu o negócio aparece. Ao chegar em Obra, ele também aparece no departamento de Obras.">
              <select value={form.stage} onChange={(event) => setForm({ ...form, stage: event.target.value as BusinessStage })}>
                {BUSINESS_STAGES.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
              </select>
            </Field>
          ) : null}
          <Field label="VGV potencial" hint={editing ? undefined : "Pode ficar em zero e ser atualizado depois."}>
            <input type="number" min="0" step="0.01" value={form.potential_vgv} onChange={(event) => setForm({ ...form, potential_vgv: event.target.value })} placeholder="0,00" />
          </Field>
          <Field label="Localização da área (.kmz)" hint={editing?.location_file_name ? `Arquivo atual: ${editing.location_file_name}. Selecione outro somente para substituir.` : "Exporte a área pelo Google Earth. O sistema usará o KMZ para abrir o ponto central no Google Maps."} className="form-span-2">
            <label className="file-drop business-kmz-drop">
              <MapPin size={20} />
              <span>{form.kmz_file?.name || editing?.location_file_name || "Selecionar arquivo KMZ"}</span>
              <input type="file" accept=".kmz,application/vnd.google-earth.kmz" onChange={(event) => setForm({ ...form, kmz_file: event.target.files?.[0] || null })} required={!editing?.location_file_path} />
            </label>
          </Field>
          <Field label="Imagem da área (Google Maps/Earth)" hint="PNG, JPG ou WebP, até 20 MB. Preserve a identificação do Google e os créditos da imagem. Esta imagem será incluída no relatório." className="form-span-2">
            <label className="file-drop business-kmz-drop">
              <ImagePlus size={20} /><span>{form.area_image?.name || editing?.area_image_name || "Selecionar imagem da área"}</span>
              <input aria-label="Imagem da área" type="file" accept=".png,.jpg,.jpeg,.webp" onChange={(event) => setForm({ ...form, area_image: event.target.files?.[0] || null })} />
            </label>
          </Field>
          <Field label="Descrição e observações" hint="Informações rápidas para contextualizar a oportunidade." className="form-span-2">
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength={2000} />
          </Field>
          <div className="form-actions">
            <Button type="button" variant="secondary" disabled={saving} onClick={() => { registryReadId.current++; setDialogOpen(false); }}>Cancelar</Button>
            <Button type="submit" loading={saving} disabled={readingRegistry || !form.project_id || (!editing && !form.kmz_file)}>{editing ? "Salvar alterações" : "Criar negócio"}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={Boolean(actionBusiness)} onClose={() => setActionBusiness(null)} title={businessAction === "delete" ? "Excluir negócio?" : "Arquivar negócio?"} description={businessAction === "delete" ? "A exclusão é definitiva e remove o histórico do funil. Se existir uma obra vinculada, ela será preservada como obra avulsa." : "O negócio sairá do funil atual, mas todo o histórico será preservado e poderá ser restaurado."}><div className="confirmation-content"><strong>{actionBusiness?.name}</strong><div className="form-actions"><Button type="button" variant="secondary" onClick={() => setActionBusiness(null)}>Cancelar</Button><Button type="button" variant={businessAction === "delete" ? "danger" : "primary"} loading={saving} onClick={() => actionBusiness && (businessAction === "delete" ? void deleteBusiness(actionBusiness) : void archiveBusiness(actionBusiness))}>{businessAction === "delete" ? <><Trash2 size={16} /> Excluir definitivamente</> : <><Archive size={16} /> Arquivar negócio</>}</Button></div></div></Dialog>

      <PlanDocumentManager key={planBusiness?.id || "closed"} business={planBusiness} onClose={() => setPlanBusiness(null)} />
      <BusinessFileManager key={fileBusiness?.id || "closed-files"} business={fileBusiness} onClose={() => setFileBusiness(null)} />

      {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
    </>
  );
}
