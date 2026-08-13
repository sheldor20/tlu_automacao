import type { Project, ProjectTask } from "./types";

export type AgendaPriorityTask = ProjectTask & { project_name: string; overdue_days: number };
export type AgendaProject = {
  id: string;
  name: string;
  owner_name: string;
  status: Project["status"];
  completed: number;
  open: number;
  overdue: number;
  future: number;
  file_count: number;
  update_count: number;
  summary: string;
};
export type MeetingAgenda = {
  generated_at: string;
  used_ai: boolean;
  top_priorities: AgendaPriorityTask[];
  other_overdue: AgendaPriorityTask[];
  projects: AgendaProject[];
};

export function prioritizeOverdueTasks(tasks: ProjectTask[], projects: Array<Pick<Project, "id" | "name">>, today: string) {
  const names = new Map(projects.map((project) => [project.id, project.name]));
  const ranked = tasks.filter((task) => task.status !== "concluida" && task.due_date < today).map((task) => ({
    ...task,
    project_name: names.get(task.project_id) || "Projeto",
    overdue_days: Math.max(0, Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${task.due_date}T12:00:00Z`)) / 86_400_000)),
  })).sort((a, b) => b.overdue_days - a.overdue_days || a.due_date.localeCompare(b.due_date));
  return { top_priorities: ranked.slice(0, 10), other_overdue: ranked.slice(10) };
}

function cleanText(value: string | null | undefined) {
  return String(value || "-")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...");
}

function dateBr(value: string) {
  return new Intl.DateTimeFormat("pt-BR").format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

export async function buildMeetingAgendaDocument(agenda: MeetingAgenda) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const left = 16;
  const right = 194;
  const width = right - left;
  const bottom = 279;
  let y = 0;
  let page = 1;

  const header = () => {
    doc.setFillColor(38, 51, 41);
    doc.rect(0, 0, 210, 30, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("TERRA LOTUS", left, 13);
    doc.setFontSize(10);
    doc.text("PAUTA EXECUTIVA DE PROJETOS", left, 21);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(`Gerada em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(agenda.generated_at))}`, right, 20, { align: "right" });
    y = 38;
  };
  const footer = () => {
    doc.setDrawColor(222, 227, 221);
    doc.line(left, 286, right, 286);
    doc.setTextColor(110, 120, 112);
    doc.setFontSize(7);
    doc.text(`Página ${page}`, right, 291, { align: "right" });
  };
  const nextPage = () => { footer(); doc.addPage(); page += 1; header(); };
  const ensure = (height: number) => { if (y + height > bottom) nextPage(); };
  const section = (title: string, subtitle?: string) => {
    ensure(subtitle ? 18 : 13);
    doc.setTextColor(38, 51, 41);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(cleanText(title), left, y);
    y += 5;
    if (subtitle) {
      doc.setTextColor(104, 115, 107);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(cleanText(subtitle), left, y);
      y += 6;
    } else y += 4;
  };

  header();
  doc.setFillColor(244, 247, 242);
  doc.roundedRect(left, y, width, 20, 3, 3, "F");
  doc.setTextColor(38, 51, 41);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(String(agenda.top_priorities.length + agenda.other_overdue.length), left + 6, y + 10);
  doc.setFontSize(8);
  doc.text("tarefas atrasadas", left + 6, y + 15);
  doc.setFontSize(18);
  doc.text(String(agenda.projects.length), left + 62, y + 10);
  doc.setFontSize(8);
  doc.text("projetos analisados", left + 62, y + 15);
  doc.setFont("helvetica", "normal");
  doc.text(agenda.used_ai ? "Resumo de status apoiado por IA" : "Resumo objetivo gerado pela base", right - 6, y + 12, { align: "right" });
  y += 29;

  section("Top 10 prioridades", "Ordenação objetiva: maior quantidade de dias em atraso.");
  if (!agenda.top_priorities.length) {
    doc.setTextColor(80, 113, 82); doc.setFontSize(9); doc.text("Nenhuma tarefa atrasada.", left, y); y += 9;
  }
  agenda.top_priorities.forEach((task, index) => {
    ensure(17);
    doc.setFillColor(index < 3 ? 252 : 247, index < 3 ? 240 : 248, index < 3 ? 238 : 246);
    doc.roundedRect(left, y, width, 14, 2, 2, "F");
    doc.setTextColor(index < 3 ? 145 : 38, index < 3 ? 70 : 51, index < 3 ? 64 : 41);
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
    doc.text(`${index + 1}. ${cleanText(task.title).slice(0, 92)}`, left + 4, y + 5);
    doc.setTextColor(100, 110, 103); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
    doc.text(`${cleanText(task.project_name)} · ${cleanText(task.assignee_name)} · ${task.overdue_days} dias de atraso · prazo ${dateBr(task.due_date)}`, left + 4, y + 10);
    y += 17;
  });

  if (agenda.other_overdue.length) {
    if (y + 18 + agenda.other_overdue.length * 7 > bottom) nextPage();
    section("Demais atrasadas", `${agenda.other_overdue.length} tarefa(s), da mais antiga para a mais recente.`);
    agenda.other_overdue.forEach((task) => {
      const lines = doc.splitTextToSize(`${cleanText(task.title)} — ${cleanText(task.project_name)} · ${task.overdue_days} dias`, width - 5);
      ensure(lines.length * 4 + 3);
      doc.setTextColor(67, 78, 70); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
      doc.text(lines, left + 2, y); y += lines.length * 4 + 2;
    });
    y += 3;
  }

  section("Status resumido por projeto", "Concluídas, abertas, futuras, arquivos e atualizações considerados no resumo.");
  agenda.projects.forEach((project) => {
    const summaryLines = doc.splitTextToSize(cleanText(project.summary), width - 8);
    const height = 13 + summaryLines.length * 4;
    ensure(height + 3);
    doc.setDrawColor(222, 227, 221);
    doc.roundedRect(left, y, width, height, 2, 2, "S");
    doc.setTextColor(38, 51, 41); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text(cleanText(project.name), left + 4, y + 5);
    doc.setTextColor(104, 115, 107); doc.setFont("helvetica", "normal"); doc.setFontSize(7);
    doc.text(`${project.completed} concluídas · ${project.open} abertas · ${project.overdue} atrasadas · ${project.future} futuras · ${project.file_count} arquivos · ${project.update_count} atualizações`, left + 4, y + 9);
    doc.setTextColor(55, 65, 58); doc.setFontSize(8);
    doc.text(summaryLines, left + 4, y + 14);
    y += height + 4;
  });

  footer();
  return doc;
}

export async function generateMeetingAgendaPdf(agenda: MeetingAgenda) {
  const doc = await buildMeetingAgendaDocument(agenda);
  doc.save(`pauta-reuniao-projetos-${agenda.generated_at.slice(0, 10)}.pdf`);
}
