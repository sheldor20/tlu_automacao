"use client";
import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "@/components/ui";
import { getSupabase } from "@/lib/supabase";
import { dateBr } from "@/lib/format";
import { MAX_RENTAL_PDF_BYTES, RENTAL_CONTRACT_BUCKET, type RentalContractDraft, type RentalContractFile, type RentalContractVersion } from "@/lib/rental-contracts";

type Candidate = { name: string; size: number; read: () => Promise<Blob> };
export function RentalContractUpload({ rentalId, refreshKey, busy, onBusy, onFiles, onDraft, onError }: {
  rentalId: string; refreshKey: string; busy: boolean;
  onBusy: (busy: boolean) => void;
  onFiles: (files: RentalContractFile[]) => void;
  onDraft: (draft: RentalContractDraft) => void;
  onError: (message: string) => void;
}) {
  const db = getSupabase();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [uploaded, setUploaded] = useState<RentalContractFile[]>([]);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<RentalContractVersion[]>([]);
  const reportError = useEffectEvent(onError);
  useEffect(() => {
    let active = true;
    void db?.from("rental_contract_versions").select("id,created_at,files,snapshot").eq("rental_id", rentalId).order("created_at", { ascending: false }).then(({ data, error }) => {
      if (!active) return;
      if (error) reportError("Não foi possível carregar o histórico de contratos.");
      else setHistory((data || []) as RentalContractVersion[]);
    });
    return () => { active = false; };
  }, [db, rentalId, refreshKey]);

  async function choose(files: FileList | null) {
    if (!files || working || busy || uploaded.length > 0) return;
    setWorking(true); onBusy(true);
    try {
      const items: Candidate[] = [];
      for (const file of Array.from(files)) {
        if (/\.zip$/i.test(file.name)) {
          if (file.size > 120 * 1024 * 1024) throw new Error("O ZIP deve ter até 120 MB.");
          const { default: JSZip } = await import("jszip");
          const zip = await JSZip.loadAsync(file);
          for (const entry of Object.values(zip.files)) {
            if (entry.dir || !/\.pdf$/i.test(entry.name) || entry.name.startsWith("__MACOSX/")) continue;
            const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0;
            if (size > MAX_RENTAL_PDF_BYTES) throw new Error("Cada PDF deve ter até 25 MB.");
            items.push({ name: entry.name, size, read: () => entry.async("blob") });
          }
        } else if (/\.pdf$/i.test(file.name)) {
          if (file.size > MAX_RENTAL_PDF_BYTES) throw new Error("Cada PDF deve ter até 25 MB.");
          items.push({ name: file.name, size: file.size, read: async () => file });
        } else throw new Error("Selecione arquivos PDF ou ZIP.");
      }
      if (!items.length || items.length > 100) throw new Error("Selecione um arquivo com 1 a 100 PDFs.");
      if (new Set(items.map(i => i.name)).size !== items.length) throw new Error("Selecione arquivos com nomes distintos.");
      setCandidates(items); setSelected(items.length === 1 ? [items[0].name] : []); setUploaded([]); onFiles([]); setMessage("");
    } catch (error) { onError(error instanceof Error ? error.message : "Não foi possível abrir o arquivo."); }
    finally { setWorking(false); onBusy(false); }
  }
  async function uploadAndAnalyze() {
    if (!db || working || busy || uploaded.length > 0 || !selected.length || selected.length > 8) return;
    setWorking(true); onBusy(true); setMessage("Enviando documentos…");
    const files: RentalContractFile[] = [];
    try {
      let total = 0;
      for (const item of candidates.filter(i => selected.includes(i.name))) {
        const blob = await item.read(); total += blob.size;
        if (blob.size > MAX_RENTAL_PDF_BYTES || total > 35 * 1024 * 1024) throw new Error("Selecione até 35 MB por vez, com no máximo 25 MB por PDF.");
        if (new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer()) !== "%PDF-") throw new Error("Um dos documentos não é um PDF válido.");
        const path = `${rentalId}/${crypto.randomUUID()}.pdf`;
        const { error } = await db.storage.from(RENTAL_CONTRACT_BUCKET).upload(path, blob, { contentType: "application/pdf" });
        if (error) throw new Error("Não foi possível enviar o documento. Confira seu acesso e tente novamente.");
        files.push({ path, name: item.name.slice(0, 240) });
        // Preserve each successful upload even if a later file fails.
        setUploaded([...files]); onFiles([...files]);
      }
      setUploaded(files); onFiles(files); setMessage("Lendo contrato e aditivos…");
      const { data } = await db.auth.getSession();
      const response = await fetch(`/api/rentals/${rentalId}/contracts/analyze`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token || ""}` }, body: JSON.stringify({ files }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível ler o contrato.");
      onDraft(result.draft); setMessage("Dados preenchidos. Revise o formulário abaixo e salve a nova versão.");
    } catch (error) {
      setMessage(files.length ? `${files.length} documento(s) enviado(s). Revise e salve esta versão antes de selecionar outros arquivos.` : "");
      onError(error instanceof Error ? error.message : "Falha ao ler os documentos.");
    }
    finally { setWorking(false); onBusy(false); }
  }
  async function download(file: RentalContractFile) {
    const { data, error } = await db!.storage.from(RENTAL_CONTRACT_BUCKET).download(file.path);
    if (error || !data) return onError("Não foi possível abrir o documento.");
    const url = URL.createObjectURL(data); const a = document.createElement("a"); a.href=url; a.download=file.name.split("/").pop() || "contrato.pdf"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return <section className="content-card rental-edit-card">
    <div className="content-card-head"><div><h2>Contrato e aditivos</h2><p>Envie PDF ou abra o ZIP e selecione somente os documentos deste imóvel. Cada salvamento mantém o histórico anterior.</p></div></div>
    <div className="content-card-body">
      <label>Selecionar documentos<input aria-label="Selecionar contrato PDF ou ZIP" type="file" accept=".pdf,.zip" multiple disabled={working || busy || uploaded.length > 0} onChange={event => void choose(event.target.files)} /></label>
      {candidates.length ? <div className="rental-document-choices">{candidates.map(item => <label key={item.name}><input type="checkbox" checked={selected.includes(item.name)} disabled={working || busy || uploaded.length > 0} onChange={event => setSelected(values => event.target.checked ? [...values,item.name] : values.filter(v => v!==item.name))} />{item.name}<small>{(item.size/1024/1024).toFixed(1)} MB</small></label>)}</div> : null}
      <Button type="button" loading={working} disabled={busy || !selected.length || selected.length > 8 || uploaded.length > 0} onClick={() => void uploadAndAnalyze()}>Enviar e preencher dados</Button>
      <p role="status">{message || (uploaded.length ? "Documentos enviados. Preencha ou revise os dados abaixo e salve a versão." : "Até 8 PDFs deste imóvel por versão. Dados ausentes não substituem os já cadastrados.")}</p>
      {history.length ? <details><summary>Histórico de contratos · {history.length} versão(ões)</summary>{history.map((version,index) => <div key={version.id} className="rental-contract-version"><strong>{index === 0 ? "Última versão" : "Versão anterior"} · {dateBr(version.created_at.slice(0,10))}</strong><p>{String(version.snapshot.tenant_name || "Locatário não informado")} · R$ {Number(version.snapshot.monthly_rent || 0).toLocaleString("pt-BR",{minimumFractionDigits:2})}</p>{version.files.map(file => <button type="button" key={file.path} onClick={() => void download(file)}>{file.name}</button>)}</div>)}</details> : <p>Nenhum contrato anexado.</p>}
    </div>
  </section>;
}
