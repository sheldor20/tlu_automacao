"use client";

import { Button, Dialog, EmptyState, Field, StatusPill } from "@/components/ui";
import { uploadBusinessStorageFile } from "@/lib/business-storage-upload";
import { dateBr } from "@/lib/format";
import { friendlyError, getSupabase, storagePath } from "@/lib/supabase";
import type { Business, BusinessFile } from "@/lib/types";
import { ExternalLink, FileImage, FileText, FileVideo, LoaderCircle, Paperclip, Trash2, Upload } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

const MAX_DOCUMENT_SIZE = 100 * 1024 * 1024;
const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "heic", "pdf", "mp4", "mov", "webm", "mpeg", "mpg"]);

function extension(fileName: string) {
  return fileName.split(".").pop()?.toLocaleLowerCase() || "";
}

function normalizedMimeType(file: File) {
  const types: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
    gif: "image/gif", heic: "image/heic", pdf: "application/pdf", mp4: "video/mp4",
    mov: "video/quicktime", webm: "video/webm", mpeg: "video/mpeg", mpg: "video/mpeg",
  };
  return types[extension(file.name)] || file.type || "application/octet-stream";
}

function fileKind(mimeType: string) {
  if (mimeType.startsWith("image/")) return "Imagem";
  if (mimeType.startsWith("video/")) return "Vídeo";
  return "PDF";
}

function fileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return <FileImage size={20} />;
  if (mimeType.startsWith("video/")) return <FileVideo size={20} />;
  return <FileText size={20} />;
}

function fileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("pt-BR")} KB`;
}

export function BusinessFileManager({ business, onClose }: { business: Business | null; onClose(): void }) {
  const supabase = getSupabase();
  const [files, setFiles] = useState<BusinessFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [inputKey, setInputKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !business) return;
    setLoading(true);
    const { data, error } = await supabase.from("business_files").select("*").eq("business_id", business.id).order("created_at", { ascending: false });
    if (error) {
      setMessage({ text: friendlyError(error), error: true });
      setLoading(false);
      return;
    }
    const signed = await Promise.all(((data || []) as BusinessFile[]).map(async (file) => {
      const result = await supabase.storage.from("business-files").createSignedUrl(file.file_path, 3600);
      return { ...file, signed_url: result.data?.signedUrl };
    }));
    setFiles(signed);
    setLoading(false);
  }, [business, supabase]);

  useEffect(() => {
    if (!business) return;
    void Promise.resolve().then(load);
  }, [business, load]);

  async function uploadFiles(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !business || !selectedFiles.length) return;
    const invalid = selectedFiles.find((file) => !ALLOWED_EXTENSIONS.has(extension(file.name)));
    if (invalid) return setMessage({ text: `O arquivo “${invalid.name}” não é uma imagem, PDF ou vídeo compatível.`, error: true });
    const empty = selectedFiles.find((file) => file.size === 0);
    if (empty) return setMessage({ text: `O arquivo “${empty.name}” está vazio.`, error: true });
    const oversized = selectedFiles.find((file) => {
      const limit = normalizedMimeType(file).startsWith("video/") ? MAX_VIDEO_SIZE : MAX_DOCUMENT_SIZE;
      return file.size > limit;
    });
    if (oversized) {
      const limit = normalizedMimeType(oversized).startsWith("video/") ? "2 GB" : "100 MB";
      return setMessage({ text: `O arquivo “${oversized.name}” ultrapassa o limite de ${limit}.`, error: true });
    }

    setSaving(true);
    setUploadProgress(0);
    let uploaded = 0;
    for (const file of selectedFiles) {
      const filePath = storagePath(business.id, file.name, "anexos");
      const mimeType = normalizedMimeType(file);
      try {
        await uploadBusinessStorageFile({
          supabase,
          filePath,
          file,
          mimeType,
          onProgress: (percentage) => setUploadProgress(Math.round(((uploaded + percentage / 100) / selectedFiles.length) * 100)),
        });
      } catch (error) {
        setMessage({ text: friendlyError(error), error: true });
        break;
      }
      const insert = await supabase.from("business_files").insert({
        business_id: business.id,
        file_path: filePath,
        file_name: file.name.slice(0, 240),
        mime_type: mimeType,
        size_bytes: file.size,
      });
      if (insert.error) {
        await supabase.storage.from("business-files").remove([filePath]);
        setMessage({ text: friendlyError(insert.error), error: true });
        break;
      }
      uploaded += 1;
    }
    setSaving(false);
    setUploadProgress(null);
    if (uploaded === selectedFiles.length) {
      setSelectedFiles([]);
      setInputKey((value) => value + 1);
      setMessage({ text: `${uploaded} arquivo(s) adicionado(s) ao negócio.` });
    } else if (uploaded > 0) {
      setSelectedFiles((current) => current.slice(uploaded));
    }
    await load();
  }

  async function removeFile(file: BusinessFile) {
    if (!supabase || !window.confirm(`Excluir o arquivo “${file.file_name}”?`)) return;
    setSaving(true);
    const result = await supabase.from("business_files").delete().eq("id", file.id);
    if (!result.error) await supabase.storage.from("business-files").remove([file.file_path]);
    setSaving(false);
    if (result.error) return setMessage({ text: friendlyError(result.error), error: true });
    setMessage({ text: "Arquivo excluído." });
    await load();
  }

  return <Dialog open={Boolean(business)} onClose={onClose} title={`Arquivos · ${business?.name || "negócio"}`} description="Guarde imagens, documentos em PDF e vídeos relacionados a esta área." wide>
    <div className="plan-manager-layout">
      <form className="plan-upload-form" onSubmit={uploadFiles}>
        <Field label="Imagens, PDFs ou vídeos" hint="Imagens e PDFs: até 100 MB. Vídeos: até 2 GB, com envio retomável.">
          <label className="file-drop">
            <Upload size={20} />
            <span>{selectedFiles.length ? `${selectedFiles.length} arquivo(s) selecionado(s)` : "Selecionar arquivos"}</span>
            <input key={inputKey} type="file" accept="image/*,application/pdf,.pdf,video/*" multiple onChange={(event) => setSelectedFiles(Array.from(event.target.files || []))} />
          </label>
        </Field>
        {selectedFiles.length ? <div className="business-selected-files">{selectedFiles.map((file) => <span key={`${file.name}-${file.size}-${file.lastModified}`}>{file.name}</span>)}</div> : null}
        <Button type="submit" loading={saving} disabled={!selectedFiles.length}><Upload size={16} /> {uploadProgress === null ? "Enviar arquivos" : `Enviando ${uploadProgress}%`}</Button>
      </form>
      <section className="plan-document-list business-file-list">
        <div><strong>Arquivos deste negócio</strong><span>{files.length} anexo(s)</span></div>
        {loading ? <div className="plan-manager-loading"><LoaderCircle className="spin" /> Carregando arquivos…</div> : files.length ? files.map((file) => <article key={file.id}>
          <span className="plan-document-icon">{fileIcon(file.mime_type)}</span>
          <div><strong>{file.file_name}</strong><span>{fileSize(file.size_bytes)} · {dateBr(file.created_at)}</span></div>
          <StatusPill tone="neutral">{fileKind(file.mime_type)}</StatusPill>
          {file.signed_url ? <a href={file.signed_url} target="_blank" rel="noreferrer" title="Abrir arquivo"><ExternalLink size={16} /></a> : <span />}
          <button type="button" className="danger" disabled={saving} onClick={() => void removeFile(file)} title="Excluir arquivo"><Trash2 size={16} /></button>
        </article>) : <EmptyState icon={<Paperclip size={22} />} title="Nenhum arquivo enviado" description="Adicione imagens, PDFs ou vídeos para centralizar o material desta área." />}
      </section>
    </div>
    {message ? <div className={`plan-manager-message ${message.error ? "error" : "success"}`}>{message.text}</div> : null}
  </Dialog>;
}
