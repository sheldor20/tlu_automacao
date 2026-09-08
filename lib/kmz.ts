import JSZip from "jszip";

export type MapCoordinates = { latitude: number; longitude: number };

function validCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

export function parseKmlCenter(kml: string): MapCoordinates {
  const points: MapCoordinates[] = [];
  const coordinateGroups = kml.matchAll(/<(?:[\w-]+:)?coordinates\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?coordinates>/gi);

  for (const group of coordinateGroups) {
    for (const rawPoint of group[1].trim().split(/\s+/)) {
      const [longitudeValue, latitudeValue] = rawPoint.split(",");
      const latitude = Number(latitudeValue);
      const longitude = Number(longitudeValue);
      if (validCoordinate(latitude, longitude)) points.push({ latitude, longitude });
    }
  }

  const googleTrackPoints = kml.matchAll(/<(?:[\w-]+:)?coord\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?coord>/gi);
  for (const match of googleTrackPoints) {
    const [longitudeValue, latitudeValue] = match[1].trim().split(/\s+/);
    const latitude = Number(latitudeValue);
    const longitude = Number(longitudeValue);
    if (validCoordinate(latitude, longitude)) points.push({ latitude, longitude });
  }

  if (!points.length) throw new Error("kmz_without_coordinates");

  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  return {
    latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
    longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
  };
}

export async function extractKmzCenter(file: Blob): Promise<MapCoordinates> {
  const archive = await JSZip.loadAsync(await file.arrayBuffer());
  const kmlEntry = Object.values(archive.files).find(
    (entry) => !entry.dir && entry.name.toLocaleLowerCase().endsWith(".kml"),
  );
  if (!kmlEntry) throw new Error("kmz_without_kml");
  return parseKmlCenter(await kmlEntry.async("text"));
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
