import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { extractKmzCenter, googleMapsUrl, parseKmlCenter } from "../lib/kmz.ts";

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
