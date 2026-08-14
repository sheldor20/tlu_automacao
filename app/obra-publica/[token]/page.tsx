"use client";

import { ProgressBar } from "@/components/ui";
import { remainingSupplyQuantity, supplyWithRemainingQuantity } from "@/lib/construction-supplies";
import { dateBr } from "@/lib/format";
import type { ConstructionSupply } from "@/lib/types";
import { CalendarRange, Camera, CheckCircle2, HardHat, Package, RefreshCw, Upload } from "lucide-react";
import Image from "next/image";
import { useParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";

type PublicMicro = { id: string; name: string; description: string | null; start_date: string | null; end_date: string | null; progress_percent: number; supplies: ConstructionSupply[] };
type PublicStage = { id: string; name: string; description: string | null; start_date: string | null; end_date: string | null; progress_percent: number; micro_stages: PublicMicro[] };
type PublicWork = { id: string; name: string; address: string | null; status: string; progress_percent: number; updated_at: string };

export default function PublicWorkPage() {
  const params = useParams<{ token: string }>();
  const [work, setWork] = useState<PublicWork | null>(null);
  const [stages, setStages] = useState<PublicStage[]>([]);
  const [editing, setEditing] = useState<PublicMicro | null>(null);
  const [progress, setProgress] = useState("0");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [supplies, setSupplies] = useState<ConstructionSupply[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/public/obras/${params.token}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) setMessage(result.error || "Não foi possível abrir a obra.");
    else { setWork(result.construction); setStages(result.stages || []); setMessage(""); }
    setLoading(false);
  }, [params.token]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function openUpdate(micro: PublicMicro) {
    setEditing(micro);
    setProgress(String(micro.progress_percent));
    setNote("");
    setPhoto(null);
    setSupplies((micro.supplies || []).map((item) => ({ ...item })));
    setMessage("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing || !photo) return;
    setSaving(true);
    const body = new FormData();
    body.set("micro_stage_id", editing.id);
    body.set("progress_percent", progress);
    body.set("note", note);
    body.set("supplies", JSON.stringify(supplies));
    body.set("photo", photo);
    const response = await fetch(`/api/public/obras/${params.token}`, { method: "POST", body });
    const result = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) { setMessage(result.error || "Não foi possível enviar a atualização."); return; }
    setEditing(null);
    await load();
    setMessage("Atualização registrada com sucesso.");
  }

  if (loading) return <main className="public-work-state"><RefreshCw className="spin" /><span>Carregando obra…</span></main>;
  if (!work) return <main className="public-work-state"><HardHat /><h1>Link indisponível</h1><p>{message}</p></main>;

  return <main className="public-work-page">
    <header className="public-work-header">
      <Image src="/logo-terra-lotus.png" alt="Terra Lótus" width={166} height={61} priority />
      <div><span>Acompanhamento de obra</span><h1>{work.name}</h1><p>{work.address || "Localização a definir"}</p></div>
      <div className="public-work-progress"><strong>{Number(work.progress_percent || 0).toFixed(0)}%</strong><span>avanço geral</span></div>
    </header>
    {message ? <div className="public-work-message"><CheckCircle2 size={18} /> {message}</div> : null}
    <section className="public-stage-list">
      {stages.map((stage, stageIndex) => <article className="public-stage" key={stage.id}>
        <div className="public-stage-head"><span>Etapa {String(stageIndex + 1).padStart(2, "0")}</span><div><h2>{stage.name}</h2><p>{stage.description || `${stage.micro_stages.length} microetapa(s)`}</p>{stage.start_date || stage.end_date ? <small><CalendarRange size={13} /> {dateBr(stage.start_date || stage.end_date)} a {dateBr(stage.end_date || stage.start_date)}</small> : null}</div><strong>{Number(stage.progress_percent || 0).toFixed(0)}%</strong></div>
        <ProgressBar value={stage.progress_percent || 0} />
        <div className="public-micro-list">{stage.micro_stages.map((micro) => <div className="public-micro" key={micro.id}>
          <div><strong>{micro.name}</strong><span>{micro.description || "Execução da microetapa"}</span>{micro.start_date || micro.end_date ? <small><CalendarRange size={12} /> {dateBr(micro.start_date || micro.end_date)} a {dateBr(micro.end_date || micro.start_date)}</small> : null}</div>
          <div className="public-micro-stock"><Package size={16} /><span>{micro.supplies?.length || 0} insumo(s)</span></div>
          <div className="public-micro-progress"><strong>{Number(micro.progress_percent).toFixed(0)}%</strong><ProgressBar value={micro.progress_percent} /></div>
          <button type="button" onClick={() => openUpdate(micro)}><Camera size={16} /> Atualizar</button>
        </div>)}</div>
      </article>)}
    </section>

    {editing ? <div className="public-update-backdrop"><form className="public-update-form" onSubmit={submit}>
      <div><span>Atualização de campo</span><h2>{editing.name}</h2><p>Este formulário não exibe nem altera dados financeiros.</p></div>
      <label><span>Avanço</span><div className="range-field"><input type="range" min="0" max="100" value={progress} onChange={(event) => setProgress(event.target.value)} /><strong>{progress}%</strong></div></label>
      {supplies.length ? <div className="public-stock-form"><strong>Estoque atual</strong>{supplies.map((item, index) => <label key={`${item.name}-${index}`}><span>{item.name}<small>Total {Number(item.total_quantity).toLocaleString("pt-BR")}</small></span><input type="number" min="0" max={item.total_quantity} step="0.01" value={remainingSupplyQuantity(item)} onChange={(event) => setSupplies((current) => current.map((supply, itemIndex) => itemIndex === index ? supplyWithRemainingQuantity(supply, Number(event.target.value)) : supply))} /></label>)}</div> : null}
      <label><span>Foto obrigatória</span><div className="file-drop"><Upload size={20} /><b>{photo?.name || "Selecionar foto"}</b><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhoto(event.target.files?.[0] || null)} required /></div></label>
      <label><span>Comentário</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1500} placeholder="Descreva o que foi executado" /></label>
      <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setEditing(null)}>Cancelar</button><button type="submit" className="button button-primary" disabled={saving || !photo}>{saving ? "Enviando…" : "Registrar atualização"}</button></div>
    </form></div> : null}
  </main>;
}
