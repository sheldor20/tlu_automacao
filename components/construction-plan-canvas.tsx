"use client";

import type { PlanMeasurementType, PlanPath, PlanPoint } from "@/lib/construction-plan-geometry";
import { LoaderCircle, Minus, MousePointer2, Plus, Maximize2, Minimize2, Check, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type ConstructionPlanOverlay = {
  id: string;
  color: string;
  measurementType: PlanMeasurementType;
  plannedPaths: PlanPath[];
  executedPaths: PlanPath[];
  active?: boolean;
};

type DrawingMode = "navigate" | "calibrate" | "linear" | "area";

function svgPath(path: PlanPath, close = false) {
  if (!path.length) return "";
  return `${path.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ")}${close ? " Z" : ""}`;
}

export function ConstructionPlanCanvas({
  documentUrl,
  pageNumber = 1,
  overlays,
  mode = "navigate",
  drawingColor = "#31523f",
  calibrationPoints = [],
  onCalibrationPoint,
  onFinishPath,
  onAspectRatio,
  resetKey = 0,
  compact = false,
  actions,
}: {
  documentUrl: string;
  pageNumber?: number;
  overlays: ConstructionPlanOverlay[];
  mode?: DrawingMode;
  drawingColor?: string;
  calibrationPoints?: PlanPoint[];
  onCalibrationPoint?: (point: PlanPoint) => void;
  onFinishPath?: (path: PlanPath) => void;
  onAspectRatio?: (aspectRatio: number) => void;
  resetKey?: number;
  compact?: boolean;
  actions?: React.ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const drawingRef = useRef(false);
  const pathRef = useRef<PlanPath>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const activeMode = navigating ? "navigate" : mode;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ distance: number; zoom: number } | null>(null);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", escape);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", escape); };
  }, [expanded]);
  const [aspectRatio, setAspectRatio] = useState(0.65);
  const draftIdentity = `${documentUrl}:${resetKey}:${activeMode}`;
  const [draft, setDraft] = useState<{ identity: string; path: PlanPath }>({ identity: draftIdentity, path: [] });
  const draftPath = draft.identity === draftIdentity ? draft.path : [];
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(compact ? 1.15 : 1);

  useEffect(() => {
    let disposed = false;
    let renderTask: { cancel(): void; promise: Promise<unknown> } | null = null;
    let loadingTask: { destroy(): Promise<void>; promise: Promise<unknown> } | null = null;
    async function renderPdf() {
      setLoading(true);
      setError(null);
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        loadingTask = pdfjs.getDocument({ url: documentUrl, withCredentials: false }) as typeof loadingTask;
        const pdf = await loadingTask!.promise as { getPage(page: number): Promise<{ getViewport(options: { scale: number }): { width: number; height: number }; render(options: unknown): { cancel(): void; promise: Promise<unknown> } }> };
        const page = await pdf.getPage(pageNumber);
        if (disposed) return;
        const initial = page.getViewport({ scale: 1 });
        const targetWidth = compact ? 1300 : 1800;
        const viewport = page.getViewport({ scale: targetWidth / initial.width });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas indisponível.");
        const ratio = viewport.height / viewport.width;
        setAspectRatio(ratio);
        onAspectRatio?.(ratio);
        renderTask = page.render({ canvas, canvasContext: context, viewport });
        await renderTask.promise;
      } catch (renderError) {
        if (!disposed) setError(renderError instanceof Error ? renderError.message : "Não foi possível abrir esta prancha.");
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    void renderPdf();
    return () => {
      disposed = true;
      renderTask?.cancel();
      void loadingTask?.destroy();
    };
  }, [compact, documentUrl, onAspectRatio, pageNumber]);

  const calibrationLine = useMemo(() => calibrationPoints.length === 2 ? svgPath(calibrationPoints) : "", [calibrationPoints]);

  function coordinate(event: React.PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(aspectRatio, (event.clientY - bounds.top) / bounds.width)),
    };
  }

  function finishDraft() {
    const path = draft.identity === draftIdentity ? pathRef.current : [];
    if (path.length < (mode === "area" ? 3 : 2)) return;
    onFinishPath?.(path);
    pathRef.current = [];
    setDraft({ identity: draftIdentity, path: [] });
  }

  function pointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (activeMode === "navigate" || loading || error || !event.isPrimary) return;
    const point = coordinate(event);
    if (activeMode === "calibrate") { onCalibrationPoint?.(point); return; }
    // Touch users place precise vertices; mouse and pen retain freehand drawing.
    if (event.pointerType === "touch") {
      const previous = draft.identity === draftIdentity ? pathRef.current : [];
      pathRef.current = [...previous, point];
      setDraft({ identity: draftIdentity, path: pathRef.current });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    pathRef.current = [point];
    setDraft({ identity: draftIdentity, path: pathRef.current });
  }

  function pointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!drawingRef.current || activeMode === "navigate" || activeMode === "calibrate") return;
    const point = coordinate(event);
    const previous = pathRef.current.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.0015) {
      pathRef.current = [...pathRef.current, point];
      setDraft({ identity: draftIdentity, path: pathRef.current });
    }
  }

  function pointerUp(event: React.PointerEvent<SVGSVGElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    finishDraft();
  }

  function navigationDown(event: React.PointerEvent<HTMLDivElement>) {
    if (activeMode !== "navigate") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  }

  function navigationMove(event: React.PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous || activeMode !== "navigate") return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.current.distance > 0) setZoom(Math.max(1, Math.min(8, gesture.current.zoom * distance / gesture.current.distance)));
    } else {
      event.currentTarget.scrollLeft -= event.clientX - previous.x;
      event.currentTarget.scrollTop -= event.clientY - previous.y;
    }
  }

  function navigationUp(event: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <div className={`construction-plan-canvas-shell ${compact ? "is-compact" : ""} ${expanded ? "is-expanded" : ""}`}>
    <div className="construction-plan-canvas-toolbar">
      <span><MousePointer2 size={15} /> {activeMode === "navigate" ? "Arraste para navegar; use dois dedos para ampliar" : mode === "navigate" ? "Navegue pela planta" : mode === "calibrate" ? "Marque dois pontos" : mode === "area" ? "Contorne a área" : "Trace sobre o trecho"}</span>
      <div><button type="button" onClick={() => setZoom((value) => Math.max(1, value - 0.5))} aria-label="Diminuir zoom"><Minus size={15} /></button><strong>{Math.round(zoom * 100)}%</strong><button type="button" onClick={() => setZoom((value) => Math.min(8, value + 0.5))} aria-label="Aumentar zoom"><Plus size={15} /></button><button type="button" aria-label="Ajustar planta à tela" onClick={() => { setZoom(1); scrollRef.current?.scrollTo(0, 0); }}>1:1</button><button type="button" aria-label={expanded ? "Sair da tela cheia" : "Abrir em tela cheia"} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button></div>
    </div>
    {mode !== "navigate" ? <div className="plan-touch-tools"><button type="button" aria-pressed={navigating} onClick={() => { if (draftPath.length) return; setNavigating(!navigating); }}>{navigating ? "Marcar trecho" : "Mover / zoom"}</button><span>{draftPath.length ? `${draftPath.length} pontos · conclua antes de mover` : "Para marcar no celular, toque nos pontos do trecho"}</span>{draftPath.length ? <><button type="button" aria-label="Desfazer ponto" onClick={() => { pathRef.current = pathRef.current.slice(0, -1); setDraft({ identity: draftIdentity, path: pathRef.current }); }}><Undo2 size={18} /></button><button type="button" disabled={draftPath.length < (mode === "area" ? 3 : 2)} onClick={finishDraft}><Check size={18} /> Concluir</button></> : null}</div> : null}
    <div ref={scrollRef} className={`construction-plan-scroll ${activeMode === "navigate" ? "is-panning" : ""}`} onPointerDown={navigationDown} onPointerMove={navigationMove} onPointerUp={navigationUp} onPointerCancel={navigationUp}>
      <div className="construction-plan-page" style={{ width: `${zoom * 100}%`, aspectRatio: `${1 / aspectRatio}` }}>
        <canvas ref={canvasRef} />
        <svg
          ref={overlayRef}
          viewBox={`0 0 1 ${aspectRatio}`}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={() => { drawingRef.current = false; pathRef.current = []; setDraft({ identity: draftIdentity, path: [] }); }}
          className={activeMode === "navigate" ? "is-navigation" : "is-drawing"}
          aria-label="Área de medição da planta"
        >
          {overlays.map((overlay) => <g key={overlay.id} opacity={overlay.active ? 1 : 0.58}>
            {overlay.plannedPaths.map((path, index) => <path key={`planned-${index}`} d={svgPath(path, overlay.measurementType === "area")} fill={overlay.measurementType === "area" ? overlay.color : "none"} fillOpacity={overlay.measurementType === "area" ? 0.1 : 0} stroke={overlay.color} strokeOpacity={0.58} strokeWidth={overlay.active ? 4.5 : 3} strokeDasharray="9 6" vectorEffect="non-scaling-stroke" />)}
            {overlay.executedPaths.map((path, index) => <path key={`executed-${index}`} d={svgPath(path, overlay.measurementType === "area")} fill={overlay.measurementType === "area" ? overlay.color : "none"} fillOpacity={overlay.measurementType === "area" ? 0.28 : 0} stroke={overlay.color} strokeWidth={overlay.active ? 7 : 5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
          </g>)}
          {calibrationLine ? <path d={calibrationLine} fill="none" stroke="#286083" strokeWidth={4} strokeDasharray="7 5" vectorEffect="non-scaling-stroke" /> : null}
          {calibrationPoints.map((point, index) => <g key={`calibration-${index}`}><circle cx={point.x} cy={point.y} r={0.006} fill="#286083" /><text x={point.x + 0.009} y={point.y - 0.009} className="plan-point-label">{index + 1}</text></g>)}
          {draftPath.length ? <path d={svgPath(draftPath, mode === "area")} fill={mode === "area" ? drawingColor : "none"} fillOpacity={0.18} stroke={drawingColor} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /> : null}
        </svg>
        {loading ? <div className="construction-plan-loading"><LoaderCircle className="spin" /><span>Abrindo prancha…</span></div> : null}
        {error ? <div className="construction-plan-error">Não foi possível renderizar o PDF.<small>{error}</small></div> : null}
      </div>
    </div>
    {actions ? <div className="plan-canvas-footer">{actions}</div> : null}
  </div>;
}
