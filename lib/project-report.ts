import type {
  BusinessStage,
  Project,
  ProjectComment,
  ProjectFile,
  ProjectMember,
  ProjectTask,
  TaskStatus,
} from "./types";

export type ProjectReportBusiness = {
  id: string;
  name: string;
  stage: BusinessStage;
  potential_vgv: number;
};

type ProjectReportData = {
  project: Project;
  tasks: ProjectTask[];
  comments: ProjectComment[];
  members: ProjectMember[];
  files: ProjectFile[];
  linkedBusinesses: ProjectReportBusiness[];
};

const projectStatusLabels: Record<Project["status"], string> = {
  planejamento: "Planejamento",
  ativo: "Ativo",
  pausado: "Pausado",
  concluido: "Concluido",
};

const taskStatusLabels: Record<TaskStatus, string> = {
  a_fazer: "A fazer",
  em_andamento: "Em andamento",
  concluida: "Concluida",
};

const businessStageLabels: Record<BusinessStage, string> = {
  prospeccao: "Prospeccao",
  viabilidade: "Viabilidade",
  contrato: "Contrato",
  viabilidade_mercadologica: "Viabilidade mercadologica e desenvolvimento",
  masterplan: "Masterplan",
  aprovacao: "Aprovacao",
  obra: "Obra",
};

function cleanText(value: string | null | undefined) {
  return String(value || "-")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...");
}

function dateBr(value: string | null | undefined) {
  if (!value) return "Nao informado";
  const date = value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value);
  return new Intl.DateTimeFormat("pt-BR").format(date);
}

function currency(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function slug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result.length ? result : [[]];
}

