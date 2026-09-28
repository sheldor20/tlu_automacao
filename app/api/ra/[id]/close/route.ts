import { createClient } from "@supabase/supabase-js";
import { isValidEmailAddress, isValidEmailSender, renderRaMinutesEmail, validUniqueRecipients } from "@/lib/ra";
import { MEETING_RITES, meetingType, meetingRecordLines } from "@/lib/meeting-rites";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

function dateTimeBr(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const resendRequested = new URL(request.url).searchParams.get("resend") === "true";
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const meetingId = idSchema.safeParse((await context.params).id);
  if (!meetingId.success) return NextResponse.json({ error: "Reunião inválida." }, { status: 400 });
  if (!supabaseUrl || !anonKey || !serviceKey) {
    const missing = [!supabaseUrl ? "NEXT_PUBLIC_SUPABASE_URL" : null, !anonKey ? "NEXT_PUBLIC_SUPABASE_ANON_KEY" : null, !serviceKey ? "SUPABASE_SERVICE_ROLE_KEY" : null].filter(Boolean).join(", ");
    return NextResponse.json({ error: `Configuração do servidor incompleta. Variáveis ausentes: ${missing}.` }, { status: 503 });
  }
  if (!token) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });

  const session = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: auth } = await session.auth.getUser(token);
  if (!auth.user) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  // Use the caller's RLS for the meeting before any privileged lookup or email.
  // Administrators outside a 1:1 must never read or send its contents.
  const [{ data: profile }, { data: authorized, error: accessError }, { data: meeting }] = await Promise.all([
    session.from("profiles").select("active,is_admin,full_name,email").eq("user_id", auth.user.id).single(),
    session.rpc("can_administer_ra_meeting", { p_meeting_id: meetingId.data }),
    session.from("ra_meetings").select("*").eq("id", meetingId.data).single(),
  ]);
  if (!profile?.active || !meeting) return NextResponse.json({ error: "Reunião não encontrada." }, { status: 404 });
  if (accessError || !authorized) return NextResponse.json({ error: "Você não tem permissão para finalizar ou reenviar a ata desta reunião." }, { status: 403 });
  const type = meetingType(meeting.meeting_type);
  if (meeting.archived_at) return NextResponse.json({ error: "Restaure a reunião arquivada antes de encerrar ou reenviar a ATA." }, { status: 409 });
  if (meeting.status === "encerrada" && !resendRequested) return NextResponse.json({ ok: true, alreadyClosed: true, emailSent: false, recipientCount: 0, emailWarning: "Esta reunião já estava encerrada." });

  const [participantResult, sectionResult, projectResult, decisionResult] = await Promise.all([
    session.from("ra_participants").select("user_id,attended").eq("meeting_id", meeting.id),
    session.from("ra_agenda_sections").select("*").eq("meeting_id", meeting.id).order("position"),
    session.from("ra_meeting_projects").select("project_id").eq("meeting_id", meeting.id),
    session.from("ra_decisions").select("*").eq("meeting_id", meeting.id).order("decided_at"),
  ]);
  const participants = participantResult.data || [];
  const sections = sectionResult.data || [];
  const sectionIds = sections.map((section) => section.id);
  const projectIds = [...new Set([...(projectResult.data || []).map((item) => item.project_id), ...sections.map((section) => section.project_id).filter(Boolean)])];
  const [itemResult, profileResult, projectsResult, memberResult, departmentResult] = await Promise.all([
    sectionIds.length ? session.from("ra_agenda_items").select("*").in("section_id", sectionIds).order("position") : Promise.resolve({ data: [], error: null }),
    service.from("profiles").select("user_id,full_name,email,active,is_admin").in("user_id", [...new Set([meeting.leader_user_id, ...participants.map(participant => participant.user_id)])]),
    projectIds.length ? session.from("projects").select("id,name").in("id", projectIds) : Promise.resolve({ data: [], error: null }),
    type === "1:1" ? Promise.resolve({ data: [], error: null }) : session.from("ra_meeting_type_members").select("user_id").eq("meeting_type", type),
    service.from("profile_departments").select("user_id").eq("department_slug", "pauta-ra").in("user_id", [...new Set([meeting.leader_user_id, ...participants.map(participant => participant.user_id)])]),
  ]);
  const failure = participantResult.error || sectionResult.error || projectResult.error || decisionResult.error || itemResult.error || profileResult.error || projectsResult.error || memberResult.error || departmentResult.error;
  if (failure) return NextResponse.json({ error: failure.message }, { status: 502 });
  const profiles = profileResult.data || [];
  const projects = projectsResult.data || [];
  const items = itemResult.data || [];
  const decisions = decisionResult.data || [];
  const profileName = (id: string | null) => profiles.find((item) => item.user_id === id)?.full_name || profiles.find((item) => item.user_id === id)?.email || "Sem responsável";
  const projectName = (id: string | null) => projects.find((item) => item.id === id)?.name || "";
  const lines = [
    `ATA – ${type} · ${MEETING_RITES[type].name}`,
    `Reunião: ${meeting.title}`,
    `Data: ${dateTimeBr(meeting.scheduled_at)}`,
    `Líder: ${profileName(meeting.leader_user_id)}`,
    `Participantes: ${participants.map((participant) => profileName(participant.user_id)).join(", ")}`,
    "",
    ...meetingRecordLines(type, meeting.record_data || {}),
    "PAUTA E REGISTROS",
    ...sections.flatMap((section, sectionIndex) => {
      const sectionItems = items.filter((item) => item.section_id === section.id);
      return [
        `${sectionIndex + 1}. ${section.title}${section.project_id ? ` – ${projectName(section.project_id)}` : ""}`,
        ...(sectionItems.length ? sectionItems.flatMap((item) => {
          const itemDecisions = decisions.filter((decision) => decision.item_id === item.id);
          return [
            `   • ${item.owner_user_id ? `${profileName(item.owner_user_id)}: ` : ""}${item.content}`,
            ...itemDecisions.map((decision, decisionIndex) => `     Definição ${decisionIndex + 1}: ${decision.decision_text}`),
            ...(item.due_date ? [`     Prazo: ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(`${item.due_date.slice(0, 10)}T12:00:00-03:00`))}`] : []),
            ...(item.task_id ? [`     Tarefa criada${item.due_date ? ` para ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(`${item.due_date.slice(0, 10)}T12:00:00-03:00`))}` : ""}.`] : []),
          ];
        }) : ["   • Sem tópicos registrados."]),
      ];
    }),
    "",
    "CATÁLOGO DE DEFINIÇÕES",
    ...(decisions.length ? decisions.map((decision, index) => `${index + 1}. ${decision.title}: ${decision.decision_text}`) : ["Nenhuma definição formal registrada."]),
  ];
  const alreadyClosed = meeting.status === "encerrada";
  const minutes = alreadyClosed && meeting.minutes_text?.trim() ? meeting.minutes_text : lines.join("\n");
  const recipientProfiles = profiles.filter(person => person.active
    && (person.is_admin || departmentResult.data?.some(member => member.user_id === person.user_id)) && (
    type === "1:1" ? [meeting.leader_user_id, meeting.report_user_id].includes(person.user_id)
      : person.is_admin || memberResult.data?.some(member => member.user_id === person.user_id)
  ));
  const recipients = validUniqueRecipients(recipientProfiles);
  const invalidRecipientCount = Math.max(0, participants.length - profiles.length) + profiles.filter((item) => !isValidEmailAddress(String(item.email || ""))).length;

  const closedAt = meeting.closed_at || new Date().toISOString();
  if (!alreadyClosed) {
    const closeResult = await session.from("ra_meetings").update({ status: "encerrada", closed_at: closedAt, minutes_text: minutes }).eq("id", meeting.id).eq("updated_at", meeting.updated_at).neq("status", "encerrada").select("id").maybeSingle();
    if (closeResult.error) return NextResponse.json({ error: `Não foi possível salvar a ATA e finalizar a reunião: ${closeResult.error.message}` }, { status: 502 });
    if (!closeResult.data) return NextResponse.json({ error: "A reunião foi alterada por outra solicitação. Atualize a página antes de finalizar." }, { status: 409 });
  }

  let emailWarning: string | null = null;
  let emailSent = false;
  if (!recipients.length) {
    emailWarning = "Nenhum participante possui e-mail válido; revise os cadastros antes da próxima reunião.";
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
          from, to: recipients, subject: `ATA ${type}: ${meeting.title}`,
          html: renderRaMinutesEmail(minutes),
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
      emailWarning = "O serviço de e-mail não respondeu; a ATA permanece salva na reunião.";
    }
  }

  return NextResponse.json({ ok: true, resent: alreadyClosed, emailSent, emailWarning, recipientCount: emailSent ? recipients.length : 0, eligibleRecipientCount: recipients.length, minutes, closedAt });
}
