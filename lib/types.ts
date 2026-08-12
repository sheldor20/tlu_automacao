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
  archived_at: string | null;
  archived_by: string | null;
  created_at: string;
  updated_at: string;
  current_stage_entered_at?: string | null;
  days_in_stage?: number;
  project?: Pick<Project, "id" | "name" | "status" | "archived_at" | "owner_name"> | null;
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
  source_project_id: string | null;
  responsible_user_id: string | null;
  responsible_name: string | null;
  responsible_email: string | null;
  name: string;
  type: "loteamento" | "construcao";
  start_date: string;
  expected_end_date: string | null;
  planned_budget: number;
  address: string | null;
  status: "planejamento" | "em_andamento" | "pausada" | "concluida";
  notes: string | null;
  archived_at: string | null;
  archived_by: string | null;
  progress_percent?: number;
  realized_total?: number;
  realized_current_month?: number;
  stage_weight_total?: number;
  last_activity_at?: string;
  created_at: string;
  updated_at: string;
};

export type ConstructionTemplate = {
  id: string;
  name: string;
  type: Construction["type"];
  description: string | null;
  is_active: boolean;
  macro_count?: number;
  micro_count?: number;
};

export type ProjectTemplate = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  task_count?: number;
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
  supplies: ConstructionSupply[];
  last_evidence_id: string | null;
  updated_at: string;
};

export type ConstructionSupply = {
  name: string;
  total_value: number;
  total_quantity: number;
  used_quantity: number;
};

export type UserProfile = {
  user_id: string;
  full_name: string | null;
  email: string;
  active: boolean;
  is_admin: boolean;
};

export type DepartmentSlug = "novos-negocios" | "obras" | "projetos" | "alugueis" | "indicadores";

export type Department = {
  slug: DepartmentSlug;
  name: string;
  position: number;
};

export type ProfileDepartment = {
  user_id: string;
  department_slug: DepartmentSlug;
  access_level: "viewer" | "member" | "manager" | "admin";
};

export type RentalStatus = "alugado" | "desocupado" | "aguardando_reforma";
export type LessorType = "pf" | "pj";

export type Rental = {
  id: string;
  name: string;
  property_address: string;
  status: RentalStatus;
  monthly_rent: number;
  lessor_type: LessorType;
  lessor_name: string;
  lease_start_date: string | null;
  lease_end_date: string | null;
  annual_adjustment_percent: number;
  broker_name: string | null;
  broker_commission: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type RentalMonthlySummary = {
  reference_month: string;
  rented_properties: number;
  gross_rent: number;
  broker_commission: number;
  net_rent: number;
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
  owner_user_id: string | null;
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
  assignee_user_id: string | null;
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
  user_id: string | null;
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

export type ConstructionSourceFile = Pick<
  ProjectFile,
  "id" | "file_path" | "file_name" | "mime_type" | "created_at" | "signed_url"
>;

export type ManagementAreaSlug =
  | "empresa"
  | "juridico-vendas-cobranca"
  | "rh-marketing-clientes"
  | "novos-negocios"
  | "obras-engenharia";

export type ManagementIndicatorValue = {
  id: string;
  area: Extract<ManagementAreaSlug, "empresa" | "juridico-vendas-cobranca" | "rh-marketing-clientes">;
  metric_key: string;
  reference_month: string;
  dimension_key: string;
  dimension_label: string | null;
  value: number;
  source: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
};

export type ManagementBusinessStageSnapshot = {
  stage: BusinessStage;
  area_count: number;
  potential_vgv: number;
  average_days: number;
};

export type ManagementConstructionSnapshot = {
  id: string;
  name: string;
  status: Construction["status"];
  planned_budget: number;
  realized_total: number;
  physical_progress: number;
  financial_progress: number;
};

export type ManagementRentalSnapshot = {
  total_properties: number;
  available_properties: number;
  rented_properties: number;
  renovation_properties: number;
};
