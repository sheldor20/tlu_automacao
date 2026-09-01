"use client";

import { getSupabase } from "@/lib/supabase";
import type { ManagementIndicatorArea } from "@/lib/indicator-refresh";

export type IndicatorRefreshResponse = {
  ok: boolean;
  area: ManagementIndicatorArea;
  message: string;
  error?: string;
  results: Array<{
    key: string;
    label: string;
    ok: boolean;
    status: number;
    duration_ms: number;
    error?: string;
  }>;
};

export async function refreshManagementIndicators(
  area: ManagementIndicatorArea,
): Promise<IndicatorRefreshResponse> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("A conexão com a base não está disponível.");

  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new Error("Sua sessão expirou. Entre novamente.");

  const response = await fetch("/api/indicators/refresh", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ area }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as IndicatorRefreshResponse | { error?: string } | null;

  if (payload && "results" in payload && Array.isArray(payload.results)) {
    return payload;
  }
  if (!response.ok) {
    throw new Error(payload?.error || `Não foi possível atualizar os indicadores (status ${response.status}).`);
  }
  throw new Error("A atualização terminou sem uma resposta válida do servidor.");
}
