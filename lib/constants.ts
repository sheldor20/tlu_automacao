import type { BusinessStage, Department, ManagementAreaSlug, TaskStatus } from "@/lib/types";

export const DEPARTMENTS: Department[] = [
  { slug: "novos-negocios", name: "Novos negócios", position: 1 },
  { slug: "obras", name: "Obras", position: 2 },
  { slug: "projetos", name: "Projetos", position: 3 },
  { slug: "governanca", name: "Governança", position: 4 },
  { slug: "alugueis", name: "Aluguéis", position: 5 },
  { slug: "processos", name: "Processos", position: 6 },
  { slug: "pauta-ra", name: "Pauta e RA", position: 7 },
  { slug: "indicadores", name: "Indicadores", position: 8 },
];

export const MANAGEMENT_AREAS: Array<{ slug: ManagementAreaSlug; name: string }> = [
  { slug: "empresa", name: "Empresa" },
  { slug: "juridico-vendas-cobranca", name: "Jurídico, Pós-vendas, Vendas e Cobrança" },
  { slug: "rh-marketing-clientes", name: "RH, Marketing e Clientes" },
  { slug: "financas-compras", name: "Finanças e Compras" },
  { slug: "novos-negocios", name: "Novos Negócios" },
  { slug: "obras-engenharia", name: "Obras e Engenharia" },
];

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
