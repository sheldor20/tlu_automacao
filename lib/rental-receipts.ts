export const receiptFields = [
  { key: "rent_received", label: "Aluguel recebido (R$)", required: true },
  { key: "administration_fee", label: "Taxa de administração (R$)" },
  { key: "reserve_fund", label: "Fundo de reserva (R$)" },
  { key: "fines", label: "Multas recebidas (R$)" },
  { key: "reimbursements", label: "Reembolsos recebidos (R$)" },
  { key: "property_tax", label: "IPTU descontado (R$)" },
  { key: "income_tax", label: "IR descontado (R$)" },
] as const;

export type ReceiptField = typeof receiptFields[number]["key"];
export type ReceiptAmounts = Record<ReceiptField, number>;
export type ReceiptForm = Record<ReceiptField, string>;
export type RentalReceipt = ReceiptAmounts & {
  id: string;
  rental_id: string;
  reference_month: string;
  net_received: number;
  updated_at: string;
};
export type ReceiptSummary = ReceiptAmounts & {
  reference_month: string;
  receipt_count: number;
  net_received: number;
};

export const receiptFormula = "Aluguel + multas + reembolsos − taxa de administração − fundo de reserva − IPTU − IR.";
export const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export function receiptForm(receipt?: ReceiptAmounts): ReceiptForm {
  return Object.fromEntries(receiptFields.map(({ key }) => [key, receipt ? String(receipt[key]) : ""])) as ReceiptForm;
}

export function parseReceiptForm(form: ReceiptForm): ReceiptAmounts {
  return Object.fromEntries(receiptFields.map(({ key, label }) => {
    const raw = form[key].trim().replace(",", ".");
    if (key === "rent_received" && !raw) throw new Error("Informe o aluguel recebido, mesmo que seja zero.");
    if (raw && !/^\d+(\.\d{1,2})?$/.test(raw)) throw new Error(`${label}: informe um valor positivo ou zero, com até duas casas decimais.`);
    const amount = Number(raw || 0);
    if (!Number.isFinite(amount) || amount >= 10_000_000_000_000) throw new Error(`${label}: valor acima do limite permitido.`);
    return [key, amount];
  })) as ReceiptAmounts;
}

export function receiptTotals(amounts: ReceiptAmounts) {
  const cents = (key: ReceiptField) => Math.round(Number(amounts[key]) * 100);
  const credits = cents("rent_received") + cents("fines") + cents("reimbursements");
  const deductions = cents("administration_fee") + cents("reserve_fund") + cents("property_tax") + cents("income_tax");
  return { credits: credits / 100, deductions: deductions / 100, net: (credits - deductions) / 100 };
}

export function receiptYearMonths(year: number, rows: ReceiptSummary[]) {
  const byMonth = new Map(rows.map((row) => [row.reference_month, row]));
  return monthNames.map((label, index) => {
    const referenceMonth = `${year}-${String(index + 1).padStart(2, "0")}-01`;
    const row = byMonth.get(referenceMonth);
    return { label, referenceMonth, row, totals: row ? receiptTotals(row) : null };
  });
}
