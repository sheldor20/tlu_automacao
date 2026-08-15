"use client";

import { Button, Dialog, EmptyState, Field, StatusPill } from "@/components/ui";
import {
  CONSTRUCTION_PLAN_CATEGORIES,
  constructionPlanStoragePath,
  planCategoryLabel,
} from "@/lib/construction-plans";
import { dateBr } from "@/lib/format";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type { Business, ConstructionPlanCategory, ConstructionPlanDocument } from "@/lib/types";
import { ExternalLink, FileText, LoaderCircle, Trash2, Upload } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

export function PlanDocumentManager({ business, onClose }: { business: Business | null; onClose(): void }) {
  const supabase = getSupabase();
  const [documents, setDocuments] = useState<ConstructionPlanDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [form, setForm] = useState({ name: "", category: "urbanistico" as ConstructionPlanCategory, file: null as File | null });

  const load = useCallback(async () => {
    if (!supabase || !business) return;
    setLoading(true);
    const { data, error } = await supabase.from("construction_plan_documents").select("*").eq("business_id", business.id).order("created_at", { ascending: false });
    if (error) {
      setMessage({ text: friendlyError(error), error: true });
      setLoading(false);
      return;
    }
    const signed = await Promise.all(((data || []) as ConstructionPlanDocument[]).map(async (document) => {
      const result = await supabase.storage.from("construction-plans").createSignedUrl(document.file_path, 3600);
      return { ...document, signed_url: result.data?.signedUrl };
    }));
    setDocuments(signed);
    setLoading(false);
  }, [business, supabase]);

  useEffect(() => {
    if (!business) return;
    void Promise.resolve().then(load);
  }, [business, load]);

  async function uploadDocument(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !business || !form.file) return;
    if (form.file.type !== "application/pdf" && !form.file.name.toLocaleLowerCase().endsWith(".pdf")) {
      return setMessage({ text: "Selecione uma prancha em PDF.", error: true });
    }
    if (form.file.size > 50 * 1024 * 1024) return setMessage({ text: "O PDF deve ter até 50 MB.", error: true });
    setSaving(true);
    const documentId = crypto.randomUUID();
    const filePath = constructionPlanStoragePath(documentId, form.file.name);
    const insert = await supabase.from("construction_plan_documents").insert({
      id: documentId,
      business_id: business.id,
      name: form.name.trim(),
      category: form.category,
      file_path: filePath,
      file_name: form.file.name.slice(0, 240),
      mime_type: "application/pdf",
    });
    if (insert.error) {
      setSaving(false);
      return setMessage({ text: friendlyError(insert.error), error: true });
    }
    const upload = await supabase.storage.from("construction-plans").upload(filePath, form.file, { contentType: "application/pdf", upsert: false });
    if (upload.error) {
      await supabase.from("construction_plan_documents").delete().eq("id", documentId);
      setSaving(false);
      return setMessage({ text: friendlyError(upload.error), error: true });
    }
    setForm({ name: "", category: form.category, file: null });
    setMessage({ text: "Planta adicionada. Ela será reaproveitada automaticamente quando o negócio virar obra." });
    setSaving(false);
    await load();
  }

  async function removeDocument(document: ConstructionPlanDocument) {
    if (!supabase || document.status === "approved" || !window.confirm(`Excluir a planta “${document.name}”?`)) return;
    setSaving(true);
    const result = await supabase.from("construction_plan_documents").delete().eq("id", document.id).eq("status", "draft");
    if (!result.error) await supabase.storage.from("construction-plans").remove([document.file_path]);
    setSaving(false);
    if (result.error) return setMessage({ text: friendlyError(result.error), error: true });
    setMessage({ text: "Planta excluída." });
    await load();
  }

  return <Dialog open={Boolean(business)} onClose={onClose} title={`Plantas técnicas · ${business?.name || "negócio"}`} description="Organize os PDFs por disciplina. A calibração e a medição serão feitas dentro da obra." wide>
    <div className="plan-manager-layout">
      <form className="plan-upload-form" onSubmit={uploadDocument}>
        <Field label="Nome da planta"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={160} placeholder="Ex.: Projeto urbanístico aprovado" required /></Field>
        <Field label="Tipo de projeto"><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as ConstructionPlanCategory })}>{CONSTRUCTION_PLAN_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
        <Field label="Arquivo PDF" hint="Pranchas vetoriais do AutoCAD oferecem maior precisão."><label className="file-drop"><Upload size={20} /><span>{form.file?.name || "Selecionar PDF"}</span><input type="file" accept="application/pdf,.pdf" onChange={(event) => setForm({ ...form, file: event.target.files?.[0] || null })} required /></label></Field>
        <Button type="submit" loading={saving} disabled={!form.file}><Upload size={16} /> Adicionar planta</Button>
      </form>
      <section className="plan-document-list">
        <div><strong>Arquivos deste negócio</strong><span>{documents.length} planta(s)</span></div>
        {loading ? <div className="plan-manager-loading"><LoaderCircle className="spin" /> Carregando plantas…</div> : documents.length ? documents.map((document) => <article key={document.id}>
          <span className="plan-document-icon"><FileText size={20} /></span>
          <div><strong>{document.name}</strong><span>{planCategoryLabel(document.category)} · {dateBr(document.created_at)}</span><small>{document.construction_id ? "Já vinculada à obra" : "Será transferida ao entrar em Obra"}</small></div>
          <StatusPill tone={document.status === "approved" ? "success" : "neutral"}>{document.status === "approved" ? "Base aprovada" : "Em preparação"}</StatusPill>
          {document.signed_url ? <a href={document.signed_url} target="_blank" rel="noreferrer" title="Abrir PDF"><ExternalLink size={16} /></a> : null}
          <button type="button" className="danger" disabled={document.status === "approved" || saving} onClick={() => void removeDocument(document)} title={document.status === "approved" ? "Reabra a base na obra antes de excluir" : "Excluir planta"}><Trash2 size={16} /></button>
        </article>) : <EmptyState icon={<FileText size={22} />} title="Nenhuma planta enviada" description="Adicione o projeto urbanístico ou uma prancha de infraestrutura para preparar a futura medição." />}
      </section>
    </div>
    {message ? <div className={`plan-manager-message ${message.error ? "error" : "success"}`}>{message.text}</div> : null}
  </Dialog>;
}
