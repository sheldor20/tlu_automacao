export type BusinessStage =
  | "prospeccao"
  | "viabilidade"
  | "contrato"
  | "viabilidade_mercadologica"
  | "masterplan"
  | "aprovacao"
  | "obra";

export type Business = {
  id: string;
  project_id: string | null;
  name: string;
  start_date: string;
  stage: BusinessStage;
  address: string;
  city: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
  potential_vgv: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  project?: Pick<Project, "id" | "name" | "status" | "archived_at"> | null;
};

export type StageHistory = {
  id: string;
  business_id: string;
  stage: BusinessStage;
  entered_at: string;
  exited_at: string | null;
};

export type Construction = {
  id: string;
  source_business_id: string | null;
  name: string;
  type: "loteamento" | "construcao";
  start_date: string;
  expected_end_date: string | null;
  planned_budget: number;
  address: string | null;
  status: "planejamento" | "em_andamento" | "pausada" | "concluida";
  notes: string | null;
  progress_percent?: number;
  realized_total?: number;
  realized_current_month?: number;
  stage_weight_total?: number;
  created_at: string;
  updated_at: string;
};

export type MacroStage = {
  id: string;
  construction_id: string;
  name: string;
  description: string | null;
  weight_percent: number;
  position: number;
  progress_percent?: number;
  micro_stages?: MicroStage[];
};

export type MicroStage = {
  id: string;
  macro_stage_id: string;
  name: string;
  description: string | null;
  progress_percent: number;
  position: number;
  supplies: Array<{ name: string; quantity?: number; unit?: string }>;
  last_evidence_id: string | null;
  updated_at: string;
};

export type ConstructionEvidence = {
  id: string;
  construction_id: string;
  micro_stage_id: string;
  file_path: string;
  file_name: string;
  note: string | null;
  captured_at: string;
  used_at: string | null;
  signed_url?: string;
};

export type ConstructionBudget = {
  id: string;
  construction_id: string;
  reference_month: string;
  planned_amount: number;
  realized_amount: number;
  notes: string | null;
};

export type ProjectStatus = "planejamento" | "ativo" | "pausado" | "concluido";
export type TaskStatus = "a_fazer" | "em_andamento" | "concluida";

export type Project = {
  id: string;
  name: string;
  start_date: string;
  end_date: string | null;
  owner_name: string;
  owner_email: string;
  objective: string;
  status: ProjectStatus;
  archived_at: string | null;
  archived_by: string | null;
  progress_percent?: number;
  total_tasks?: number;
  completed_tasks?: number;
  overdue_tasks?: number;
  created_at: string;
  updated_at: string;
};

export type ProjectTask = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  assignee_name: string;
  assignee_email: string;
  due_date: string;
  status: TaskStatus;
  position: number;
  completed_at: string | null;
  created_at: string;
};

export type ProjectComment = {
  id: string;
  project_id: string;
  body: string;
  author_name: string;
  created_at: string;
};

export type ProjectMember = {
  id: string;
  project_id: string;
  name: string;
  email: string;
  role: string | null;
};

export type ProjectFile = {
  id: string;
  project_id: string;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  created_at: string;
  signed_url?: string;
};
