import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (browserClient !== undefined) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key || url.includes("seu-projeto")) {
    browserClient = null;
    return browserClient;
  }

  browserClient = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return browserClient;
}

export function storagePath(
  scopeId: string,
  originalName: string,
  prefix = "files",
) {
  const extension = originalName.split(".").pop()?.toLowerCase() || "bin";
  const safeExtension = extension.replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  return `${scopeId}/${prefix}/${crypto.randomUUID()}.${safeExtension}`;
}

export function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (message.includes("Invalid login credentials")) return "E-mail ou senha incorretos.";
  if (message.includes("Email not confirmed")) return "Confirme seu e-mail antes de entrar.";
  if (message.includes("duplicate key")) return "Esse registro já existe.";
  if (message.includes("evidence_required")) {
    return "Anexe uma nova evidência antes de atualizar o avanço.";
  }
  if (message.includes("business_name_immutable")) {
    return "O nome do negócio não pode ser alterado.";
  }
  return message || "Não foi possível concluir. Tente novamente.";
}
