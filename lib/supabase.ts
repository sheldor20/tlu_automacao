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
  let message = "";

  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else if (error && typeof error === "object") {
    const supabaseError = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };
    const parts = [supabaseError.message, supabaseError.details, supabaseError.hint]
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      .map((value) => value.trim());

    message = [...new Set(parts)].join(" ");
    if (!message && typeof supabaseError.code === "string") {
      message = `Código ${supabaseError.code}`;
    }
  } else {
    message = String(error || "");
  }

  if (message.includes("Invalid login credentials")) return "E-mail ou senha incorretos.";
  if (message.includes("Email not confirmed")) return "Confirme seu e-mail antes de entrar.";
  if (message.includes("duplicate key")) return "Esse registro já existe.";
  if (message.includes("evidence_required")) {
    return "Anexe uma nova evidência antes de atualizar o avanço.";
  }
  if (message.includes("business_name_immutable")) {
    return "O nome do negócio não pode ser alterado.";
  }
  if (message.includes("business_project_required")) {
    return "Selecione um projeto ativo ou concluído para criar o negócio.";
  }
  if (message.includes("business_project_not_eligible")) {
    return "O projeto selecionado precisa estar ativo ou concluído e não pode estar arquivado.";
  }
  if (message.includes("profile_required") || message.includes("profile_not_available")) {
    return "Selecione um usuário ativo cadastrado no Supabase.";
  }
  if (message.includes("invalid_supplies")) {
    return "Revise os insumos: preencha o nome, use valores positivos e mantenha a quantidade utilizada menor ou igual à quantidade total.";
  }
  if (message.includes("construction_template_not_available") || message.includes("project_template_not_available")) {
    return "O modelo selecionado não está disponível para este tipo de registro.";
  }
  if (message.includes("construction_already_structured")) {
    return "Esta obra já possui etapas. O modelo só pode ser aplicado a uma estrutura vazia.";
  }
  if (message.includes("department_access_required")) {
    return "Seu usuário não possui acesso a este departamento.";
  }
  if (message.includes("project_move_access_required")) {
    return "Seu usuário não possui permissão para mover este projeto.";
  }
  if (message.includes("project_target_access_required")) {
    return "Seu usuário não possui permissão para criar projetos na área de destino.";
  }
  if (message.includes("management_indicator_values") || message.includes("management_business_funnel_snapshot")) {
    return "A base de indicadores ainda não foi instalada. Execute a migration de indicadores no Supabase.";
  }
  if (message.includes("migration_requires_postgres_role")) {
    return "Execute a migration no Supabase usando a role postgres.";
  }
  if (message.includes("rented_requires_start_date")) {
    return "Informe o início da locação antes de marcar o imóvel como alugado.";
  }
  if (message.includes("commission_not_above_rent")) {
    return "A comissão mensal não pode ser maior que o valor da locação.";
  }
  if (message.includes("valid_rental_date")) {
    return "O término da locação deve ser posterior ao início.";
  }
  if (message.includes("permission denied") || message.includes("row-level security")) {
    return "Seu usuário não possui acesso a este departamento ou ação.";
  }
  if (message.includes("violates foreign key constraint") && message.includes("project_id")) {
    return "Este projeto possui um negócio vinculado. Arquive-o para preservar o histórico.";
  }
  return message || "Não foi possível concluir. Tente novamente.";
}
