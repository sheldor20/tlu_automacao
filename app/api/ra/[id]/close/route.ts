import { createClient } from "@supabase/supabase-js";
import { isValidEmailAddress, isValidEmailSender, validUniqueRecipients } from "@/lib/ra";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

function escapeHtml(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function dateTimeBr(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const meetingId = idSchema.safeParse((await context.params).id);
  if (!meetingId.success) return NextResponse.json({ error: "RA inválida." }, { status: 400 });
  if (!supabaseUrl || !anonKey || !serviceKey) {
    const missing = [!supabaseUrl ? "NEXT_PUBLIC_SUPABASE_URL" : null, !anonKey ? "NEXT_PUBLIC_SUPABASE_ANON_KEY" : null, !serviceKey ? "SUPABASE_SERVICE_ROLE_KEY" : null].filter(Boolean).join(", ");
    return NextResponse.json({ error: `Configuração do servidor incompleta. Variáveis ausentes: ${missing}.` }, { status: 503 });
  }
  if (!token) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });

  const session = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: auth } = await session.auth.getUser(token);
  if (!auth.user) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const [{ data: profile }, { data: department }, { data: meeting }] = await Promise.all([
    service.from("profiles").select("active,is_admin,full_name,email").eq("user_id", auth.user.id).single(),
    service.from("profile_departments").select("department_slug").eq("user_id", auth.user.id).eq("department_slug", "pauta-ra").maybeSingle(),
    service.from("ra_meetings").select("*").eq("id", meetingId.data).single(),
  ]);
  if (!profile?.active || !meeting) return NextResponse.json({ error: "RA não encontrada." }, { status: 404 });
  if (!profile.is_admin && !department) return NextResponse.json({ error: "Acesso a Pauta e RA não autorizado." }, { status: 403 });
  if (!profile.is_admin && meeting.leader_user_id !== auth.user.id) return NextResponse.json({ error: "Somente o líder desta RA pode encerrá-la." }, { status: 403 });
  if (meeting.status === "encerrada") return NextResponse.json({ ok: true, alreadyClosed: true, emailSent: false, recipientCount: 0, emailWarning: "Esta RA já estava encerrada." });

  const [participantResult, sectionResult, projectResult, decisionResult] = await Promise.all([
    service.from("ra_participants").select("user_id,attended").eq("meeting_id", meeting.id),
    service.from("ra_agenda_sections").select("*").eq("meeting_id", meeting.id).order("position"),
    service.from("ra_meeting_projects").select("project_id").eq("meeting_id", meeting.id),
    service.from("ra_decisions").select("*").eq("meeting_id", meeting.id).order("decided_at"),
  ]);
  const participants = participantResult.data || [];
  const sections = sectionResult.data || [];
  const sectionIds = sections.map((section) => section.id);
  const projectIds = [...new Set([...(projectResult.data || []).map((item) => item.project_id), ...sections.map((section) => section.project_id).filter(Boolean)])];
  const [itemResult, profileResult, projectsResult] = await Promise.all([
    sectionIds.length ? service.from("ra_agenda_items").select("*").in("section_id", sectionIds).order("position") : Promise.resolve({ data: [], error: null }),
    participants.length ? service.from("profiles").select("user_id,full_name,email").in("user_id", participants.map((participant) => participant.user_id)) : Promise.resolve({ data: [], error: null }),
    projectIds.length ? service.from("projects").select("id,name").in("id", projectIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const failure = participantResult.error || sectionResult.error || projectResult.error || decisionResult.error || itemResult.error || profileResult.error || projectsResult.error;
  if (failure) return NextResponse.json({ error: failure.message }, { status: 502 });
  const profiles = profileResult.data || [];
  const projects = projectsResult.data || [];
  const items = itemResult.data || [];
  const decisions = decisionResult.data || [];
  const profileName = (id: string | null) => profiles.find((item) => item.user_id === id)?.full_name || profiles.find((item) => item.user_id === id)?.email || "Sem responsável";
  const projectName = (id: string | null) => projects.find((item) => item.id === id)?.name || "";
  const lines = [
    "ATA – REUNIÃO RA",
    `Data: ${dateTimeBr(meeting.scheduled_at)}`,
    `Líder: ${profile.full_name || profile.email}`,
    `Participantes: ${participants.map((participant) => profileName(participant.user_id)).join(", ")}`,
    "",
    "PAUTA E REGISTROS",
    ...sections.flatMap((section, sectionIndex) => {
      const sectionItems = items.filter((item) => item.section_id === section.id);
      return [
        `${sectionIndex + 1}. ${section.title}${section.project_id ? ` – ${projectName(section.project_id)}` : ""}`,
        ...(sectionItems.length ? sectionItems.flatMap((item) => [
          `   • ${item.owner_user_id ? `${profileName(item.owner_user_id)}: ` : ""}${item.content}`,
          ...(item.decision_text ? [`     Definição: ${item.decision_text}`] : []),
          ...(item.task_id ? [`     Tarefa criada${item.due_date ? ` para ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(`${item.due_date}T12:00:00-03:00`))}` : ""}.`] : []),
        ]) : ["   • Sem tópicos registrados."]),
      ];
    }),
    "",
    "CATÁLOGO DE DEFINIÇÕES",
    ...(decisions.length ? decisions.map((decision, index) => `${index + 1}. ${decision.title}: ${decision.decision_text}`) : ["Nenhuma definição formal registrada."]),
  ];
  const minutes = lines.join("\n");
  const recipients = validUniqueRecipients(profiles);
  const invalidRecipientCount = Math.max(0, participants.length - profiles.length) + profiles.filter((item) => !isValidEmailAddress(String(item.email || ""))).length;

  const closedAt = new Date().toISOString();
  const closeResult = await service.from("ra_meetings").update({ status: "encerrada", closed_at: closedAt, minutes_text: minutes }).eq("id", meeting.id).neq("status", "encerrada").select("id").maybeSingle();
  if (closeResult.error) return NextResponse.json({ error: `Não foi possível salvar a ATA e encerrar a RA: ${closeResult.error.message}` }, { status: 502 });
  if (!closeResult.data) return NextResponse.json({ ok: true, alreadyClosed: true, emailSent: false, recipientCount: 0, emailWarning: "Esta RA foi encerrada por outra solicitação." });

  let emailWarning: string | null = null;
  let emailSent = false;
  if (!recipients.length) {
    emailWarning = "Nenhum participante possui e-mail válido; revise os cadastros antes da próxima RA.";
  } else if (!resendKey || !from) {
    const missing = [!resendKey ? "RESEND_API_KEY" : null, !from ? "RESEND_FROM_EMAIL" : null].filter(Boolean).join(" e ");
    emailWarning = `E-mail não enviado. Configure no Vercel: ${missing}.`;
  } else if (!isValidEmailSender(from)) {
    emailWarning = "E-mail não enviado porque RESEND_FROM_EMAIL não contém um endereço válido.";
  } else {
    try {
      const emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          from, to: recipients, subject: `ATA da RA: ${meeting.title}`,
          html: `<!doctype html><html><body style="margin:0;background:#f4f5f1;font-family:Arial,sans-serif;color:#1d241f"><div style="max-width:760px;margin:0 auto;padding:28px 16px"><div style="background:#263329;color:white;padding:24px 28px;border-radius:16px 16px 0 0"><strong style="font-size:18px">TERRA LÓTUS</strong><div style="margin-top:5px;font-size:11px;opacity:.65;letter-spacing:.08em">ATA – REUNIÃO RA</div></div><div style="background:white;padding:28px;border-radius:0 0 16px 16px"><h1 style="font-size:24px;margin:0 0 20px">${escapeHtml(meeting.title)}</h1><div style="white-space:pre-wrap;line-height:1.65;font-size:13px">${escapeHtml(minutes)}</div><p style="margin:25px 0 0;color:#6c756e;font-size:11px">Ata gerada e enviada pelo TLU Space.</p></div></div></body></html>`,
        }),
      });
      const emailData = await emailResponse.json().catch(() => ({}));
      if (!emailResponse.ok) {
        const providerMessage = typeof emailData.message === "string" ? `: ${emailData.message.slice(0, 300)}` : ".";
        emailWarning = `O Resend recusou o envio${providerMessage}`;
      } else {
        emailSent = true;
        if (invalidRecipientCount) emailWarning = `${invalidRecipientCount} participante(s) sem e-mail válido não receberam a ATA.`;
        const dispatchResult = await service.from("ra_email_dispatches").insert({ meeting_id: meeting.id, recipients, provider_id: emailData.id || null, sent_by: auth.user.id });
        if (dispatchResult.error) console.error("RA email sent but dispatch record failed", { meetingId: meeting.id, message: dispatchResult.error.message });
      }
    } catch (error) {
      console.error("RA email delivery failed after closing meeting", { meetingId: meeting.id, message: error instanceof Error ? error.message : String(error) });
      emailWarning = "O serviço de e-mail não respondeu; a ATA permanece salva na RA.";
    }
  }

  return NextResponse.json({ ok: true, emailSent, emailWarning, recipientCount: emailSent ? recipients.length : 0, eligibleRecipientCount: recipients.length, minutes, closedAt });
}