export async function buildProjectReportDocument({
  project,
  tasks,
  comments,
  members,
  files,
  linkedBusinesses,
}: ProjectReportData) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = 210;
  const contentLeft = 16;
  const contentRight = 194;
  const contentWidth = contentRight - contentLeft;
  const pageBottom = 276;
  const dark = [38, 51, 41] as const;
  const moss = [91, 111, 89] as const;
  const muted = [103, 115, 106] as const;
  const light = [239, 243, 237] as const;
  const veryLight = [248, 249, 247] as const;

  const header = () => {
    doc.setFillColor(...dark);
    doc.rect(0, 0, pageWidth, 34, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("TERRA LOTUS", contentLeft, 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("VISAO GERAL DO PROJETO", contentLeft, 23);
  };

  const addPage = () => {
    doc.addPage();
    header();
    return 47;
  };

  const ensureSpace = (y: number, height: number) => y + height > pageBottom ? addPage() : y;

  const sectionTitle = (title: string, subtitle: string | null, y: number) => {
    y = ensureSpace(y, subtitle ? 19 : 13);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...dark);
    doc.text(cleanText(title), contentLeft, y);
    y += 5;
    if (subtitle) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...muted);
      doc.text(cleanText(subtitle), contentLeft, y);
      y += 7;
    } else {
      y += 4;
    }
    return y;
  };

  const labelValue = (label: string, value: string, x: number, y: number, width: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...muted);
    doc.text(cleanText(label).toUpperCase(), x, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...dark);
    const lines = doc.splitTextToSize(cleanText(value), width);
    doc.text(lines, x, y + 5);
  };

  const completed = tasks.filter((task) => task.status === "concluida").length;
  const overdue = tasks.filter((task) => task.status !== "concluida" && task.due_date < new Date().toISOString().slice(0, 10)).length;

  header();
  doc.setTextColor(...dark);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(23);
  const titleLines = doc.splitTextToSize(cleanText(project.name), contentWidth);
  doc.text(titleLines, contentLeft, 50);
  let y = 50 + titleLines.length * 9;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  doc.text(`${projectStatusLabels[project.status]} | ${dateBr(project.start_date)} a ${dateBr(project.end_date)}`, contentLeft, y);
  y += 12;

  const cards = [
    ["Progresso", `${Number(project.progress_percent || 0).toFixed(0)}%`],
    ["Tarefas", String(tasks.length)],
    ["Concluidas", String(completed)],
    ["Atrasadas", String(overdue)],
  ];
  cards.forEach(([label, value], index) => {
    const cardWidth = 41;
    const x = contentLeft + index * 45.5;
    doc.setFillColor(...light);
    doc.roundedRect(x, y, cardWidth, 20, 2, 2, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...muted);
    doc.text(label.toUpperCase(), x + 5, y + 7);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...dark);
    doc.text(value, x + 5, y + 15);
  });
  y += 31;

  y = sectionTitle("Objetivo", null, y);
  const objectiveLines = doc.splitTextToSize(cleanText(project.objective), contentWidth - 10);
  const objectiveHeight = Math.max(22, objectiveLines.length * 4.4 + 11);
  y = ensureSpace(y, objectiveHeight);
  doc.setFillColor(...veryLight);
  doc.roundedRect(contentLeft, y, contentWidth, objectiveHeight, 2, 2, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...dark);
  doc.text(objectiveLines, contentLeft + 5, y + 8);
  y += objectiveHeight + 11;

  y = sectionTitle("Dados gerais", null, y);
  y = ensureSpace(y, 30);
  labelValue("Responsavel", `${project.owner_name} | ${project.owner_email}`, contentLeft, y, 80);
  labelValue("Periodo", `${dateBr(project.start_date)} a ${dateBr(project.end_date)}`, 110, y, 84);
  labelValue("Status", `${projectStatusLabels[project.status]}${project.archived_at ? " | Arquivado" : ""}`, contentLeft, y + 15, 80);
  labelValue("Ultima atualizacao", dateBr(project.updated_at), 110, y + 15, 84);
  y += 39;

  y = sectionTitle("Envolvidos", `${members.length} pessoa(s) vinculada(s)`, y);
  if (members.length) {
    for (const member of members) {
      y = ensureSpace(y, 12);
      doc.setFillColor(...veryLight);
      doc.roundedRect(contentLeft, y, contentWidth, 9, 1.5, 1.5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...dark);
      doc.text(cleanText(member.name), contentLeft + 4, y + 5.7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...muted);
      doc.text(cleanText(`${member.role || "Envolvido"} | ${member.email}`), contentRight - 4, y + 5.7, { align: "right" });
      y += 12;
    }
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text("Nenhum envolvido adicional cadastrado.", contentLeft, y);
    y += 10;
  }

  y = sectionTitle("Novos negocios vinculados", `${linkedBusinesses.length} vinculo(s)`, y + 3);
  if (linkedBusinesses.length) {
    for (const business of linkedBusinesses) {
      y = ensureSpace(y, 16);
      doc.setDrawColor(...light);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(contentLeft, y, contentWidth, 13, 2, 2, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...dark);
      doc.text(cleanText(business.name), contentLeft + 4, y + 5.5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...muted);
      doc.text(businessStageLabels[business.stage], contentLeft + 4, y + 10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...dark);
      doc.text(currency(business.potential_vgv), contentRight - 4, y + 8, { align: "right" });
      y += 16;
    }
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text("Nenhum novo negocio vinculado.", contentLeft, y);
  }

  y = addPage();
  y = sectionTitle("Tarefas", "Quadro completo organizado por status", y);
  for (const status of ["a_fazer", "em_andamento", "concluida"] as TaskStatus[]) {
    const statusTasks = tasks.filter((task) => task.status === status);
    y = ensureSpace(y, 15);
    doc.setFillColor(...moss);
    doc.roundedRect(contentLeft, y, contentWidth, 9, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(`${taskStatusLabels[status].toUpperCase()} (${statusTasks.length})`, contentLeft + 4, y + 5.8);
    y += 13;

    if (!statusTasks.length) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...muted);
      doc.text("Nenhuma tarefa nesta etapa.", contentLeft + 3, y);
      y += 9;
      continue;
    }

    for (const task of statusTasks) {
      const descriptionLines = task.description ? doc.splitTextToSize(cleanText(task.description), contentWidth - 10) : [];
      for (const [part, descriptionPart] of chunks<string>(descriptionLines, 45).entries()) {
        const cardHeight = 17 + descriptionPart.length * 3.8;
        y = ensureSpace(y, cardHeight + 4);
        doc.setFillColor(...veryLight);
        doc.roundedRect(contentLeft, y, contentWidth, cardHeight, 2, 2, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(...dark);
        doc.text(cleanText(`${task.title}${part ? " (continuacao)" : ""}`), contentLeft + 5, y + 6.5);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...muted);
        doc.text(cleanText(`${task.assignee_name} | ${task.assignee_email} | Entrega: ${dateBr(task.due_date)}`), contentLeft + 5, y + 12);
        if (descriptionPart.length) {
          doc.setTextColor(...dark);
          doc.text(descriptionPart, contentLeft + 5, y + 17);
        }
        y += cardHeight + 4;
      }
    }
    y += 3;
  }

  y = addPage();
  y = sectionTitle("Comentarios gerais", `${comments.length} atualizacao(oes) registrada(s)`, y);
  if (comments.length) {
    for (const comment of comments) {
      const commentLines = doc.splitTextToSize(cleanText(comment.body), contentWidth - 10);
      for (const [part, commentPart] of chunks<string>(commentLines, 48).entries()) {
        const cardHeight = 14 + commentPart.length * 4;
        y = ensureSpace(y, cardHeight + 4);
        doc.setFillColor(...veryLight);
        doc.roundedRect(contentLeft, y, contentWidth, cardHeight, 2, 2, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(...dark);
        doc.text(cleanText(`${comment.author_name}${part ? " (continuacao)" : ""}`), contentLeft + 5, y + 6);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...muted);
        doc.text(dateBr(comment.created_at), contentRight - 5, y + 6, { align: "right" });
        doc.setFontSize(8.5);
        doc.setTextColor(...dark);
        doc.text(commentPart, contentLeft + 5, y + 12);
        y += cardHeight + 4;
      }
    }
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text("Nenhum comentario registrado.", contentLeft, y);
    y += 12;
  }

  y = sectionTitle("Arquivos e imagens", `${files.length} arquivo(s) vinculado(s)`, y + 5);
  if (files.length) {
    for (const file of files) {
      const fileLines = doc.splitTextToSize(cleanText(file.file_name), 142);
      const rowHeight = Math.max(12, fileLines.length * 4 + 6);
      y = ensureSpace(y, rowHeight);
      doc.setDrawColor(...light);
      doc.line(contentLeft, y + rowHeight - 3, contentRight, y + rowHeight - 3);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...dark);
      doc.text(fileLines, contentLeft, y + 5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...muted);
      doc.text(dateBr(file.created_at), contentRight, y + 5, { align: "right" });
      y += rowHeight;
    }
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text("Nenhum arquivo vinculado.", contentLeft, y);
  }

  const generatedAt = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...muted);
    doc.text(`Gerado em ${generatedAt}`, contentLeft, 289);
    doc.text(`Pagina ${page} de ${pageCount}`, contentRight, 289, { align: "right" });
  }

  return doc;
}

export async function generateProjectReport(data: ProjectReportData) {
  const doc = await buildProjectReportDocument(data);
  doc.save(`projeto-${slug(data.project.name) || "relatorio"}.pdf`);
}
