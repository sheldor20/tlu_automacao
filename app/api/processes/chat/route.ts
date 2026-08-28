import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const payloadSchema = z.object({ processId: z.string().uuid(), question: z.string().trim().min(2).max(1200) });

function outputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof response.output_text === "string") return response.output_text;
  return (response.output || []).flatMap((item) => item.content || []).filter((item) => item.type === "output_text").map((item) => item.text || "").join("");
}

function fallbackAnswer(question: string, processData: Record<string, unknown>, steps: Array<Record<string, unknown>>) {
  const tokens = question.toLocaleLowerCase("pt-BR").split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 4);
  const sources = [
    { label: "Objetivo", text: String(processData.objective || "") },
    ...((processData.rules as string[] | null) || []).map((text, index) => ({ label: `Regra ${index + 1}`, text })),
    ...((processData.policies as string[] | null) || []).map((text, index) => ({ label: `Política ${index + 1}`, text })),
    ...steps.map((step, index) => ({ label: `Etapa ${index + 1} · ${String(step.title || "")}`, text: [step.description, step.business_rule, step.responsible_role].filter(Boolean).join(" · ") })),
  ].map((source) => ({ ...source, score: tokens.reduce((score, token) => score + (source.text.toLocaleLowerCase("pt-BR").includes(token) ? 1 : 0), 0) }))
    .filter((source) => source.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (!sources.length) return "Não encontrei essa informação no processo publicado. Consulte o responsável pelo processo ou peça que a regra seja registrada no catálogo.";
  return sources.map((source) => `${source.label}: ${source.text}`).join("\n\n");
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!supabaseUrl || !anonKey) return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  if (!token) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Selecione um processo e escreva sua dúvida." }, { status: 400 });

  const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: auth } = await supabase.auth.getUser(token);
  if (!auth.user) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  const [processResult, stepResult] = await Promise.all([
    supabase.from("business_processes").select("id,title,area,objective,rules,policies,status").eq("id", parsed.data.processId).single(),
    supabase.from("business_process_steps").select("title,description,responsible_role,business_rule,position").eq("process_id", parsed.data.processId).order("position"),
  ]);
  if (processResult.error || !processResult.data) return NextResponse.json({ error: "Processo indisponível para este usuário." }, { status: 404 });
  if (stepResult.error) return NextResponse.json({ error: stepResult.error.message }, { status: 502 });

  const processData = processResult.data as Record<string, unknown>;
  const steps = (stepResult.data || []) as Array<Record<string, unknown>>;
  const context = { process: processData, steps };
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.OPENAI_PROCESS_MODEL || "gpt-5.6",
          instructions: "Você é o assistente de processos da Terra Lótus. Responda em português do Brasil, de forma direta, usando exclusivamente o processo fornecido. Cite o nome da regra, política ou etapa usada. Se a resposta não estiver no conteúdo, diga claramente que a informação não está registrada. Nunca invente uma regra.",
          input: `DÚVIDA: ${parsed.data.question}\n\nPROCESSO: ${JSON.stringify(context).slice(0, 80_000)}`,
          max_output_tokens: 1200,
          store: false,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) {
        const answer = outputText(await response.json()).trim();
        if (answer) return NextResponse.json({ answer, usedAi: true });
      }
    } catch { /* usa a busca local abaixo */ }
  }
  return NextResponse.json({ answer: fallbackAnswer(parsed.data.question, processData, steps), usedAi: false });
}
