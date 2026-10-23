import JSZip from "jszip";

export type MapCoordinates = { latitude: number; longitude: number };

export const MAX_KMZ_BYTES = 20 * 1024 * 1024;
export const MAX_KML_BYTES = 8 * 1024 * 1024;
export const MAX_KMZ_ENTRIES = 256;
export const MAX_KML_POINTS = 200_000;

function validCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

export function parseKmlCenter(kml: string): MapCoordinates {
  if (kml.length > MAX_KML_BYTES || new TextEncoder().encode(kml).byteLength > MAX_KML_BYTES) {
    throw new Error("kmz_kml_too_large");
  }
  let minLatitude = Infinity, maxLatitude = -Infinity;
  let minLongitude = Infinity, maxLongitude = -Infinity;
  let inspected = 0, accepted = 0;
  function include(longitudeValue: string | undefined, latitudeValue: string | undefined) {
    if (++inspected > MAX_KML_POINTS) throw new Error("kmz_too_many_points");
    if (!latitudeValue?.trim() || !longitudeValue?.trim()) return;
    const latitude = Number(latitudeValue), longitude = Number(longitudeValue);
    if (!validCoordinate(latitude, longitude)) return;
    minLatitude = Math.min(minLatitude, latitude);
    maxLatitude = Math.max(maxLatitude, latitude);
    minLongitude = Math.min(minLongitude, longitude);
    maxLongitude = Math.max(maxLongitude, longitude);
    accepted++;
  }
  const coordinateGroups = kml.matchAll(/<(?:[\w-]+:)?coordinates\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?coordinates>/gi);

  for (const group of coordinateGroups) {
    for (const rawPoint of group[1].matchAll(/\S+/g)) {
      const [longitudeValue, latitudeValue] = rawPoint[0].split(",", 2);
      include(longitudeValue, latitudeValue);
    }
  }

  const googleTrackPoints = kml.matchAll(/<(?:[\w-]+:)?coord\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?coord>/gi);
  for (const match of googleTrackPoints) {
    const [longitudeValue, latitudeValue] = match[1].trim().split(/\s+/, 2);
    include(longitudeValue, latitudeValue);
  }

  if (!accepted) throw new Error("kmz_without_coordinates");

  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
  };
}

function readBoundedKml(entry: JSZip.JSZipObject): Promise<string> {
  // Enforce the actual decompressed size, not just the ZIP's size declaration.
  return new Promise((resolve, reject) => {
    // JSZip documents this API, but 3.10's declarations omit it on JSZipObject.
    const stream = (entry as JSZip.JSZipObject & {
      internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
    }).internalStream("uint8array");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const chunks: string[] = [];
    let bytes = 0, stopped = false;
    const fail = (error: Error) => {
      stopped = true;
      stream.pause();
      chunks.length = 0;
      reject(error);
    };
    stream.on("data", (chunk) => {
      if (stopped) return;
      bytes += chunk.byteLength;
      if (bytes > MAX_KML_BYTES) return fail(new Error("kmz_kml_too_large"));
      try { chunks.push(decoder.decode(chunk, { stream: true })); }
      catch { fail(new Error("kmz_invalid_encoding")); }
    });
    stream.on("error", () => fail(new Error("kmz_invalid_archive")));
    stream.on("end", () => {
      if (stopped) return;
      try { resolve(chunks.join("") + decoder.decode()); }
      catch { fail(new Error("kmz_invalid_encoding")); }
    });
    stream.resume();
  });
}

function checkZipDirectory(data: ArrayBuffer) {
  const view = new DataView(data);
  // Check the bounded ZIP directory before JSZip allocates one object per entry.
  // Multi-disk and ZIP64 archives are unnecessary for the 20 MB upload limit.
  for (let end = view.byteLength - 22; end >= Math.max(0, view.byteLength - 65_557); end--) {
    if (view.getUint32(end, true) !== 0x06054b50 || end + 22 + view.getUint16(end + 20, true) !== view.byteLength) continue;
    const count = view.getUint16(end + 10, true);
    if (count > MAX_KMZ_ENTRIES) throw new Error("kmz_too_many_entries");
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count) break;
    const size = view.getUint32(end + 12, true);
    let offset = view.getUint32(end + 16, true);
    const stop = offset + size;
    if (stop !== end) break;
    let actual = 0;
    while (offset + 46 <= stop && view.getUint32(offset, true) === 0x02014b50) {
      if (++actual > MAX_KMZ_ENTRIES) throw new Error("kmz_too_many_entries");
      offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    }
    if (actual === count && offset === stop) return;
    break;
  }
  throw new Error("kmz_invalid_archive");
}

export async function extractKmzCenter(file: Blob): Promise<MapCoordinates> {
  if (!file.size || file.size > MAX_KMZ_BYTES) throw new Error("kmz_invalid_size");
  const data = await file.arrayBuffer();
  checkZipDirectory(data);
  let archive: JSZip;
  try { archive = await JSZip.loadAsync(data); }
  catch { throw new Error("kmz_invalid_archive"); }
  const entries = Object.values(archive.files);
  if (entries.length > MAX_KMZ_ENTRIES) throw new Error("kmz_too_many_entries");
  const kmlEntry = entries.find(
    (entry) => !entry.dir && entry.name.toLocaleLowerCase().endsWith(".kml"),
  );
  if (!kmlEntry) throw new Error("kmz_without_kml");
  return parseKmlCenter(await readBoundedKml(kmlEntry));
}

export function kmzErrorMessage(error: unknown): string | null {
  const messages: Record<string, string> = {
    kmz_invalid_size: "Selecione um KMZ entre 1 byte e 20 MB.",
    kmz_kml_too_large: "O KML dentro do KMZ excede 8 MB descompactado. Simplifique a geometria e tente novamente.",
    kmz_too_many_points: "A localização excede 200 mil pontos. Simplifique a geometria e tente novamente.",
    kmz_too_many_entries: "O KMZ excede 256 arquivos e pastas. Exporte apenas a localização necessária.",
    kmz_invalid_archive: "Não foi possível abrir o KMZ. Exporte um novo arquivo e tente novamente.",
    kmz_invalid_encoding: "O KML deve usar texto UTF-8. Exporte um novo KMZ e tente novamente.",
    kmz_without_kml: "O KMZ não contém um arquivo KML.",
    kmz_without_coordinates: "O KMZ não contém coordenadas válidas.",
  };
  return error instanceof Error ? messages[error.message] || null : null;
}

export function kmzStoragePath(businessId: string, fileName: string) {
  const base = fileName
    .replace(/\.kmz$/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "localizacao";
  return `${businessId}/${crypto.randomUUID()}-${base}.kmz`;
}

export function googleMapsUrl(latitude: number, longitude: number) {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}
