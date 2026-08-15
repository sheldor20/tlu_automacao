import type {
  ConstructionPlanCategory,
  ConstructionPlanDiscipline,
  ConstructionPlanLayer,
} from "@/lib/types";

export const CONSTRUCTION_PLAN_CATEGORIES: Array<{ value: ConstructionPlanCategory; label: string }> = [
  { value: "urbanistico", label: "Projeto urbanístico" },
  { value: "pavimentacao", label: "Pavimentação e ruas" },
  { value: "eletrica_iluminacao", label: "Elétrica e iluminação" },
  { value: "drenagem_pluvial", label: "Drenagem pluvial" },
  { value: "agua_esgoto", label: "Água e esgoto" },
  { value: "parques_paisagismo", label: "Parques e paisagismo" },
];

export const CONSTRUCTION_PLAN_DISCIPLINES: Array<{
  value: ConstructionPlanDiscipline;
  label: string;
  color: string;
  measurementType: ConstructionPlanLayer["measurement_type"];
}> = [
  { value: "vias_asfalto", label: "Asfalto e ruas", color: "#b7655b", measurementType: "linear" },
  { value: "eletrica_iluminacao", label: "Elétrica e iluminação", color: "#d99a2b", measurementType: "linear" },
  { value: "drenagem_pluvial", label: "Drenagem pluvial", color: "#3d7b91", measurementType: "linear" },
  { value: "agua_esgoto", label: "Água e esgoto", color: "#356c8c", measurementType: "linear" },
  { value: "parques_paisagismo", label: "Parques e paisagismo", color: "#4f7658", measurementType: "area" },
];

export function planCategoryLabel(value: ConstructionPlanCategory) {
  return CONSTRUCTION_PLAN_CATEGORIES.find((item) => item.value === value)?.label || value;
}

export function planDisciplineLabel(value: ConstructionPlanDiscipline) {
  return CONSTRUCTION_PLAN_DISCIPLINES.find((item) => item.value === value)?.label || value;
}

export function planMeasure(value: number, unit: ConstructionPlanLayer["unit"]) {
  return `${Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${unit === "m2" ? "m²" : "m"}`;
}

export function constructionPlanStoragePath(documentId: string, fileName: string) {
  const extension = fileName.toLocaleLowerCase().endsWith(".pdf") ? ".pdf" : "";
  const base = fileName
    .replace(/\.pdf$/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "planta";
  return `${documentId}/${crypto.randomUUID()}-${base}${extension || ".pdf"}`;
}
