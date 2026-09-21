import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, PDFName, PDFDict, PDFArray } from "pdf-lib";
import { registrationNumberFromText, validateRegistryFile } from "../lib/business-registry.ts";
import { parseBusinessGeometry, staticMapParameters } from "../lib/business-map.ts";
import { buildBusinessReport } from "../lib/business-report.ts";
import type { Business } from "../lib/types.ts";

test("extrai a matrícula rotulada sem confundir protocolo, CPF ou CNM", () => {
  for (const label of ["Matrícula nº 112.755", "MATRÍCULA: 112755", "Certidão de Matrícula nº 112.755 - Remanescente.pdf", "matrícula número 112.755"]) {
    assert.equal(registrationNumberFromText(label)?.replaceAll(".", ""), "112755");
  }
  assert.equal(registrationNumberFromText("Protocolo 461.267; CPF 197.055.331-15; CNM 026120.2.0112755-39"), null);
  assert.equal(registrationNumberFromText("Matrícula do imóvel - sem número"), null);
});

test("rejeita PDF falso, vazio e acima do limite", async () => {
  await assert.rejects(validateRegistryFile(new File(["not pdf"], "matricula.pdf")), /não é um PDF/);
  await assert.rejects(validateRegistryFile(new File([], "matricula.pdf")), /válido/);
  await assert.rejects(validateRegistryFile(new File(["%PDF-", new Uint8Array(20 * 1024 * 1024)], "matricula.pdf")), /20 MB/);
  await validateRegistryFile(new File(["%PDF-1.7"], "matricula.PDF"));
});

test("preserva polígonos separados e enquadra toda a área", () => {
  const geometry = parseBusinessGeometry("<kml><coordinates>-50,-18 -49,-18 -49,-17 -50,-18</coordinates><coordinates>-48,-16 -47,-16</coordinates></kml>");
  assert.equal(geometry.paths.length, 2);
  assert.deepEqual(geometry.center, { latitude: -17, longitude: -48.5 });
  const params = staticMapParameters(geometry, geometry.center);
  assert.equal(params.get("visible"), "-18,-50|-16,-47");
  assert.equal(params.getAll("path").length, 2);
  assert.equal(params.get("maptype"), "satellite");
  assert.throws(() => parseBusinessGeometry("<coordinates>, -40,999</coordinates>"));
});

const business = {
  id: "11111111-1111-4111-8111-111111111111", name: "Rio Verde - Etapa 02", property_registration: "112.755",
  potential_vgv: 94636697.92, stage: "masterplan", portfolio_section: "esteira_negocios", start_date: "2026-01-10",
  updated_at: "2026-09-21", notes: "Descrição do negócio. ".repeat(150), latitude: -17.8, longitude: -50.9,
  city: "Área mapeada", address: "Área definida pelo arquivo KMZ", registration_file_name: "matricula.pdf", location_file_name: "area.kmz",
} as Business;

test("gera páginas, incorpora todas as páginas da matrícula e preserva os arquivos originais", async () => {
  const registry = await PDFDocument.create(); registry.addPage(); registry.addPage();
  const data = { business, files: [], history: [], images: [], areaImage: null, geometry: null, kmz: new Uint8Array([80, 75, 3, 4]), registry: null, warnings: [] };
  const summary = await buildBusinessReport(data);
  const complete = await buildBusinessReport({ ...data, registry: await registry.save() });
  const pdf = await PDFDocument.load(complete.bytes);
  assert.equal(pdf.getPageCount(), (await PDFDocument.load(summary.bytes)).getPageCount() + 2);
  const names = pdf.catalog.lookup(PDFName.of("Names"), PDFDict).lookup(PDFName.of("EmbeddedFiles"), PDFDict).lookup(PDFName.of("Names"), PDFArray);
  assert.equal(names.size(), 4); // two filename/file-spec pairs
  assert.equal(pdf.getTitle(), "Relatório - Rio Verde - Etapa 02");
  assert.deepEqual(complete.warnings, []);
});

test("mantém anexo original e informa quando não consegue reproduzir a matrícula", async () => {
  const report = await buildBusinessReport({ business, files: [], history: [], images: [], areaImage: null, geometry: null, kmz: null, registry: new Uint8Array([1, 2, 3]), warnings: [] });
  assert.match(report.warnings[0], /páginas da matrícula/);
  assert.ok((await PDFDocument.load(report.bytes)).getPageCount() > 1);
});
