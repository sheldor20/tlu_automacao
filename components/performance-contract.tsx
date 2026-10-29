"use client";
import { useRef, useState } from "react";
import { FileText, Printer } from "lucide-react";
import { Button, Dialog, Field } from "@/components/ui";
import type { PerformanceContract, PerformanceContractAcceptance } from "@/lib/performance-agreements";
import { performanceContractDocument, performanceTimestamp } from "@/lib/performance-contract-document";

export function PerformanceContractViewer({ contract, acceptance, draft = false }: { contract: PerformanceContract; acceptance?: PerformanceContractAcceptance; draft?: boolean }) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  return <>
    <Button variant="secondary" onClick={() => { setReady(false); setOpen(true); }}><FileText size={16} /> {draft ? "Conferir documento antes de assinar" : "Abrir documento"} · Revisão {contract.agreement_version}</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title="Documento do Acordo de Performance" description={`${contract.snapshot.cycle} · Revisão ${contract.agreement_version}`} wide>
      <p>{draft ? "Prévia do documento. As assinaturas só serão registradas após a confirmação." : acceptance ? `Assinado pelo liderado em ${performanceTimestamp(acceptance.signed_at)}.` : "Assinado pelo líder. Aguardando assinatura do liderado."}</p>
      <Button disabled={!ready} onClick={() => { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print(); }}><Printer size={16} /> Imprimir / Salvar em PDF</Button>
      <iframe ref={frame} onLoad={() => setReady(true)} title="Documento completo do acordo" className="performance-document-frame" sandbox="allow-same-origin allow-modals" srcDoc={performanceContractDocument(contract, acceptance, draft)} />
    </Dialog>
  </>;
}

export function PerformanceSignatureForm({ kind, busy, onSign }: { kind: "leader" | "report"; busy: boolean; onSign: (name: string, location?: { description: string; latitude?: number; longitude?: number }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [location, setLocation] = useState("");
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number }>();
  const [locationStatus, setLocationStatus] = useState("");
  const [locating, setLocating] = useState(false);
  function locate() {
    if (!navigator.geolocation) { setLocationStatus("Localização indisponível. Informe sua cidade e UF no campo acima."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(position => {
      setCoordinates({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      setLocationStatus("Coordenadas obtidas com sua autorização. Informe também a cidade e UF.");
      setLocating(false);
    }, () => { setLocationStatus("Não foi possível obter a localização. Informe sua cidade e UF para assinar."); setLocating(false); }, { timeout: 10000, maximumAge: 0 });
  }
  return <div className="performance-sign-form">
    <Field label="Assinatura — nome completo"><input value={name} onChange={event => setName(event.target.value)} minLength={3} maxLength={200} autoComplete="name" disabled={busy} /></Field>
    {kind === "report" ? <>
      <Field label="Local da assinatura (cidade / UF)" hint="O local informado e, se você autorizar, as coordenadas ficarão registrados no documento."><input value={location} onChange={event => setLocation(event.target.value)} maxLength={200} disabled={busy} placeholder="Ex.: Salvador / BA" /></Field>
      <Button variant="secondary" disabled={busy || locating} onClick={locate}>{locating ? "Obtendo localização…" : "Registrar também a localização do dispositivo"}</Button>
      {locationStatus ? <p role="status">{locationStatus}</p> : null}
    </> : null}
    <label><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} /> {kind === "leader" ? "Li os entregáveis e os compromissos do documento abaixo e confirmo a emissão deste acordo como líder direto." : "Abri e li o documento integral do acordo, compreendi os entregáveis, os prazos e os compromissos e aceito esta revisão."}</label>
    <Button disabled={busy || locating || !accepted || name.trim().length < 3 || kind === "report" && location.trim().length < 2} onClick={() => void onSign(name.trim(), kind === "report" ? { description: location.trim(), ...coordinates } : undefined)}>{kind === "leader" ? "Emitir e assinar documento" : "Assinar acordo"}</Button>
  </div>;
}
