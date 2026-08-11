import type { BusinessStage, TaskStatus } from "@/lib/types";

export const BUSINESS_STAGES: Array<{
  key: BusinessStage;
  label: string;
  shortLabel: string;
}> = [
  { key: "prospeccao", label: "Prospecção", shortLabel: "Prospecção" },
  { key: "viabilidade", label: "Viabilidade", shortLabel: "Viabilidade" },
  { key: "contrato", label: "Contrato", shortLabel: "Contrato" },
  {
    key: "viabilidade_mercadologica",
    label: "Viabilidade mercadológica e desenvolvimento",
    shortLabel: "Mercado e negócio",
  },
  { key: "masterplan", label: "Masterplan", shortLabel: "Masterplan" },
  { key: "aprovacao", label: "Aprovação", shortLabel: "Aprovação" },
  { key: "obra", label: "Obra", shortLabel: "Obra" },
];

export const TASK_COLUMNS: Array<{ key: TaskStatus; label: string }> = [
  { key: "a_fazer", label: "A fazer" },
  { key: "em_andamento", label: "Em andamento" },
  { key: "concluida", label: "Concluídas" },
];

export const BRAZIL_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT",
  "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO",
  "RR", "SC", "SP", "SE", "TO",
];
