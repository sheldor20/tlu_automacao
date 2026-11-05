import { distratoInputSchema, type DistratoDocument, type DistratoInput } from "./distratos.ts";

export type GenerationInput = Omit<DistratoInput, "requestId">;
export type SaleSource = { saleDate: string | null; saleValue: number | null; label: string | null };
export type BatchItem = { contractId: string; status: "generated" | "failed" | "cancelled"; document?: DistratoDocument; error?: string };
type Journal = Pick<Storage, "getItem" | "setItem">;
const validationId = "00000000-0000-4000-8000-000000000000";

// Only opaque fingerprints and request IDs are kept in the tab's journal. The
// server remains responsible for authorization, source revisions and idempotency.
export function createGenerationLedger(deps: {
  journal: () => Journal;
  execute: (input: DistratoInput) => Promise<DistratoDocument>;
  uuid?: () => string;
}) {
  const requests = new Map<string, { id: string; pending?: Promise<DistratoDocument>; document?: DistratoDocument }>();
  return async (actorId: string, body: GenerationInput): Promise<DistratoDocument> => {
    if (!actorId) throw new Error("Entre novamente para gerar os documentos.");
    const normalized = distratoInputSchema.parse({ ...body, requestId: validationId });
    const input: GenerationInput = { ...normalized };
    // Keep the fingerprint independent of the operation's UUID.
    Reflect.deleteProperty(input, "requestId");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([actorId, input])));
    const key = `distrato-generation:${Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("")}`;
    let request = requests.get(key);
    if (!request) {
      let id: string;
      try {
        const journal = deps.journal();
        const saved = journal.getItem(key);
        id = saved && distratoInputSchema.shape.requestId.safeParse(saved).success ? saved : (deps.uuid ?? (() => crypto.randomUUID()))();
        journal.setItem(key, id);
      } catch {
        throw new Error("Não foi possível preservar a chave desta geração. Habilite o armazenamento desta aba antes de tentar novamente.");
      }
      request = { id };
      requests.set(key, request);
    }
    if (request.document) return request.document;
    if (request.pending) return request.pending;
    const entry = request;
    const pending = Promise.resolve().then(() => deps.execute({ ...input, requestId: entry.id })).then(document => {
      if (document.created_by !== actorId || document.input.requestId !== entry.id || document.input.contractId !== input.contractId || document.unit.contractId !== input.contractId || document.input.sourceRevision !== input.sourceRevision) {
        throw new Error("O documento recebido não corresponde ao contrato e à geração solicitados.");
      }
      entry.document = document;
      return document;
    }).finally(() => { entry.pending = undefined; });
    entry.pending = pending;
    // On an uncertain response, keep this ID. An explicit retry asks the existing
    // endpoint for the same operation, including after a reload in this tab.
    return pending;
  };
}

export async function generateContractBatch(options: {
  contractIds: readonly string[];
  cancelled: () => boolean;
  generate: (contractId: string) => Promise<DistratoDocument>;
  onResult?: (item: BatchItem) => void;
}): Promise<BatchItem[]> {
  const result: BatchItem[] = [];
  for (const contractId of new Set(options.contractIds)) {
    let item: BatchItem;
    if (options.cancelled()) item = { contractId, status: "cancelled" };
    else {
      try { item = { contractId, status: "generated", document: await options.generate(contractId) }; }
      catch (e) { item = { contractId, status: "failed", error: e instanceof Error ? e.message : "Falha ao gerar este contrato." }; }
    }
    result.push(item);
    options.onResult?.(item);
  }
  return result;
}

export function consolidateDistratos(contractIds: readonly string[], documents: ReadonlyMap<string, DistratoDocument>) {
  const selected = [...new Set(contractIds)];
  const rows: DistratoDocument[] = [];
  const missing: string[] = [];
  const receiptOwners = new Map<string, string>();
  for (const id of selected) {
    const document = documents.get(id);
    if (!document) { missing.push(id); continue; }
    if (document.unit.contractId !== id || document.input.contractId !== id) throw new Error("Documento vinculado a outro contrato. Confira a seleção.");
    for (const receipt of document.unit.receipts) {
      if (receiptOwners.has(receipt.id)) throw new Error("Recebimento repetido nos documentos selecionados. Confira os vínculos antes de consolidar.");
      receiptOwners.set(receipt.id, id);
    }
    rows.push(document);
  }
  const sum = (field: "nominalPaid" | "correctedPaid" | "totalDeductions" | "refund") => {
    const cents = rows.reduce((total, row) => {
      const value = Math.round(row.calculation[field] * 100);
      if (!Number.isSafeInteger(value) || !Number.isSafeInteger(total + value)) throw new Error("Total fora do limite de precisão.");
      return total + value;
    }, 0);
    return cents / 100;
  };
  return { rows, missing, nominalPaid: sum("nominalPaid"), correctedPaid: sum("correctedPaid"), totalDeductions: sum("totalDeductions"), refund: sum("refund") };
}

export function consolidatedCsv(summary: ReturnType<typeof consolidateDistratos>, sources: ReadonlyMap<string, SaleSource | null> = new Map()) {
  if (summary.missing.length || !summary.rows.length) throw new Error("Gere os documentos de todos os contratos selecionados antes de exportar.");
  const money = (value: number) => value.toFixed(2).replace(".", ",");
  const cell = (value: string) => `"${(/^[\s]*[=+\-@]|^[\t\r\n]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
  const header = ["ID do contrato", "Contrato", "Cliente", "Documento", "Situação", "Data da venda na origem", "Valor de venda na origem", "Fonte consultada", "Data da venda usada no cálculo", "Base de venda usada no cálculo", "Atualizar até", "Meses de fruição", "Pagamentos nominais da origem", "Pagamentos atualizados", "Descontos", "Saldo individual", "Restituição individual"];
  const rows = summary.rows.map(d => {
    const source = sources.get(d.unit.contractId);
    return [d.unit.contractId, d.unit.contractNumber, d.unit.buyerName, d.id, d.draft ? "Minuta" : "Documento", source?.saleDate ?? "Não confirmado", source?.saleValue != null ? money(source.saleValue) : "Não confirmado", source?.label ?? "Não confirmada", d.input.saleDate, money(d.input.saleValue), d.input.correctionDate, String(d.input.fruitionMonths), money(d.calculation.nominalPaid), money(d.calculation.correctedPaid), money(d.calculation.totalDeductions), money(d.calculation.balance), money(d.calculation.refund)];
  });
  rows.push(["TOTAL", "", "", "", "Resumo para conferência; sem compensação entre contratos", "", "", "", "", "", "", "", money(summary.nominalPaid), money(summary.correctedPaid), money(summary.totalDeductions), "", money(summary.refund)]);
  return "\uFEFF" + [header, ...rows].map(row => row.map(cell).join(";")).join("\r\n");
}
