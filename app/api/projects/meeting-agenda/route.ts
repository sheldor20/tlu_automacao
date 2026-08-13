import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { prioritizeOverdueTasks, type AgendaProject, type MeetingAgenda } from "@/lib/project-meeting-agenda";
import type { Project, ProjectComment, ProjectFile, ProjectTask } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function outputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof response.output_text === "string") return response.output_text;
  return (response.output || []).flatMap((item) => item.content || []).filter((item) => item.type === "output_text").map((item) => item.text || "").join("");
}

async function aiSummaries(projects: Array<Record<string, unknown>>) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MEETING_MODEL || "gpt-5.6",
      instructions: "Você é um assessor executivo. Resuma cada projeto em uma frase curta, factual e acionável em português do Brasil. Não invente dados. Dê atenção a atrasos, próximos prazos, entregas recentes, comentários e arquivos. Responda apenas JSON no formato {\"project_id\":\"resumo\"}.",
      input: JSON.stringify(projects).slice(0, 90_000),
      max_output_tokens: 5000,
    }),
    signal: AbortSignal.timeout(40_000),
  });
  if (!response.ok) return null;
  const raw = outputText(await response.json());
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) as Record<string, string> : null;
  } catch { return null; }
}

export async function GET(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!supabaseUrl || !anonKey || !serviceKey) return NextResponse.json({ error: "Configuração do servidor incompleta." }, { status: 503 });
  if (!token) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });

  const session = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: auth } = await session.auth.getUser(token);
  if (!auth.user) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const [{ data: profile }, { data: permission }] = await Promise.all([
    service.from("profiles").select("active,is_admin").eq("user_id", auth.user.id).single(),
    service.from("profile_project_permissions").select("access_scope").eq("user_id", auth.user.id).maybeSingle(),
  ]);
  if (!profile?.active || (!profile.is_admin && permission?.access_scope !== "full")) {
    return NextResponse.json({ error: "A pauta completa exige acesso completo a Projetos." }, { status: 403 });
  }

  const [projectResult, taskResult, commentResult, fileResult] = await Promise.all([
    service.from("projects").select("*").is("archived_at", null).order("name"),
    service.from("project_tasks").select("*").order("due_date"),
    service.from("project_comments").select("*").order("created_at", { ascending: false }),
    service.from("project_files").select("id,project_id,file_name,mime_type,created_at"),
  ]);
  const firstError = projectResult.error || taskResult.error || commentResult.error || fileResult.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 502 });

  const today = new Date().toISOString().slice(0, 10);
  const projects = (projectResult.data || []) as Project[];
  const tasks = (taskResult.data || []) as ProjectTask[];
  const comments = (commentResult.data || []) as ProjectComment[];
  const files = (fileResult.data || []) as ProjectFile[];
  const priorities = prioritizeOverdueTasks(tasks, projects, today);

  const context = projects.map((project) => {
    const projectTasks = tasks.filter((task) => task.project_id === project.id);
    const projectComments = comments.filter((comment) => comment.project_id === project.id).slice(0, 8);
    const projectFiles = files.filter((file) => file.project_id === project.id).slice(0, 15);
    return {
      project_id: project.id,
      name: project.name,
      objective: project.objective,
      owner: project.owner_name,
      status: project.status,
      tasks: projectTasks.slice(0, 80).map((task) => ({ title: task.title, status: task.status, due_date: task.due_date, assignee: task.assignee_name })),
      recent_updates: projectComments.map((comment) => ({ date: comment.created_at, text: comment.body })),
      files: projectFiles.map((file) => file.file_name),
    };
  });
  const summaries = await aiSummaries(context).catch(() => null);
  const agendaProjects: AgendaProject[] = projects.map((project) => {
    const projectTasks = tasks.filter((task) => task.project_id === project.id);
    const completed = projectTasks.filter((task) => task.status === "concluida").length;
    const projectOverdue = projectTasks.filter((task) => task.status !== "concluida" && task.due_date < today).length;
    const future = projectTasks.filter((task) => task.status !== "concluida" && task.due_date >= today).length;
    const fallback = projectOverdue
      ? `${projectOverdue} tarefa(s) atrasada(s); priorizar regularização dos prazos e responsáveis.`
      : future ? `${future} entrega(s) futura(s) em acompanhamento, sem atraso aberto.` : "Sem tarefas abertas no momento.";
    return {
      id: project.id,
      name: project.name,
      owner_name: project.owner_name,
      status: project.status,
      completed,
      open: projectTasks.length - completed,
      overdue: projectOverdue,
      future,
      file_count: files.filter((file) => file.project_id === project.id).length,
      update_count: comments.filter((comment) => comment.project_id === project.id).length,
      summary: summaries?.[project.id] || fallback,
    };
  });
  const agenda: MeetingAgenda = { generated_at: new Date().toISOString(), used_ai: Boolean(summaries), ...priorities, projects: agendaProjects };
  return NextResponse.json(agenda);
}
