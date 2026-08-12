"use client";

import { MANAGEMENT_AREAS } from "@/lib/constants";
import { getSupabase } from "@/lib/supabase";
import type { ManagementAreaSlug } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function IndicatorsPage() {
  const router = useRouter();
  const supabase = getSupabase();

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!active || !data.user) return;
      const [profileResult, accessResult] = await Promise.all([
        supabase.from("profiles").select("is_admin").eq("user_id", data.user.id).single(),
        supabase.from("profile_indicator_areas").select("area").eq("user_id", data.user.id),
      ]);
      if (!active) return;
      const firstArea = profileResult.data?.is_admin
        ? MANAGEMENT_AREAS[0].slug
        : accessResult.data?.[0]?.area as ManagementAreaSlug | undefined;
      router.replace(firstArea ? `/indicadores/${firstArea}` : "/hoje");
    });
    return () => { active = false; };
  }, [router, supabase]);

  return <div className="detail-loading">Abrindo sua primeira visão autorizada…</div>;
}
