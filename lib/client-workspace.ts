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
export type ClientFinancialStatus =
  | "current"
  | "overdue"
  | "paid"
  | "cancelled"
  | "cancelled_balance"
  | "no_balance"
  | "no_contract"
  | "review"
  | "unknown";
export const CLIENT_FINANCIAL_LABELS: Record<ClientFinancialStatus, string> = {
  current: "Adimplente",
  overdue: "Inadimplente",
  paid: "Quitado",
  cancelled: "Cancelado",
  cancelled_balance: "Cancelado com saldo",
  no_balance: "Sem saldo na base",
  no_contract: "Sem contrato",
  review: "Revisar vencimento",
  unknown: "Dados indisponíveis",
};
export const CLIENT_FINANCIAL_DESCRIPTIONS: Record<ClientFinancialStatus, string> = {
  current: "Há contrato em dia, sem parcelas vencidas na base publicada.",
  overdue: "Há parcela vencida em pelo menos um contrato. O atraso tem prioridade na classificação.",
  paid: "Todos os contratos não cancelados estão quitados na origem, sem saldo em aberto na base publicada.",
  cancelled: "Os contratos estão cancelados na origem, sem saldo em aberto na base publicada.",
  cancelled_balance: "Há contrato cancelado com saldo a receber. É necessário conciliar o saldo na origem.",
  no_balance: "Não há saldo a receber na base publicada, mas a origem não confirma a quitação de todos os contratos. Não equivale a Quitado.",
  no_contract: "O cadastro ainda não possui contrato vinculado.",
  review: "Há parcela com saldo positivo e sem vencimento informado. Corrija o vencimento na origem.",
  unknown: "A base financeira ainda não foi publicada ou faltam dados para classificar com segurança.",
};
export function clientFinancialStatus(
  allContracts: Pick<ClientContract, "financial_status" | "sale_status">[],
): ClientFinancialStatus {
  if (!allContracts.length) return "no_contract";
  // Never hide a balance anomaly just because the sale was cancelled.
  if (allContracts.some((c) => c.financial_status === "overdue")) return "overdue";
  if (allContracts.some((c) => c.financial_status === "cancelled_balance"))
    return "cancelled_balance";
  const contracts = allContracts.filter(
    (c) => c.sale_status !== "Cancelado" && c.financial_status !== "cancelled",
  );
  if (!contracts.length)
    return allContracts.every((c) => c.financial_status === "cancelled")
      ? "cancelled"
      : "unknown";
  if (contracts.some((c) => c.financial_status === "review")) return "review";
  if (contracts.some((c) => !c.financial_status || c.financial_status === "unknown"))
    return "unknown";
  // Zero balance on another contract must not hide an active, current contract.
  if (contracts.some((c) => c.financial_status === "current")) return "current";
  // Zero receivables is not proof of payoff; require affirmative source evidence.
  if (contracts.some((c) => c.financial_status === "no_balance")) return "no_balance";
  return contracts.every((c) => c.financial_status === "paid") ? "paid" : "unknown";
}
export type ClientEvent = {
  id: string;
  client_id: string;
  contract_id: string | null;
  kind: "contact" | "renegotiation" | "legal" | "document" | "regularization" | "collection";
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
  totals?: Array<{ collection_group: string; contracts: number; amount: number; promises: number }>;
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
