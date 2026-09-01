"use client";

import { ManagementDashboard } from "@/components/management-dashboard";
import { refreshManagementIndicators } from "@/lib/indicator-refresh-client";
import type { ManagementIndicatorArea } from "@/lib/indicator-refresh";
import type { ManagementAreaSlug } from "@/lib/types";
import { AlertTriangle, Check, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";

type RefreshNotice = {
  kind: "running" | "success" | "error";
  message: string;
};

function findRefreshButton(root: HTMLDivElement | null) {
  if (!root) return null;
  return Array.from(root.querySelectorAll<HTMLButtonElement>(".management-sync-actions button"))
    .find((button) => button.querySelector(".lucide-refresh-cw")) || null;
}

export function ManagementDashboardRefresh({ area }: { area: ManagementIndicatorArea }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const runningRef = useRef(false);
  const bypassNextClickRef = useRef(false);
  const noticeTimerRef = useRef<number | null>(null);
  const [notice, setNotice] = useState<RefreshNotice | null>(null);

  useEffect(() => () => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
  }, []);

  function showTemporaryNotice(nextNotice: RefreshNotice) {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    setNotice(nextNotice);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 7_000);
  }

  function reloadDashboard() {
    window.setTimeout(() => {
      const refreshButton = findRefreshButton(rootRef.current);
      if (!refreshButton || refreshButton.disabled) return;
      bypassNextClickRef.current = true;
      refreshButton.click();
    }, 350);
  }

  async function handleClickCapture(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>(".management-sync-actions button");
    if (!button || !event.currentTarget.contains(button) || !button.querySelector(".lucide-refresh-cw")) return;

    if (bypassNextClickRef.current) {
      bypassNextClickRef.current = false;
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (runningRef.current) return;

    runningRef.current = true;
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    setNotice({ kind: "running", message: "Atualizando as fontes e buscando os números mais recentes..." });

    try {
      const result = await refreshManagementIndicators(area);
      const failed = result.results.filter((item) => !item.ok);
      if (failed.length > 0) {
        showTemporaryNotice({
          kind: "error",
          message: `${result.message} ${failed.map((item) => `${item.label}: ${item.error || "falha"}`).join(" | ")}`,
        });
      } else {
        showTemporaryNotice({ kind: "success", message: result.message });
      }
    } catch (error) {
      showTemporaryNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Não foi possível atualizar os indicadores.",
      });
    } finally {
      runningRef.current = false;
      reloadDashboard();
    }
  }

  return (
    <>
      <div ref={rootRef} style={{ display: "contents" }} onClickCapture={(event) => void handleClickCapture(event)}>
        <ManagementDashboard area={area as ManagementAreaSlug} />
      </div>
      {notice ? (
        <div className={`toast ${notice.kind === "error" ? "toast-error" : "toast-success"}`} role="status" aria-live="polite">
          {notice.kind === "running" ? <LoaderCircle size={18} className="spin" /> : null}
          {notice.kind === "success" ? <Check size={18} /> : null}
          {notice.kind === "error" ? <AlertTriangle size={18} /> : null}
          <span>{notice.message}</span>
          {notice.kind !== "running" ? (
            <button onClick={() => setNotice(null)} aria-label="Fechar aviso"><X size={16} /></button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
