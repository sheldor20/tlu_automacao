import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import { z } from "zod";
import { QLIK_APP_ID, QLIK_SHEETS } from "./policy";

const resultSchema = z.object({
  enterprise: z.string(),
  year: z.number().int(),
  month: z.number().int(),
  expandedConsolidated: z.literal(true),
  detailedRevenueComplete: z.literal(true),
  pdfs: z
    .array(
      z.object({
        sheetId: z.string(),
        base64: z.string().min(8).max(24_000_000),
      }),
    )
    .length(QLIK_SHEETS.length),
  receivablesXlsx: z.string().min(8).max(24_000_000),
});
export function exportConfigured() {
  return Boolean(
    process.env.QLIK_ACCOUNTABILITY_EXPORT_URL &&
    process.env.QLIK_ACCOUNTABILITY_EXPORT_TOKEN,
  );
}
function wrap(text: string, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if ((line + " " + word).length > width) {
      lines.push(line);
      line = word;
    } else line += (line ? " " : "") + word;
  }
  if (line) lines.push(line);
  return lines;
}
export async function createAccountabilityBook(
  enterprise: string,
  year: number,
  month: number,
) {
  if (!exportConfigured())
    throw new Error(
      "Exportação automática do Qlik ainda não configurada. Nenhum e-mail foi enviado.",
    );
  const url = new URL(process.env.QLIK_ACCOUNTABILITY_EXPORT_URL!);
  if (
    url.protocol !== "https:" ||
    !(
      url.hostname === "qlikcloud.com" ||
      url.hostname.endsWith(".qlikcloud.com")
    )
  )
    throw new Error("O exportador deve usar um endereço HTTPS do Qlik Cloud.");
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.QLIK_ACCOUNTABILITY_EXPORT_TOKEN}`,
    },
    body: JSON.stringify({
      appId: QLIK_APP_ID,
      enterprise,
      year,
      month,
      sheetIds: QLIK_SHEETS,
      expandConsolidated: "all",
      detailedRevenue: "complete-table-pdf",
      receivables: "xlsx",
      preserveSourceData: true,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok)
    throw new Error(
      "Não foi possível exportar os relatórios originais do Qlik.",
    );
  const raw = await response.text();
  if (raw.length > 35_000_000)
    throw new Error("Os anexos excedem o tamanho permitido.");
  const result = resultSchema.parse(JSON.parse(raw));
  if (
    result.enterprise !== enterprise ||
    result.year !== year ||
    result.month !== month
  )
    throw new Error(
      "Os filtros retornados pelo Qlik não correspondem ao empreendimento e período solicitados.",
    );
  if (
    new Set(result.pdfs.map((p) => p.sheetId)).size !== QLIK_SHEETS.length ||
    QLIK_SHEETS.some((id) => !result.pdfs.some((p) => p.sheetId === id))
  )
    throw new Error("A exportação não contém todas as telas solicitadas.");
  const excel = Buffer.from(result.receivablesXlsx, "base64");
  const zip = await JSZip.loadAsync(excel);
  if (
    !zip.file("xl/workbook.xml") ||
    !Object.keys(zip.files).some((p) => p.startsWith("xl/worksheets/"))
  )
    throw new Error("O detalhamento a receber não é um arquivo Excel válido.");
  const book = await PDFDocument.create();
  const font = await book.embedFont(StandardFonts.Helvetica);
  const bold = await book.embedFont(StandardFonts.HelveticaBold);
  const reference = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 15)));
  function cover(back = false) {
    const page = book.addPage([595.28, 841.89]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: 595.28,
      height: 841.89,
      color: rgb(0.12, 0.22, 0.17),
    });
    page.drawText("TERRA LOTUS", {
      x: 56,
      y: 735,
      size: 28,
      font: bold,
      color: rgb(1, 1, 1),
    });
    page.drawText("URBANISMO", {
      x: 57,
      y: 710,
      size: 12,
      font,
      color: rgb(0.8, 0.75, 0.57),
    });
    page.drawText(back ? "PRESTAÇÃO DE CONTAS" : "PRESTAÇÃO DE CONTAS MENSAL", {
      x: 56,
      y: 540,
      size: 17,
      font: bold,
      color: rgb(1, 1, 1),
    });
    wrap(enterprise, 36).forEach((line, i) =>
      page.drawText(line, {
        x: 56,
        y: 490 - i * 30,
        size: 22,
        font: bold,
        color: rgb(1, 1, 1),
      }),
    );
    page.drawText(reference, {
      x: 56,
      y: 355,
      size: 16,
      font,
      color: rgb(0.8, 0.75, 0.57),
    });
    page.drawText("BETA · Conferência interna", {
      x: 56,
      y: 100,
      size: 11,
      font,
      color: rgb(1, 1, 1),
    });
  }
  cover();
  for (const id of QLIK_SHEETS) {
    const source = await PDFDocument.load(
      Buffer.from(result.pdfs.find((p) => p.sheetId === id)!.base64, "base64"),
    );
    if (source.getPageCount() === 0) throw new Error("Um dos PDFs está vazio.");
    const pages = await book.copyPages(source, source.getPageIndices());
    pages.forEach((p) => book.addPage(p));
  }
  cover(true);
  const pdf = Buffer.from(await book.save());
  if (pdf.length + excel.length > 18_000_000)
    throw new Error("O book e o Excel excedem o limite de envio por e-mail.");
  return { pdf, excel, reference };
}
