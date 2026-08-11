import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

const departmentSchema = z.enum(["novos-negocios", "obras", "projetos", "alugueis"]);

const createUserSchema = z.object({
  full_name: z.string().trim().min(2).max(140),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(72),
  active: z.boolean().default(true),
  is_admin: z.boolean().default(false),
  departments: z.array(departmentSchema).max(4),
}).superRefine((data, context) => {
  if (!data.is_admin && data.departments.length === 0) {
    context.addIssue({ code: "custom", path: ["departments"], message: "department_required" });
  }
});

const updateUserSchema = z.object({
  user_id: z.string().uuid(),
  full_name: z.string().trim().min(2).max(140),
  active: z.boolean(),
  is_admin: z.boolean(),
  departments: z.array(departmentSchema).max(4),
}).superRefine((data, context) => {
  if (data.active && !data.is_admin && data.departments.length === 0) {
    context.addIssue({ code: "custom", path: ["departments"], message: "department_required" });
  }
});

type AdminContext = {
  caller: User;
  service: SupabaseClient;
};

async function requireAdmin(request: Request): Promise<AdminContext | NextResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Configure SUPABASE_SERVICE_ROLE_KEY no Vercel para administrar usuários." },
      { status: 503 },
    );
  }
  if (!token) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });

  const sessionClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await sessionClient.auth.getUser(token);
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("active,is_admin")
    .eq("user_id", authData.user.id)
    .single();

  if (profileError || !profile?.active || !profile.is_admin) {
    return NextResponse.json({ error: "Apenas administradores podem gerenciar usuários." }, { status: 403 });
  }

  return { caller: authData.user, service };
}

async function replaceDepartments(service: SupabaseClient, userId: string, departments: string[]) {
  const { error: deleteError } = await service
    .from("profile_departments")
    .delete()
    .eq("user_id", userId);
  if (deleteError) throw deleteError;

  if (departments.length === 0) return;
  const { error: insertError } = await service.from("profile_departments").insert(
    [...new Set(departments)].map((department_slug) => ({
      user_id: userId,
      department_slug,
      access_level: "member",
    })),
  );
  if (insertError) throw insertError;
}

export async function POST(request: Request) {
  const context = await requireAdmin(request);
  if (context instanceof NextResponse) return context;

  const parsed = createUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Preencha nome, e-mail, senha de ao menos 8 caracteres e um departamento." },
      { status: 400 },
    );
  }

  const { full_name, email, password, active, is_admin, departments } = parsed.data;
  const { data: created, error: createError } = await context.service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (createError || !created.user) {
    const message = createError?.message.toLowerCase().includes("already")
      ? "Já existe um usuário com este e-mail."
      : createError?.message || "Não foi possível criar o usuário.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const { error: profileError } = await context.service.from("profiles").upsert({
      user_id: created.user.id,
      full_name,
      email,
      active,
      is_admin,
    });
    if (profileError) throw profileError;
    await replaceDepartments(context.service, created.user.id, departments);
    if (!active) {
      await context.service.auth.admin.updateUserById(created.user.id, { ban_duration: "876000h" });
    }
  } catch (error) {
    await context.service.auth.admin.deleteUser(created.user.id);
    const message = error instanceof Error ? error.message : "Não foi possível salvar as permissões.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, user_id: created.user.id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const context = await requireAdmin(request);
  if (context instanceof NextResponse) return context;

  const parsed = updateUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Revise os dados e selecione ao menos um departamento." }, { status: 400 });
  }

  const { user_id, full_name, active, is_admin, departments } = parsed.data;
  const { data: current, error: currentError } = await context.service
    .from("profiles")
    .select("is_admin,active")
    .eq("user_id", user_id)
    .single();
  if (currentError || !current) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

  if (current.is_admin && current.active && (!is_admin || !active)) {
    const { count } = await context.service
      .from("profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("is_admin", true)
      .eq("active", true);
    if ((count || 0) <= 1) {
      return NextResponse.json(
        { error: "Mantenha ao menos um administrador ativo no sistema." },
        { status: 409 },
      );
    }
  }

  const { error: authUpdateError } = await context.service.auth.admin.updateUserById(user_id, {
    user_metadata: { full_name },
    ban_duration: active ? "none" : "876000h",
  });
  if (authUpdateError) return NextResponse.json({ error: authUpdateError.message }, { status: 400 });

  const { error: profileError } = await context.service
    .from("profiles")
    .update({ full_name, active, is_admin })
    .eq("user_id", user_id);
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });

  try {
    await replaceDepartments(context.service, user_id, departments);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível atualizar os departamentos.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, caller_id: context.caller.id });
}
