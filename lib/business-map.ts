import JSZip from "jszip";
import type { MapCoordinates } from "./kmz";

export type MapGeometry = { paths: MapCoordinates[][]; center: MapCoordinates };

export function parseBusinessGeometry(kml: string): MapGeometry {
  const paths: MapCoordinates[][] = [];
  for (const group of kml.matchAll(/<(?:[\w-]+:)?coordinates\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?coordinates>/gi)) {
    const path = group[1].trim().split(/\s+/).flatMap((tuple) => {
      const values = tuple.split(",");
      if (values.length < 2 || !values[0] || !values[1]) return [];
      const [longitude, latitude] = values.map(Number);
      return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
        ? [{ latitude, longitude }] : [];
    });
    if (path.length) paths.push(path);
  }
  if (!paths.length) throw new Error("Não foi possível desenhar as coordenadas do KMZ.");
  const bounds = geometryBounds(paths);
  return { paths, center: { latitude: (bounds.south + bounds.north) / 2, longitude: (bounds.west + bounds.east) / 2 } };
}

export function geometryBounds(paths: MapCoordinates[][]) {
  let south = 90, north = -90, west = 180, east = -180;
  for (const path of paths) for (const p of path) {
    south = Math.min(south, p.latitude); north = Math.max(north, p.latitude);
    west = Math.min(west, p.longitude); east = Math.max(east, p.longitude);
  }
  return { south, north, west, east };
}

export async function readBusinessGeometry(data: Blob): Promise<MapGeometry> {
  const zip = await JSZip.loadAsync(await data.arrayBuffer());
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && /\.kml$/i.test(entry.name));
  const main = entries.find((entry) => entry.name.toLowerCase() === "doc.kml") || entries[0];
  if (!main) throw new Error("O KMZ não contém um arquivo KML.");
  return parseBusinessGeometry(await main.async("text"));
}

export function staticMapParameters(geometry: MapGeometry | null, center: MapCoordinates) {
  const params = new URLSearchParams({ size: "640x420", scale: "2", maptype: "satellite", format: "png", language: "pt-BR" });
  if (geometry) {
    const bounds = geometryBounds(geometry.paths);
    params.set("visible", `${bounds.south},${bounds.west}|${bounds.north},${bounds.east}`);
    // Bound URL size while preserving each independent shape and its endpoints.
    for (const path of geometry.paths.slice(0, 8)) {
      const step = Math.max(1, Math.ceil(path.length / 40));
      const sampled = path.filter((_, index) => index % step === 0 || index === path.length - 1);
      if (sampled.length > 1) params.append("path", `color:0xffd166ff|weight:3|${sampled.map((p) => `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`).join("|")}`);
    }
  } else {
    params.set("center", `${center.latitude},${center.longitude}`);
    params.set("zoom", "16");
  }
  return params;
}
