"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { businessOriginDestination } from "@/lib/business-origin";

export function BusinessOrigin({ id }: { id: string }) {
  const router = useRouter();
  const supabase = getSupabase();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function locate() {
      try {
        if (!supabase) throw new Error("session_unavailable");
        // The caller's existing RLS decides whether this business is visible.
        const result = await supabase.from("businesses").select("stage").eq("id", id).maybeSingle();
        if (result.error || !result.data) throw new Error("business_unavailable");
        const href = businessOriginDestination(id, result.data.stage);
        if (!href) throw new Error("stage_unavailable");
        if (active) router.replace(href);
      } catch {
        if (active) setError("Não foi possível abrir o negócio de origem. Verifique sua permissão em Novos Negócios ou peça a um responsável para definir o vínculo principal.");
      }
    }
    void locate();
    return () => { active = false; };
  }, [id, router, supabase]);
  return <section className="content-card">
    <h1>Negócio de origem</h1>
    {error ? <p role="alert">{error}</p> : <p role="status">Localizando o negócio de origem…</p>}
    <Link href="/obras">Voltar para Obras</Link>
  </section>;
}
