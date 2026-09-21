"use client";

/* eslint-disable @next/next/no-img-element -- Private signed URLs and source attribution must remain intact. */

import { useEffect, useState } from "react";
import { Download, ExternalLink, FileText, MapPin, Paperclip, Pencil } from "lucide-react";
import { Button, Dialog, StatusPill } from "@/components/ui";
import { BUSINESS_STAGES } from "@/lib/constants";
import { currency, dateBr } from "@/lib/format";
import { getSupabase, friendlyError } from "@/lib/supabase";
import { googleMapsUrl } from "@/lib/kmz";
import type { Business, BusinessFile } from "@/lib/types";

export function BusinessDetail({ business, onClose, onEdit, onFiles }: { business: Business; onClose(): void; onEdit(): void; onFiles(): void }) {
  const [files, setFiles] = useState<BusinessFile[]>([]);
  const [registryUrl, setRegistryUrl] = useState<string>();
  const [kmzUrl, setKmzUrl] = useState<string>();
  const [areaUrl, setAreaUrl] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const supabase = getSupabase();

  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase) { setLoading(false); return; }
      try {
        const signed = async (bucket: string, path?: string | null) => {
          if (!path) return undefined;
          const result = await supabase!.storage.from(bucket).createSignedUrl(path, 3600);
          if (result.error) throw result.error;
          return result.data.signedUrl;
        };
        const [fileResult, registry, kmz, area] = await Promise.all([
          supabase.from("business_files").select("*").eq("business_id", business.id).order("created_at"),
          signed("business-documents", business.registration_file_path),
          signed("business-locations", business.location_file_path),
          signed("business-documents", business.area_image_path),
        ]);
        if (fileResult.error) throw fileResult.error;
        const list = await Promise.all(((fileResult.data || []) as BusinessFile[]).map(async (file) => ({ ...file, signed_url: await signed("business-files", file.file_path) })));
        if (active) { setFiles(list); setRegistryUrl(registry); setKmzUrl(kmz); setAreaUrl(area); }
      } catch (error) { if (active) setMessage(friendlyError(error)); }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [business, supabase]);

  async function generate() {
    if (!supabase || generating) return;
    setGenerating(true); setMessage(""); setWarnings([]);
    try {
      const [{ buildBusinessReport, reportImage }, { readBusinessGeometry }, businessResult, fileResult, historyResult] = await Promise.all([
        import("@/lib/business-report"), import("@/lib/business-map"),
        supabase.from("business_operational_summary").select("*").eq("id", business.id).single(),
        supabase.from("business_files").select("*").eq("business_id", business.id).order("created_at"),
        supabase.from("business_stage_history").select("*").eq("business_id", business.id).order("entered_at"),
      ]);
      if (businessResult.error) throw businessResult.error;
      if (fileResult.error) throw fileResult.error;
      if (historyResult.error) throw historyResult.error;
      const current = businessResult.data as Business;
      if (current.project_id) {
        const project = await supabase.rpc("business_project_options");
        if (project.error) throw project.error;
        current.project = project.data?.find((p: { id: string }) => p.id === current.project_id) || null;
      }
      const missing: string[] = [];
      const download = async (bucket: string, path: string | null | undefined, label: string) => {
        if (!path) return null;
        const result = await supabase.storage.from(bucket).download(path);
        if (result.error || !result.data) throw new Error(`Não foi possível carregar ${label}. Tente novamente antes de gerar o relatório.`);
        return result.data;
      };
      const [registry, kmz, area] = await Promise.all([
        download("business-documents", current.registration_file_path, "a matrícula"),
        download("business-locations", current.location_file_path, "o KMZ"),
        download("business-documents", current.area_image_path, "a imagem da área"),
      ]);
      let areaImage = area ? await reportImage(area, `Imagem da área - ${current.area_image_name}`) : null;
      if (!areaImage && current.latitude != null && current.longitude != null) {
        try {
          const session = await supabase.auth.getSession();
          const response = await fetch(`/api/businesses/${business.id}/area-map`, { headers: { Authorization: `Bearer ${session.data.session?.access_token || ""}` } });
          if (!response.ok) throw new Error((await response.json()).error || "Imagem do Google indisponível.");
          areaImage = await reportImage(await response.blob(), "Imagem de satélite - Google Maps. Créditos preservados na imagem.");
        } catch (error) { missing.push(friendlyError(error)); }
      }
      const images = [];
      const allFiles = (fileResult.data || []) as BusinessFile[];
      for (const file of allFiles.filter((item) => item.mime_type.startsWith("image/"))) {
        if (file.size_bytes > 20 * 1024 * 1024) { missing.push(`Imagem acima de 20 MB, disponível na ficha: ${file.file_name}`); continue; }
        try {
          const blob = await download("business-files", file.file_path, file.file_name);
          if (blob) images.push(await reportImage(blob, file.file_name));
        } catch { missing.push(`Não foi possível incluir a imagem: ${file.file_name}`); }
      }
      const geometry = kmz ? await readBusinessGeometry(kmz).catch(() => { missing.push("O desenho do KMZ não pôde ser exibido. Consulte o arquivo original incorporado ao relatório."); return null; }) : null;
      if (!registry) missing.push("PDF da matrícula não enviado ao cadastro.");
      if (!kmz) missing.push("KMZ não enviado ao cadastro.");
      const report = await buildBusinessReport({ business: current, files: allFiles, history: historyResult.data || [], areaImage, images, geometry, registry: registry ? new Uint8Array(await registry.arrayBuffer()) : null, kmz: kmz ? new Uint8Array(await kmz.arrayBuffer()) : null, warnings: missing });
      const url = URL.createObjectURL(new Blob([new Uint8Array(report.bytes)], { type: "application/pdf" }));
      const anchor = document.createElement("a"); anchor.href = url;
      anchor.download = `Relatorio-${business.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9-]+/g, "-")}.pdf`;
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      setWarnings(report.warnings); setMessage("Relatório PDF gerado.");
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setGenerating(false); }
  }

  const stage = BUSINESS_STAGES.find((item) => item.key === business.stage);
  return <Dialog open onClose={() => { if (!generating) onClose(); }} title={business.name} description="Visão geral, documentos e relatório da área." wide>
    <div className="business-detail">
      <div className="business-detail-toolbar">
        <StatusPill tone="neutral">{stage?.label || business.stage}</StatusPill>
        <Button onClick={() => void generate()} loading={generating} disabled={loading || !supabase}><Download size={16} />{generating ? "Preparando relatório…" : "Gerar relatório PDF"}</Button>
      </div>
      <dl className="business-detail-facts">
        <div><dt>VGV potencial</dt><dd>{currency(business.potential_vgv)}</dd></div>
        <div><dt>Matrícula</dt><dd>{business.property_registration || "Não informada"}</dd></div>
        <div><dt>Projeto relacionado</dt><dd>{business.project?.name || "Não informado"}</dd></div>
        <div><dt>Início</dt><dd>{dateBr(business.start_date)}</dd></div>
      </dl>
      <section><h3>Descrição</h3><p className="business-detail-description">{business.notes || "Adicione a descrição e as observações em Editar negócio."}</p></section>
      <section><h3>Localização da área</h3>
        {areaUrl ? <figure>{/* Signed private images bypass the public image optimizer. */}<img className="business-detail-area" src={areaUrl} alt={`Imagem da área de ${business.name}`} /><figcaption>{business.area_image_name}</figcaption></figure> : <p>Envie uma imagem do Google Maps/Earth em Editar negócio para incluí-la no relatório.</p>}
        <div className="business-detail-links">
          {business.latitude != null && business.longitude != null ? <a href={googleMapsUrl(business.latitude, business.longitude)} target="_blank" rel="noreferrer"><MapPin size={16} /> Abrir no Google Maps <ExternalLink size={13} /></a> : null}
          {kmzUrl ? <a href={kmzUrl} target="_blank" rel="noreferrer"><Download size={16} /> {business.location_file_name}</a> : null}
        </div>
      </section>
      <section><h3>Matrícula e arquivos</h3>
        {loading ? <p>Carregando documentos…</p> : <>
          {registryUrl ? <a className="business-document-link" href={registryUrl} target="_blank" rel="noreferrer"><FileText size={18} /> Matrícula {business.property_registration} · {business.registration_file_name}<ExternalLink size={14} /></a> : <p>PDF da matrícula ainda não enviado.</p>}
          <div className="business-detail-gallery">{files.filter((file) => file.mime_type.startsWith("image/")).map((file) => <a key={file.id} href={file.signed_url} target="_blank" rel="noreferrer"><img src={file.signed_url} alt={file.file_name} loading="lazy" /><span>{file.file_name}</span></a>)}</div>
          <p>{files.length} arquivo(s) adicional(is). O relatório inclui as imagens compatíveis e a relação dos demais documentos.</p>
        </>}
      </section>
      {message ? <p role="status" className="business-report-message">{message}</p> : null}
      {warnings.length ? <div role="status" className="business-report-warnings"><strong>O relatório registra estas pendências:</strong><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div> : null}
      <div className="form-actions"><Button variant="secondary" onClick={onFiles} disabled={generating}><Paperclip size={16} /> Arquivos</Button>{!business.archived_at ? <Button variant="secondary" onClick={onEdit} disabled={generating}><Pencil size={16} /> Editar negócio</Button> : null}</div>
    </div>
  </Dialog>;
}
