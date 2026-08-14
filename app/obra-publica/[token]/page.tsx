"use client";

import { ProgressBar } from "@/components/ui";
import { remainingSupplyQuantity, supplyWithRemainingQuantity } from "@/lib/construction-supplies";
import { dateBr } from "@/lib/format";
import {
  PUBLIC_WORK_MAX_PHOTO_BYTES,
  PUBLIC_WORK_SYNC_TAG,
  PublicWorkSubmissionError,
  applySubmissionToSnapshot,
  clearPublicWorkOfflineData,
  compressPublicWorkPhoto,
  getPublicWorkSnapshot,
  isRetryablePublicWorkStatus,
  listPendingPublicWorkSubmissions,
  normalizedPublicWorkPhotoName,
  putPendingPublicWorkSubmission,
  removePendingPublicWorkSubmission,
  savePublicWorkSnapshot,
  sendPublicWorkSubmission,
  type PendingPublicWorkSubmission,
  type PublicWorkConstruction,
  type PublicWorkMicro,
  type PublicWorkSnapshot,
  type PublicWorkStage,
} from "@/lib/public-work-offline";
import type { ConstructionSupply } from "@/lib/types";
import {
  AlertTriangle,
  CalendarRange,
  Camera,
  CheckCircle2,
  CloudUpload,
  HardHat,
  Package,
  RefreshCw,
  Trash2,
  Upload,
  Wifi,
  WifiOff,
} from "lucide-react";
import Image from "next/image";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Notice = { text: string; tone: "success" | "warning" | "error" };
type SyncRegistration = ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } };

function queueDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export default function PublicWorkPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [work, setWork] = useState<PublicWorkConstruction | null>(null);
  const [stages, setStages] = useState<PublicWorkStage[]>([]);
  const [editing, setEditing] = useState<PublicWorkMicro | null>(null);
  const [editingPendingId, setEditingPendingId] = useState<string | null>(null);
  const [progress, setProgress] = useState("0");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [supplies, setSupplies] = useState<ConstructionSupply[]>([]);
  const [pending, setPending] = useState<PendingPublicWorkSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [offlineReady, setOfflineReady] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const syncLock = useRef(false);

  const refreshPending = useCallback(async () => {
    try {
      const records = await listPendingPublicWorkSubmissions(token);
      setPending(records);
      if (records.some((record) => record.requires_review)) setQueueOpen(true);
      return records;
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "Não foi possível abrir a fila offline.", tone: "error" });
      return [];
    }
  }, [token]);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch(`/api/public/obras/${token}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status >= 500) throw new Error(result.error || "Servidor temporariamente indisponível.");
        setWork(null);
        setStages([]);
        setNotice({ text: result.error || "Não foi possível abrir a obra.", tone: "error" });
        return false;
      }
      const snapshot = { construction: result.construction, stages: result.stages || [] } satisfies PublicWorkSnapshot;
      setWork(snapshot.construction);
      setStages(snapshot.stages);
      await savePublicWorkSnapshot(token, snapshot);
      setIsOnline(true);
      return true;
    } catch {
      try {
        const cached = await getPublicWorkSnapshot(token);
        if (cached) {
          setWork(cached.construction);
          setStages(cached.stages);
          setNotice({ text: "Sem conexão. Exibindo a última versão salva neste aparelho.", tone: "warning" });
          return false;
        }
      } catch {
        // A mensagem abaixo também cobre navegadores sem IndexedDB.
      }
      setWork(null);
      setStages([]);
      setNotice({ text: "Conecte-se à internet e abra este link uma vez para ativar o uso offline.", tone: "error" });
      return false;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [token]);

  const synchronize = useCallback(async () => {
    if (syncLock.current || typeof navigator === "undefined" || !navigator.onLine) return;
    syncLock.current = true;
    setSyncing(true);
    let synchronized = 0;
    let temporaryFailure: string | null = null;
    let reviewRequired = 0;
    try {
      const records = await listPendingPublicWorkSubmissions(token);
      const latestMicroUpdate = new Map<string, string>();
      for (const queued of records) {
        if (queued.requires_review) {
          reviewRequired += 1;
          continue;
        }
        const submission = latestMicroUpdate.has(queued.micro_stage_id)
          ? { ...queued, base_updated_at: latestMicroUpdate.get(queued.micro_stage_id) as string }
          : queued;
        if (submission !== queued) await putPendingPublicWorkSubmission(submission);
        try {
          const result = await sendPublicWorkSubmission(submission);
          await removePendingPublicWorkSubmission(submission.id);
          synchronized += 1;
          if (result.micro_stage_updated_at) latestMicroUpdate.set(submission.micro_stage_id, result.micro_stage_updated_at);
        } catch (error) {
          const submissionError = error instanceof PublicWorkSubmissionError
            ? error
            : new PublicWorkSubmissionError("Falha inesperada durante a sincronização.", 0);
          const retryable = isRetryablePublicWorkStatus(submissionError.status);
          await putPendingPublicWorkSubmission({
            ...submission,
            attempts: submission.attempts + 1,
            last_error: submissionError.message,
            requires_review: !retryable,
          });
          if (!retryable) {
            reviewRequired += 1;
            continue;
          }
          temporaryFailure = submissionError.message;
          break;
        }
      }
      await refreshPending();
      if (synchronized > 0 || reviewRequired > 0) await load(false);
      if (reviewRequired > 0) {
        setNotice({ text: `${reviewRequired} atualização(ões) precisam ser revisadas antes do envio.`, tone: "warning" });
        setQueueOpen(true);
      } else if (temporaryFailure) {
        setNotice({ text: `${temporaryFailure} Os dados continuam salvos neste aparelho.`, tone: "warning" });
      } else if (synchronized > 0) {
        setNotice({ text: `${synchronized} atualização(ões) sincronizada(s) com sucesso.`, tone: "success" });
      }
    } finally {
      syncLock.current = false;
      setSyncing(false);
    }
  }, [load, refreshPending, token]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      setIsOnline(navigator.onLine);
      await load();
      await refreshPending();
      if (navigator.onLine) await synchronize();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshPending, synchronize]);

  useEffect(() => {
    const online = () => {
      setIsOnline(true);
      setNotice({ text: "Conexão restaurada. Verificando atualizações pendentes…", tone: "success" });
      void load(false).then(() => synchronize());
    };
    const offline = () => {
      setIsOnline(false);
      setNotice({ text: "Modo offline ativo. As atualizações ficarão salvas neste aparelho.", tone: "warning" });
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [load, synchronize]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "PUBLIC_WORK_CACHE_READY") {
        setOfflineReady(true);
        return;
      }
      if (event.data?.type !== "PUBLIC_WORK_SYNC_COMPLETE") return;
      void refreshPending();
      void load(false);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    void navigator.serviceWorker.register("/public-work-sw.js", { scope: "/" }).then(async () => {
      const registration = await navigator.serviceWorker.ready;
      const assets = performance.getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((resource) => {
          const resourceUrl = new URL(resource, window.location.origin);
          return resourceUrl.origin === window.location.origin
            && (resourceUrl.pathname.startsWith("/_next/static/")
              || resourceUrl.pathname.startsWith("/_next/image")
              || resourceUrl.pathname === "/logo-terra-lotus.png"
              || resourceUrl.pathname.endsWith("/manifest.webmanifest"));
        });
      registration.active?.postMessage({ type: "CACHE_PUBLIC_WORK", url: window.location.href, assets });
    }).catch(() => setNotice({ text: "O formulário funciona online, mas este navegador não ativou o cache offline.", tone: "warning" }));
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [load, refreshPending]);

  const pendingMicroIds = useMemo(() => new Set(pending.map((submission) => submission.micro_stage_id)), [pending]);

  function openUpdate(micro: PublicWorkMicro) {
    setEditing(micro);
    setEditingPendingId(null);
    setProgress(String(micro.progress_percent));
    setNote("");
    setPhoto(null);
    setSupplies((micro.supplies || []).map((item) => ({ ...item })));
    setNotice(null);
  }

  function reviewPending(submission: PendingPublicWorkSubmission) {
    const micro = stages.flatMap((stage) => stage.micro_stages).find((item) => item.id === submission.micro_stage_id);
    if (!micro) {
      setNotice({ text: "Esta microetapa não está mais disponível. Descarte o envio ou atualize a página com internet.", tone: "error" });
      return;
    }
    setEditing(micro);
    setEditingPendingId(submission.id);
    setProgress(String(submission.progress_percent));
    setNote(submission.note);
    setSupplies(submission.supplies.map((item) => ({ ...item })));
    setPhoto(new File([submission.photo], submission.photo_name, { type: submission.photo_type || submission.photo.type }));
    setQueueOpen(false);
    setNotice({ text: "Confira os dados atuais da microetapa e registre novamente.", tone: "warning" });
  }

  async function requestBackgroundSync() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.ready as SyncRegistration;
      await registration.sync?.register(PUBLIC_WORK_SYNC_TAG);
    } catch {
      // O envio ao reabrir a página e o botão manual cobrem navegadores sem Background Sync.
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing || !photo || !work) return;
    setSaving(true);
    try {
      const compressedPhoto = await compressPublicWorkPhoto(photo);
      if (compressedPhoto.size > PUBLIC_WORK_MAX_PHOTO_BYTES) {
        setNotice({ text: "A foto continua maior que 10 MB após a otimização. Selecione uma imagem menor.", tone: "error" });
        return;
      }
      const submission = {
        id: editingPendingId || crypto.randomUUID(),
        token,
        micro_stage_id: editing.id,
        micro_stage_name: editing.name,
        progress_percent: Number(progress),
        note: note.trim(),
        supplies: supplies.map((item) => ({ ...item })),
        photo: compressedPhoto,
        photo_name: normalizedPublicWorkPhotoName(photo, compressedPhoto),
        photo_type: compressedPhoto.type || photo.type,
        base_updated_at: editing.updated_at,
        created_at: new Date().toISOString(),
        attempts: 0,
        last_error: null,
        requires_review: false,
      } satisfies PendingPublicWorkSubmission;
      await putPendingPublicWorkSubmission(submission);
      const optimistic = applySubmissionToSnapshot({ construction: work, stages }, submission);
      setStages(optimistic.stages);
      await savePublicWorkSnapshot(token, optimistic);
      setEditing(null);
      setEditingPendingId(null);
      setPhoto(null);
      await refreshPending();
      await requestBackgroundSync();
      if (navigator.onLine) {
        setNotice({ text: "Atualização salva neste aparelho. Sincronizando…", tone: "success" });
        await synchronize();
      } else {
        setNotice({ text: "Atualização salva neste aparelho. Ela será enviada quando a internet voltar.", tone: "warning" });
      }
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "Não foi possível salvar a atualização no aparelho.", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function discardSubmission(id: string) {
    if (!window.confirm("Descartar esta atualização que ainda não foi enviada?")) return;
    await removePendingPublicWorkSubmission(id);
    await refreshPending();
    setNotice({ text: "Atualização pendente descartada.", tone: "warning" });
  }

  async function clearOfflineData() {
    const warning = pending.length
      ? "Existem atualizações ainda não enviadas. Apagar todos os dados offline deste aparelho?"
      : "Apagar a cópia offline desta obra neste aparelho?";
    if (!window.confirm(warning)) return;
    await clearPublicWorkOfflineData(token);
    setPending([]);
    setQueueOpen(false);
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_PUBLIC_WORK_CACHE", token });
    setNotice({ text: "Dados offline apagados deste aparelho.", tone: "success" });
  }

  if (loading) return <main className="public-work-state"><RefreshCw className="spin" /><span>Carregando obra…</span></main>;
  if (!work) return <main className="public-work-state"><HardHat /><h1>Link indisponível</h1><p>{notice?.text}</p></main>;

  return <main className="public-work-page">
    <header className="public-work-header">
      <Image src="/logo-terra-lotus.png" alt="Terra Lótus" width={166} height={61} priority />
      <div><span>Acompanhamento de obra</span><h1>{work.name}</h1><p>{work.address || "Localização a definir"}</p></div>
      <div className="public-work-progress"><strong>{Number(work.progress_percent || 0).toFixed(0)}%</strong><span>avanço geral</span></div>
    </header>

    <section className={`public-offline-bar ${isOnline ? "is-online" : "is-offline"}`}>
      <div className="public-offline-status">{isOnline ? <Wifi size={19} /> : <WifiOff size={19} />}<div><strong>{isOnline ? pending.length ? `${pending.length} atualização(ões) aguardando envio` : offlineReady ? "Página disponível offline" : "Preparando acesso offline…" : "Modo offline ativo"}</strong><span>{isOnline ? offlineReady ? "Os dados são enviados após confirmação do servidor." : "Mantenha a página aberta por alguns instantes." : "Preencha normalmente; tudo ficará salvo neste aparelho."}</span></div></div>
      <div className="public-offline-actions">
        {pending.length ? <button type="button" onClick={() => setQueueOpen((current) => !current)}>{queueOpen ? "Ocultar fila" : "Ver fila"}</button> : null}
        {pending.some((item) => !item.requires_review) && isOnline ? <button type="button" className="primary" onClick={() => void synchronize()} disabled={syncing}><CloudUpload size={15} /> {syncing ? "Sincronizando…" : "Sincronizar agora"}</button> : null}
        <button type="button" onClick={() => void clearOfflineData()}><Trash2 size={14} /> Limpar dados offline</button>
      </div>
    </section>

    {notice ? <div className={`public-work-message ${notice.tone}`}>
      {notice.tone === "success" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />} {notice.text}
    </div> : null}

    {queueOpen && pending.length ? <section className="public-sync-queue">
      <div className="public-sync-queue-head"><div><span>Fila deste aparelho</span><h2>Atualizações ainda não confirmadas</h2></div><strong>{pending.length}</strong></div>
      <div>{pending.map((submission) => <article key={submission.id} className={submission.requires_review ? "requires-review" : ""}>
        <div><strong>{submission.micro_stage_name}</strong><span>{submission.progress_percent}% de avanço · {queueDate(submission.created_at)}</span><small>{submission.requires_review ? submission.last_error || "Revisão necessária." : submission.last_error || "Pronta para sincronizar."}</small></div>
        <div>{submission.requires_review ? <button type="button" onClick={() => reviewPending(submission)}>Revisar</button> : null}<button type="button" className="danger" onClick={() => void discardSubmission(submission.id)}>Descartar</button></div>
      </article>)}</div>
    </section> : null}

    <section className="public-stage-list">
      {stages.map((stage, stageIndex) => <article className="public-stage" key={stage.id}>
        <div className="public-stage-head"><span>Etapa {String(stageIndex + 1).padStart(2, "0")}</span><div><h2>{stage.name}</h2><p>{stage.description || `${stage.micro_stages.length} microetapa(s)`}</p>{stage.start_date || stage.end_date ? <small><CalendarRange size={13} /> {dateBr(stage.start_date || stage.end_date)} a {dateBr(stage.end_date || stage.start_date)}</small> : null}</div><strong>{Number(stage.progress_percent || 0).toFixed(0)}%</strong></div>
        <ProgressBar value={stage.progress_percent || 0} />
        <div className="public-micro-list">{stage.micro_stages.map((micro) => <div className={`public-micro ${pendingMicroIds.has(micro.id) ? "has-pending" : ""}`} key={micro.id}>
          <div><strong>{micro.name}</strong><span>{micro.description || "Execução da microetapa"}</span>{micro.start_date || micro.end_date ? <small><CalendarRange size={12} /> {dateBr(micro.start_date || micro.end_date)} a {dateBr(micro.end_date || micro.start_date)}</small> : null}{pendingMicroIds.has(micro.id) ? <small className="public-pending-mark"><CloudUpload size={12} /> Envio pendente</small> : null}</div>
          <div className="public-micro-stock"><Package size={16} /><span>{micro.supplies?.length || 0} insumo(s)</span></div>
          <div className="public-micro-progress"><strong>{Number(micro.progress_percent).toFixed(0)}%</strong><ProgressBar value={micro.progress_percent} /></div>
          <button type="button" onClick={() => openUpdate(micro)}><Camera size={16} /> Atualizar</button>
        </div>)}</div>
      </article>)}
    </section>

    {editing ? <div className="public-update-backdrop"><form className="public-update-form" onSubmit={submit}>
      <div><span>{editingPendingId ? "Revisão de envio offline" : "Atualização de campo"}</span><h2>{editing.name}</h2><p>Este formulário não exibe nem altera dados financeiros.</p></div>
      <label><span>Avanço</span><div className="range-field"><input type="range" min="0" max="100" value={progress} onChange={(event) => setProgress(event.target.value)} /><strong>{progress}%</strong></div></label>
      {supplies.length ? <div className="public-stock-form"><strong>Estoque atual</strong>{supplies.map((item, index) => <label key={`${item.name}-${index}`}><span>{item.name}<small>Total {Number(item.total_quantity).toLocaleString("pt-BR")}</small></span><input type="number" min="0" max={item.total_quantity} step="0.01" value={remainingSupplyQuantity(item)} onChange={(event) => setSupplies((current) => current.map((supply, itemIndex) => itemIndex === index ? supplyWithRemainingQuantity(supply, Number(event.target.value)) : supply))} /></label>)}</div> : null}
      <label><span>Foto obrigatória</span><div className="file-drop"><Upload size={20} /><b>{photo?.name || "Selecionar foto"}</b><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => setPhoto(event.target.files?.[0] || null)} /></div></label>
      <label><span>Comentário</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1500} placeholder="Descreva o que foi executado" /></label>
      <div className="public-local-save-note"><CloudUpload size={17} /><span><strong>Salvamento seguro</strong>Ao registrar, a atualização fica primeiro neste aparelho e depois é sincronizada.</span></div>
      <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => { setEditing(null); setEditingPendingId(null); }}>Cancelar</button><button type="submit" className="button button-primary" disabled={saving || !photo}>{saving ? "Salvando…" : isOnline ? "Salvar e sincronizar" : "Salvar no aparelho"}</button></div>
    </form></div> : null}
  </main>;
}
