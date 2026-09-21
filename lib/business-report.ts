import type { Business, BusinessFile, StageHistory } from "./types";
import type { MapGeometry } from "./business-map";
import { geometryBounds } from "./business-map.ts";
import { BUSINESS_STAGES, BUSINESS_PORTFOLIO_SECTIONS } from "./constants.ts";

export type ReportImage = { name: string; data: string; width: number; height: number };
export type BusinessReportData = {
  business: Business;
  files: BusinessFile[];
  history: StageHistory[];
  images: ReportImage[];
  areaImage: ReportImage | null;
  geometry: MapGeometry | null;
  kmz: Uint8Array | null;
  registry: Uint8Array | null;
  warnings: string[];
  generatedAt?: Date;
};

const clean = (value: unknown) => String(value ?? "Não informado").normalize("NFC").replace(/[\u2010-\u2015]/g, "-").replace(/\u00a0/g, " ");
const date = (value: string) => new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString("pt-BR");
const stage = (value: string) => BUSINESS_STAGES.find((item) => item.key === value)?.label || value;

export async function buildBusinessReport(data: BusinessReportData) {
  const [{ jsPDF }, { PDFDocument }] = await Promise.all([import("jspdf"), import("pdf-lib")]);
  const { business } = data;
  const warnings = [...data.warnings];
  let registryDocument = null;
  if (data.registry) {
    try { registryDocument = await PDFDocument.load(data.registry); }
    catch { warnings.push("As páginas da matrícula não puderam ser incorporadas. O PDF original está nos anexos do relatório."); }
  }
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const generatedAt = data.generatedAt || new Date();
  let y = 28;
  function header() {
    doc.setFillColor(28, 65, 50); doc.rect(0, 0, 210, 17, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(255, 255, 255);
    doc.text("TERRA LOTUS  /  NOVOS NEGÓCIOS", 16, 11);
    doc.setTextColor(34, 47, 41);
  }
  function nextPage() { doc.addPage(); y = 28; header(); }
  function ensure(height: number) { if (y + height > 276) nextPage(); }
  function paragraph(value: unknown, size = 10, bold = false) {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size);
    const lines = doc.splitTextToSize(clean(value), 178) as string[];
    for (const line of lines) { ensure(size * .45 + 2); doc.text(line, 16, y); y += size * .45 + 1.2; }
    y += 3;
  }
  function section(title: string) { ensure(22); y += 3; paragraph(title, 14, true); }
  function field(label: string, value: unknown) { paragraph(`${label}: ${clean(value)}`); }
  function picture(image: ReportImage, maxHeight = 180) {
    const scale = Math.min(178 / image.width, maxHeight / image.height);
    const width = image.width * scale, height = image.height * scale;
    doc.setFontSize(9);
    const captionLines = doc.splitTextToSize(clean(image.name), 178).length;
    ensure(height + 10 + captionLines * 5.25);
    doc.addImage(image.data, "JPEG", 16 + (178 - width) / 2, y, width, height);
    y += height + 7;
    paragraph(image.name, 9);
  }
  header();
  paragraph("RELATÓRIO DO NEGÓCIO", 10, true);
  paragraph(business.name, 24, true);
  paragraph(`Emitido em ${generatedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (Brasília)`, 9);
  section("Visão geral");
  field("Carteira", BUSINESS_PORTFOLIO_SECTIONS.find((item) => item.key === business.portfolio_section)?.label);
  field("Fase", stage(business.stage));
  field("VGV potencial", Number(business.potential_vgv || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
  field("Matrícula", business.property_registration || "Não informada");
  field("Projeto relacionado", business.project?.name || "Não informado");
  field("Responsável pelo projeto", business.project?.owner_name || "Não informado");
  field("Início", date(business.start_date));
  field("Última atualização", date(business.updated_at));
  if (business.days_in_stage != null) field("Dias na fase", business.days_in_stage);
  if (business.archived_at) field("Arquivado em", date(business.archived_at));
  section("Descrição");
  paragraph(business.notes || "Descrição não informada no cadastro.");

  nextPage(); section("Localização e área");
  if (business.latitude != null && business.longitude != null) {
    field("Coordenadas centrais", `${Number(business.latitude).toFixed(6)}, ${Number(business.longitude).toFixed(6)}`);
    doc.setFontSize(10); doc.setTextColor(33, 95, 73);
    doc.textWithLink("Abrir localização no Google Maps", 16, y, { url: `https://www.google.com/maps/search/?api=1&query=${business.latitude},${business.longitude}` });
    doc.setTextColor(34, 47, 41); y += 12;
  }
  // Legacy rows use placeholder address/city/state; do not present these as verified locations.
  if (business.city && business.city !== "Área mapeada") field("Município / UF", `${business.city} / ${business.state}`);
  if (business.address && business.address !== "Área definida pelo arquivo KMZ") field("Endereço", business.address);
  if (data.areaImage) picture(data.areaImage, 138);
  else paragraph("Imagem de satélite não incluída. Adicione a imagem da área ao cadastro para o próximo relatório.");
  if (data.geometry) {
    ensure(130);
    section("Geometria do KMZ");
    ensure(106);
    const bounds = geometryBounds(data.geometry.paths);
    const cosine = Math.max(.01, Math.cos(data.geometry.center.latitude * Math.PI / 180));
    const spanX = Math.max((bounds.east - bounds.west) * cosine, .00001);
    const spanY = Math.max(bounds.north - bounds.south, .00001);
    const scale = Math.min(160 / spanX, 78 / spanY);
    const left = 105 - spanX * scale / 2, top = y + 5 + (78 - spanY * scale) / 2;
    doc.setFillColor(244, 247, 242); doc.rect(16, y, 178, 90, "F");
    doc.setDrawColor(44, 107, 75); doc.setLineWidth(.6);
    for (const path of data.geometry.paths) {
      const project = (p: { latitude: number; longitude: number }) => [left + (p.longitude - bounds.west) * cosine * scale, top + (bounds.north - p.latitude) * scale];
      if (path.length === 1) { const [x, py] = project(path[0]); doc.circle(x, py, 1.4, "S"); }
      for (let i = 1; i < path.length; i++) {
        const [x1, y1] = project(path[i - 1]), [x2, y2] = project(path[i]); doc.line(x1, y1, x2, y2);
      }
    }
    y += 97; paragraph("Norte para cima. Desenho esquemático das coordenadas do KMZ, sem escala cadastral.", 9);
  }
  field("Arquivo KMZ", business.location_file_name || "Não enviado");

  if (data.images.length) {
    nextPage(); section("Imagens do negócio");
    for (const image of data.images) picture(image);
  }
  section("Histórico de fases");
  if (!data.history.length) paragraph("Nenhum histórico disponível.");
  for (const item of data.history) paragraph(`${stage(item.stage)}  |  ${date(item.entered_at)} até ${item.exited_at ? date(item.exited_at) : "atual"}`);

  section("Documentos e anexos");
  field("Matrícula - PDF", business.registration_file_name || "Não enviado");
  if (data.registry || data.kmz) paragraph("Os arquivos originais estão incorporados ao PDF. Para extraí-los, abra o painel Anexos de um leitor compatível, como Adobe Acrobat. Alguns navegadores não exibem esse painel.", 9);
  if (registryDocument) paragraph(`A matrícula completa (${registryDocument.getPageCount()} páginas) está reproduzida ao final deste relatório. O documento original permanece disponível como anexo.`, 9);
  for (const file of data.files) paragraph(`${file.file_name}  |  ${file.mime_type.startsWith("image/") ? "Imagem" : file.mime_type.startsWith("video/") ? "Vídeo" : "Documento"}  |  ${(file.size_bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`, 9);
  if (data.files.some((f) => !f.mime_type.startsWith("image/"))) paragraph("Vídeos e documentos adicionais estão relacionados acima e podem ser abertos na ficha do negócio.", 9);
  if (warnings.length) { section("Informações não incluídas"); warnings.forEach((warning) => paragraph(warning, 9)); }

  const reportPages = doc.getNumberOfPages();
  for (let i = 1; i <= reportPages; i++) {
    doc.setPage(i); doc.setDrawColor(218, 225, 218); doc.line(16, 282, 194, 282);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(97, 111, 103);
    doc.text("Terra Lotus Space | Dados do cadastro na emissão", 16, 288);
    doc.text(`${i} / ${reportPages}`, 194, 288, { align: "right" });
  }
  const pdf = await PDFDocument.load(doc.output("arraybuffer"));
  pdf.setTitle(`Relatório - ${business.name}`); pdf.setAuthor("Terra Lotus Space"); pdf.setCreationDate(generatedAt);
  if (registryDocument) {
    const pages = await pdf.copyPages(registryDocument, registryDocument.getPageIndices());
    pages.forEach((page) => pdf.addPage(page));
  }
  if (data.registry) await pdf.attach(data.registry, business.registration_file_name || "matricula.pdf", { mimeType: "application/pdf", description: "Matrícula original, sem alterações" });
  if (data.kmz) await pdf.attach(data.kmz, business.location_file_name || "area.kmz", { mimeType: "application/vnd.google-earth.kmz", description: "Localização original do negócio" });
  return { bytes: await pdf.save(), warnings };
}

export async function reportImage(blob: Blob, name: string): Promise<ReportImage> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image(); image.src = url;
    await image.decode();
    const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas"); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar a imagem.");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { name, data: canvas.toDataURL("image/jpeg", .88), width: canvas.width, height: canvas.height };
  } finally { URL.revokeObjectURL(url); }
}
