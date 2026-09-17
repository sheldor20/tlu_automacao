import type {
  CashEntry,
  CollectionCase,
  QlikCompany,
  QlikWork,
} from "./operational-finance";
export type ClientAccount = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  synchronized_at: string;
};
export type ClientContract = {
  id: string;
  client_id: string;
  work_key: string | null;
  company_id: string;
  contract_number: string;
  lot: string | null;
  block: string | null;
  status: string | null;
  overdue_amount?: number;
  overdue_count?: number;
  oldest_due?: string | null;
  latest_due?: string | null;
  last_receipt?: string | null;
  collection_group?: import("./operational-finance").CollectionGroup;
  promise_overdue?: boolean;
  financial_status?: ClientFinancialStatus;
  receivable_amount?: number;
  deed_status?: string | null;
  registration_status?: string | null;
  status_synced_at?: string | null;
  sale_status?: string | null;
};
export type ClientFinancialStatus = "current" | "overdue" | "paid" | "unknown";
export const CLIENT_FINANCIAL_LABELS: Record<ClientFinancialStatus, string> = {
  current: "Adimplente",
  overdue: "Inadimplente",
  paid: "Quitado",
  unknown: "A confirmar",
};
export function clientFinancialStatus(
  allContracts: Pick<ClientContract, "financial_status" | "sale_status">[],
): ClientFinancialStatus {
  const contracts = allContracts.filter((c) => c.sale_status !== "Cancelado");
  if (contracts.some((c) => c.financial_status === "overdue")) return "overdue";
  if (
    !contracts.length ||
    contracts.some(
      (c) => !c.financial_status || c.financial_status === "unknown",
    )
  )
    return "unknown";
  if (contracts.some((c) => c.financial_status === "current")) return "current";
  return "paid";
}
export type ClientEvent = {
  id: string;
  client_id: string;
  contract_id: string | null;
  kind:
    | "contact"
    | "renegotiation"
    | "legal"
    | "document"
    | "regularization"
    | "collection";
  title: string;
  description: string;
  event_date: string;
  due_date: string | null;
  status: "open" | "in_progress" | "completed" | "cancelled";
  responsible_user_id: string | null;
  file_path: string | null;
  file_name: string | null;
  created_at: string;
};
export type ClientWorkspaceData = {
  total: number;
  totals?: Array<{
    collection_group: string;
    contracts: number;
    amount: number;
    promises: number;
  }>;
  clients: ClientAccount[];
  contracts: ClientContract[];
  entries: CashEntry[];
  cases: CollectionCase[];
  events?: ClientEvent[];
  companies: QlikCompany[];
  works: QlikWork[];
  users: Array<{ user_id: string; full_name: string }>;
  canWrite: boolean;
};
export const EVENT_LABELS = {
  contact: "Atendimento",
  renegotiation: "Renegociação",
  legal: "Processo jurídico",
  document: "Documento",
  regularization: "Regularização",
  collection: "Cobrança",
};
export const EVENT_STATUSES = {
  open: "Aberto",
  in_progress: "Em andamento",
  completed: "Concluído",
  cancelled: "Cancelado",
};
