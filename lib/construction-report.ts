import { currency, dateBr } from "@/lib/format";
import type { Construction, ConstructionEvidence, MacroStage } from "@/lib/types";

type Update = {
  id: string;
  micro_stage_name: string;
  macro_stage_name: string;
  progress_percent: number;
  note: string | null;
  created_at: string;
  evidence_url?: string;
};

async function imageData(url?: string) {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function generateConstructionReport({
  construction,
  macros,
  updates,
  evidences,
}: {
  construction: Construction;
  macros: MacroStage[];
  updates: Update[];
  evidences: ConstructionEvidence[];
}) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const dark = [38, 51, 41] as const;
  const muted = [104, 117, 108] as const;
  const light = [237, 241, 235] as const;

  const header = () => {
    doc.setFillColor(...dark);
    doc.rect(0, 0, 210, 34, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("TERRA LOTUS", 16, 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("RELATORIO DE ACOMPANHAMENTO DE OBRA", 16, 23);
  };

  const pageNumber = () => {
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text(`Gerado em ${dateBr(new Date().toISOString())}`, 16, 289);
    doc.text(`Pagina ${doc.getNumberOfPages()}`, 194, 289, { align: "right" });
  };

  header();
  doc.setTextColor(...dark);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text(construction.name, 16, 49);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...muted);
  doc.setFontSize(9);
  doc.text(`${construction.type === "loteamento" ? "Loteamento" : "Construcao"}  |  ${construction.address || "Local nao informado"}`, 16, 56);

  const cards = [
    ["Avanco fisico", `${Number(construction.progress_percent || 0).toFixed(0)}%`],
    ["Orcamento previsto", currency(construction.planned_budget)],
    ["Realizado", currency(construction.realized_total)],
    ["Prazo", `${dateBr(construction.start_date)} a ${dateBr(construction.expected_end_date)}`],
  ];
  cards.forEach(([label, value], index) => {
    const x = 16 + (index % 2) * 90;
    const y = 67 + Math.floor(index / 2) * 25;
    doc.setFillColor(...light);
    doc.roundedRect(x, y, 84, 20, 2, 2, "F");
    doc.setFontSize(7);
    doc.setTextColor(...muted);
    doc.text(label.toUpperCase(), x + 5, y + 7);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...dark);
    doc.text(value, x + 5, y + 15);
    doc.setFont("helvetica", "normal");
  });

  let y = 124;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Avanco por macro etapa", 16, y);
  y += 8;
  macros.forEach((macro) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...dark);
    doc.text(`${macro.name} (${Number(macro.weight_percent).toFixed(0)}% do total)`, 16, y + 4);
    doc.setFillColor(225, 230, 224);
    doc.roundedRect(104, y, 82, 5, 2.5, 2.5, "F");
    doc.setFillColor(94, 116, 95);
    doc.roundedRect(104, y, Math.max(1, 82 * Number(macro.progress_percent || 0) / 100), 5, 2.5, 2.5, "F");
    doc.setFont("helvetica", "bold");
    doc.text(`${Number(macro.progress_percent || 0).toFixed(0)}%`, 194, y + 4, { align: "right" });
    y += 11;
  });

  pageNumber();

  if (updates.length) {
    doc.addPage();
    header();
    y = 48;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(...dark);
    doc.text("Ultimas atualizacoes", 16, y);
    y += 12;

    for (const update of updates.slice(0, 8)) {
      if (y > 252) {
        pageNumber();
        doc.addPage();
        header();
        y = 48;
      }
      doc.setFillColor(248, 249, 247);
      doc.roundedRect(16, y, 178, 28, 2, 2, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...dark);
      doc.text(`${update.macro_stage_name} / ${update.micro_stage_name}`, 21, y + 8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...muted);
      doc.setFontSize(8);
      doc.text(`${dateBr(update.created_at)}  |  Avanco registrado: ${Number(update.progress_percent).toFixed(0)}%`, 21, y + 15);
      const noteLines = doc.splitTextToSize(update.note || "Atualizacao de avanco com evidencia registrada.", 165);
      doc.text(noteLines.slice(0, 2), 21, y + 22);
      y += 34;
    }
    pageNumber();
  }

  const recentEvidence = evidences.filter((item) => item.signed_url).slice(0, 6);
  if (recentEvidence.length) {
    doc.addPage();
    header();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(...dark);
    doc.text("Evidencias recentes", 16, 48);
    let imageY = 58;
    for (let index = 0; index < recentEvidence.length; index += 1) {
      if (index > 0 && index % 2 === 0) {
        pageNumber();
        doc.addPage();
        header();
        imageY = 46;
      }
      const evidence = recentEvidence[index];
      const data = await imageData(evidence.signed_url);
      if (data) {
        try {
          doc.addImage(data, data.includes("image/png") ? "PNG" : "JPEG", 16, imageY, 178, 88, undefined, "FAST");
          doc.setFillColor(...dark);
          doc.rect(16, imageY + 73, 178, 15, "F");
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(8);
          doc.text(`${dateBr(evidence.captured_at)} - ${evidence.note || evidence.file_name}`, 21, imageY + 82);
        } catch {
          doc.setTextColor(...muted);
          doc.text(`Evidencia: ${evidence.file_name}`, 16, imageY + 8);
        }
      }
      imageY += 99;
    }
    pageNumber();
  }

  doc.save(`relatorio-${construction.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`);
}
