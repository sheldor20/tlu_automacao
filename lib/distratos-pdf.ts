import { jsPDF } from "jspdf";
import { brl, brDate, REGIME_LABELS, unitIdentifier, type DistratoDocument } from "./distratos.ts";

export function renderDistratoPdf(record: DistratoDocument) {
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  pdf.setProperties({ title: `Distrato ${unitIdentifier(record.unit)}`, author: "Terra Lotus Space", subject: REGIME_LABELS[record.input.regime], creator: "Terra Lotus Space" });
  let y = 25;
  const page = () => { pdf.addPage(); y = 25; };
  const paragraph = (text: string, bold = false, size = 10) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal"); pdf.setFontSize(size); pdf.setTextColor(29, 45, 35);
    const lines = pdf.splitTextToSize(text, 174) as string[];
    const height = lines.length * size * .48 + 3;
    if (height < 244 && y + height > 270) page();
    for (const line of lines) {
      if (y > 269) page();
      pdf.text(line, 18, y); y += size * .48;
    }
    y += 3;
  };
  const amount = (label: string, value: number, strong = false) => {
    if (y > 265) page();
    pdf.setFont("helvetica", strong ? "bold" : "normal"); pdf.setFontSize(10);
    const lines = pdf.splitTextToSize(label, 132) as string[];
    if (y + lines.length * 5 > 269) page();
    pdf.text(lines, 18, y); pdf.text(brl(value), 192, y, { align: "right" }); y += Math.max(8, lines.length * 5 + 2);
  };
  paragraph("MEMÓRIA DE CÁLCULO DE DISTRATO", true, 16);
  paragraph(`${record.unit.workName} | ${unitIdentifier(record.unit)}`, true, 11);
  paragraph(`${record.unit.buyerName} · Contrato ${record.unit.contractNumber}`);
  paragraph(`${REGIME_LABELS[record.input.regime]} · Data do cálculo: ${brDate(record.input.correctionDate)}`);
  paragraph(`Fonte dos recebimentos: Qlik / Terra Lotus Space. Base publicada em ${new Date(record.unit.synchronizedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`);
  paragraph(`Atualização: TJDFT · INPC · sem juros · última competência disponível: ${record.correction.availableThrough}.`);
  amount("Valor original do imóvel", record.input.saleValue);
  paragraph(`Data da venda: ${brDate(record.input.saleDate)} · Fator aplicado: ${record.calculation.property.factor.toFixed(10)}`, false, 9);
  amount("Valor atualizado do imóvel", record.calculation.property.corrected, true);
  amount("Pagamentos nominais", record.calculation.nominalPaid);
  amount("Pagamentos atualizados", record.calculation.correctedPaid, true);
  paragraph("DESCONTOS", true, 12);
  for (const deduction of record.calculation.deductions) {
    amount(deduction.label, deduction.amount);
    paragraph(deduction.basis, false, 8);
  }
  if (record.calculation.roundingAdjustment) amount("Ajuste de arredondamento dos descontos", record.calculation.roundingAdjustment);
  amount("Total dos descontos", record.calculation.totalDeductions, true);
  amount("Saldo apurado", record.calculation.balance, true);
  amount("Valor a restituir", record.calculation.refund, true);
  if (record.calculation.balance < 0) paragraph("O saldo negativo não constitui reconhecimento automático de dívida. A definição das partes é necessária antes da emissão definitiva.", true);
  page();
  paragraph("PAGAMENTOS RECEBIDOS E ATUALIZAÇÃO INDIVIDUAL", true, 13);
  paragraph(`${record.unit.receipts.length} lançamento(s). Cada valor foi corrigido desde a data do recebimento.`, false, 9);
  for (let i = 0; i < record.unit.receipts.length; i++) {
    if (y > 234) page();
    const source = record.unit.receipts[i], corrected = record.calculation.receipts[i];
    paragraph(`${i + 1}. ${brDate(source.date)} · ${source.description}`, true, 9);
    paragraph(`Original: ${brl(source.amount)} | Atualizado: ${brl(corrected.corrected)} | Fator: ${corrected.factor.toFixed(10)}`, false, 9);
    paragraph(corrected.indices.join("; ") || "Sem variação no período disponível.", false, 8);
    paragraph(`Referência de origem: ${source.id}`, false, 7);
  }
  paragraph(`Fonte da correção: ${record.correction.source}`, false, 8);
  page();
  for (const part of record.term.split("\n\n")) {
    if (/^\d\. /.test(part)) {
      if (y > 236) page();
      const [heading, ...body] = part.split("\n");
      paragraph(heading, true, 11);
      if (body.length) paragraph(body.join("\n"));
    } else paragraph(part, /^INSTRUMENTO/.test(part), /^INSTRUMENTO/.test(part) ? 13 : 10);
  }
  const count = pdf.getNumberOfPages();
  for (let p = 1; p <= count; p++) {
    pdf.setPage(p); pdf.setDrawColor(196, 207, 193); pdf.line(18, 16, 192, 16);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(8); pdf.setTextColor(78, 99, 78);
    pdf.text(`TERRA LOTUS SPACE${record.draft ? " | MINUTA PARA CONFERÊNCIA" : " | DISTRATO"}`, 18, 12);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7);
    pdf.text(`Registro ${record.id} · ${p}/${count}`, 18, 284);
  }
  return new Uint8Array(pdf.output("arraybuffer"));
}
