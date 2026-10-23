import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { extractKmzCenter, googleMapsUrl, parseKmlCenter, kmzErrorMessage, MAX_KML_BYTES, MAX_KML_POINTS, MAX_KMZ_BYTES, MAX_KMZ_ENTRIES } from "../lib/kmz.ts";

const polygonKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>
    -49.30,-25.50,0 -49.20,-25.50,0 -49.20,-25.40,0 -49.30,-25.40,0
  </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</kml>`;

test("calcula o centro da área descrita no KML", () => {
  const center = parseKmlCenter(polygonKml);
  assert.ok(Math.abs(center.latitude - -25.45) < 0.000001);
  assert.ok(Math.abs(center.longitude - -49.25) < 0.000001);
  assert.equal(googleMapsUrl(center.latitude, center.longitude), "https://www.google.com/maps/search/?api=1&query=-25.45,-49.25");
});

test("extrai o KML compactado dentro de um KMZ", async () => {
  const zip = new JSZip();
  zip.file("doc.kml", polygonKml);
  const data = await zip.generateAsync({ type: "arraybuffer" });
  const center = await extractKmzCenter(new Blob([data]));
  assert.ok(Math.abs(center.latitude - -25.45) < 0.000001);
  assert.ok(Math.abs(center.longitude - -49.25) < 0.000001);
});

test("rejeita KML sem coordenadas", () => {
  assert.throws(() => parseKmlCenter("<kml><Placemark /></kml>"), /kmz_without_coordinates/);
});

test("processa 150 mil pontos sem estourar a pilha e preserva os extremos", () => {
  const points = "-49,-25,0 ".repeat(149_998) + "-51,-27,0 -47,-23,0";
  assert.deepEqual(parseKmlCenter(`<coordinates>${points}</coordinates>`), { latitude: -25, longitude: -49 });
});

test("limita pontos também entre tags diferentes e ignora campos vazios ou inválidos", () => {
  assert.deepEqual(parseKmlCenter("<coordinates>,0 0, 181,0 0,91 NaN,0 0,0</coordinates><gx:coord>2 4 0</gx:coord>"), { latitude: 2, longitude: 1 });
  assert.throws(() => parseKmlCenter("<coordinates>,0 0,</coordinates>"), /kmz_without_coordinates/);
  assert.throws(() => parseKmlCenter(`<coordinates>${"0,0 ".repeat(MAX_KML_POINTS)}</coordinates><gx:coord>1 1 0</gx:coord>`), /kmz_too_many_points/);
});

test("limita o tamanho UTF-8 do KML antes de analisar as coordenadas", () => {
  assert.throws(() => parseKmlCenter("á".repeat(MAX_KML_BYTES / 2 + 1)), /kmz_kml_too_large/);
});

test("recusa KMZ vazio ou acima de 20 MB antes de ler os bytes", async () => {
  class UnreadableBlob extends Blob {
    override async arrayBuffer(): Promise<ArrayBuffer> { throw new Error("must_not_read"); }
  }
  await assert.rejects(extractKmzCenter(new UnreadableBlob()), /kmz_invalid_size/);
  await assert.rejects(extractKmzCenter(new UnreadableBlob([new Uint8Array(MAX_KMZ_BYTES + 1)])), /kmz_invalid_size/);
});

test("interrompe KML descompactado acima do limite, mesmo com KMZ pequeno", async () => {
  const zip = new JSZip();
  zip.file("doc.kml", polygonKml + " ".repeat(MAX_KML_BYTES));
  const data = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
  assert.ok(data.byteLength < 100_000);
  await assert.rejects(extractKmzCenter(new Blob([data])), /kmz_kml_too_large/);
});

test("recusa excesso de entradas, arquivo corrompido e texto inválido", async () => {
  const zip = new JSZip();
  zip.file("doc.kml", polygonKml);
  for (let i = 0; i < MAX_KMZ_ENTRIES; i++) zip.file(`${i}.txt`, "fixture");
  await assert.rejects(extractKmzCenter(new Blob([await zip.generateAsync({ type: "arraybuffer" })])), /kmz_too_many_entries/);
  await assert.rejects(extractKmzCenter(new Blob(["not a zip"])), /kmz_invalid_archive/);
  const invalid = new JSZip().file("doc.kml", new Uint8Array([0xff, 0xff]));
  await assert.rejects(extractKmzCenter(new Blob([await invalid.generateAsync({ type: "arraybuffer" })])), /kmz_invalid_encoding/);
});

test("mensagens explicam os limites e não escondem falhas de outros fluxos", () => {
  assert.match(kmzErrorMessage(new Error("kmz_kml_too_large"))!, /8 MB descompactado/);
  assert.match(kmzErrorMessage(new Error("kmz_too_many_points"))!, /200 mil/);
  assert.equal(kmzErrorMessage(new Error("storage_error")), null);
});

test("diretório ZIP deve conferir com as entradas reais e aceita comentário", async () => {
  const zip = new JSZip().file("doc.kml", polygonKml);
  const valid = await zip.generateAsync({ type: "arraybuffer", comment: "Localização de teste" });
  assert.equal((await extractKmzCenter(new Blob([valid]))).latitude, -25.45);
  const data = await zip.generateAsync({ type: "arraybuffer" });
  const view = new DataView(data);
  view.setUint16(data.byteLength - 22 + 8, 0, true);
  view.setUint16(data.byteLength - 22 + 10, 0, true);
  await assert.rejects(extractKmzCenter(new Blob([data])), /kmz_invalid_archive/);
});
