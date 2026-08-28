import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

const payloadSchema = z.object({
  projectId: z.string().uuid(),
  scope: z.enum(["owner", "all"]),
});

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dateBr(value: string | null) {
  if (!value) return "Sem prazo";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(`${value}T12:00:00-03:00`));
}

function normalizedEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!supabaseUrl || !supabaseKey) return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  if (!resendKey || !from) return NextResponse.json({ error: "Configure RESEND_API_KEY e RESEND_FROM_EMAIL no Vercel para enviar e-mails." }, { status: 503 });
  if (!token) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos para o envio." }, { status: 400 });

  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });

  const { projectId, scope } = parsed.data;
  const permissionResult = await supabase.rpc("has_project_full_access", { p_project_id: projectId });
  if (permissionResult.error) return NextResponse.json({ error: "Não foi possível validar a permissão de envio." }, { status: 502 });
  if (!permissionResult.data) return NextResponse.json({ error: "Somente gestores deste projeto podem enviar o status por e-mail." }, { status: 403 });

  const [projectResult, taskResult, memberResult] = await Promise.all([
    supabase.from("project_progress_summary").select("*").eq("id", projectId).single(),
    supabase.from("project_tasks").select("title,assignee_name,assignee_email,due_date,status").eq("project_id", projectId).order("due_date"),
    supabase.from("project_members").select("email").eq("project_id", projectId),
  ]);
  if (projectResult.error || !projectResult.data) return NextResponse.json({ error: "Projeto não encontrado." }, { status: 404 });
  if (taskResult.error || memberResult.error) return NextResponse.json({ error: "Não foi possível montar a lista de destinatários." }, { status: 502 });

  const project = projectResult.data;
  const tasks = taskResult.data || [];
  const recipientSet = new Set<string>();
  const ownerEmail = normalizedEmail(project.owner_email);
  if (ownerEmail) recipientSet.add(ownerEmail);
  if (scope === "all") {
    (memberResult.data || []).forEach((member) => {
      const email = normalizedEmail(member.email);
      if (email) recipientSet.add(email);
    });
    tasks.forEach((task) => {
      const email = normalizedEmail(task.assignee_email);
      if (email) recipientSet.add(email);
    });
  }
  const recipients = [...recipientSet].slice(0, 50);
  if (!recipients.length) return NextResponse.json({ error: "O projeto não possui destinatários com e-mail válido." }, { status: 422 });
  const completed = tasks.filter((task) => task.status === "concluida");
  const overdue = tasks.filter((task) => task.status !== "concluida" && task.due_date < new Date().toISOString().slice(0, 10));
  const taskRows = tasks.map((task) => `<tr><td style="padding:10px 8px;border-bottom:1px solid #e6e9e5">${escapeHtml(task.title)}</td><td style="padding:10px 8px;border-bottom:1px solid #e6e9e5">${escapeHtml(task.assignee_name)}</td><td style="padding:10px 8px;border-bottom:1px solid #e6e9e5">${dateBr(task.due_date)}</td><td style="padding:10px 8px;border-bottom:1px solid #e6e9e5">${task.status === "concluida" ? "Concluída" : task.status === "em_andamento" ? "Em andamento" : "A fazer"}</td></tr>`).join("");

  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f1;font-family:Arial,sans-serif;color:#1d241f"><div style="max-width:720px;margin:0 auto;padding:28px 16px"><div style="background:#263329;color:white;padding:24px 28px;border-radius:16px 16px 0 0"><strong style="font-size:18px">TERRA LÓTUS</strong><div style="margin-top:5px;font-size:11px;opacity:.65;letter-spacing:.08em">STATUS DO PROJETO</div></div><div style="background:white;padding:28px;border-radius:0 0 16px 16px"><h1 style="font-size:25px;margin:0 0 8px">${escapeHtml(project.name)}</h1><p style="color:#6c756e;line-height:1.5">${escapeHtml(project.objective)}</p><div style="display:flex;gap:10px;flex-wrap:wrap;margin:24px 0"><div style="background:#edf1eb;padding:14px 18px;border-radius:10px"><small>PROGRESSO</small><br><strong style="font-size:21px">${Number(project.progress_percent || 0).toFixed(0)}%</strong></div><div style="background:#edf1eb;padding:14px 18px;border-radius:10px"><small>CONCLUÍDAS</small><br><strong style="font-size:21px">${completed.length}/${tasks.length}</strong></div><div style="background:${overdue.length ? "#fff1e5" : "#edf1eb"};padding:14px 18px;border-radius:10px"><small>ATRASADAS</small><br><strong style="font-size:21px">${overdue.length}</strong></div></div><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="text-align:left;color:#6c756e"><th style="padding:8px">Tarefa</th><th style="padding:8px">Responsável</th><th style="padding:8px">Prazo</th><th style="padding:8px">Status</th></tr></thead><tbody>${taskRows || '<tr><td colspan="4" style="padding:20px 8px;color:#6c756e">Nenhuma tarefa cadastrada.</td></tr>'}</tbody></table><p style="margin:25px 0 0;color:#6c756e;font-size:11px">Mensagem enviada manualmente pelo sistema de Gestão Integrada Terra Lótus.</p></div></div></body></html>`;

  let resendResponse: Response;
  try {
    resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: recipients, subject: `Status do projeto: ${project.name}`, html }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return NextResponse.json({ error: "O provedor de e-mail não respondeu." }, { status: 502 });
  }
  const resendData = await resendResponse.json().catch(() => ({}));
  if (!resendResponse.ok) return NextResponse.json({ error: resendData.message || "Falha no provedor de e-mail." }, { status: 502 });

  const dispatchResult = await supabase.from("email_dispatches").insert({ project_id: projectId, scope, recipients, provider_id: resendData.id || null, sent_by: authData.user.id });
  if (dispatchResult.error) {
    console.error("Project status email sent but dispatch record failed", { projectId, message: dispatchResult.error.message });
    return NextResponse.json({ ok: true, recipientCount: recipients.length, auditRecorded: false, warning: "E-mail enviado, mas o registro de auditoria falhou." });
  }
  return NextResponse.json({ ok: true, recipientCount: recipients.length, auditRecorded: true });
}
