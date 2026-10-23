import { z } from "zod";

export const DISTRATO_SOURCE = "https://terralotusurbanismo.us.qlikcloud.com/sense/app/e3d13862-ec1f-4332-8a5b-df4c7b93fa7c/sheet/bd84bea2-0f3c-4dc6-9081-0eab08502ba3/state/analysis";
export const JURISCALC_SOURCE = "https://juriscalc.tjdft.jus.br/publico/calculos";
export const REGIME_LABELS = { com_lei: "Com Lei do Distrato", sem_lei: "Sem Lei do Distrato" } as const;
const money = z.number().finite().min(0).max(1e10);
const text = z.string().trim().max(4000);
export const distratoInputSchema = z.object({
  requestId: z.uuid(),
  contractId: z.string().trim().min(1).max(160),
  sourceRevision: z.string().regex(/^[a-f0-9]{64}$/),
  regime: z.enum(["com_lei", "sem_lei"]),
  correctionDate: z.iso.date(),
  saleDate: z.iso.date(),
  saleValue: money.refine((n) => n > 0, "Informe o valor original de venda."),
  fruitionMonths: z.number().int().min(0).max(1200),
  brokerage: money,
  municipalTaxes: money,
  sellerDocument: text,
  sellerAddress: text,
  sellerRepresentative: text,
  buyerDocument: text,
  buyerQualification: text,
  buyerAddress: text,
  registration: text,
  registryOffice: text,
  reason: text,
  possession: text,
  refundTerms: text,
  city: text,
  notes: text,
}).strict().superRefine((data, ctx) => {
  if (data.saleDate > data.correctionDate) ctx.addIssue({ code: "custom", path: ["saleDate"], message: "A venda deve ser anterior ou igual à data do cálculo." });
});
export type DistratoInput = z.infer<typeof distratoInputSchema>;
export type DistratoReceipt = { id: string; date: string; amount: number; description: string };
export type DistratoUnit = {
  contractId: string; contractNumber: string; companyId: string; companyName: string;
  workKey: string; workCode: string; workName: string; block: string; lot: string;
  buyerName: string; synchronizedAt: string; receipts: DistratoReceipt[];
};
export type CorrectedValue = { id: string; date: string; original: number; corrected: number; factor: number; indices: string[] };
export type DistratoCorrection = {
  source: string; index: "INPC"; interest: 0; referenceDate: string;
  availableThrough: string; values: CorrectedValue[];
};
export type DistratoCalculation = {
  property: CorrectedValue; receipts: CorrectedValue[]; nominalPaid: number; correctedPaid: number;
  deductions: Array<{ label: string; basis: string; amount: number }>;
  roundingAdjustment: number; totalDeductions: number; balance: number; refund: number;
};
export type DistratoDocument = {
  id: string; created_at: string; created_by: string; input: DistratoInput;
  unit: DistratoUnit; correction: DistratoCorrection; calculation: DistratoCalculation;
  term: string; draft: boolean;
};
export const roundMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const brDate = (date: string) => date.slice(0, 10).split("-").reverse().join("/");
export const unitIdentifier = (unit: Pick<DistratoUnit, "workCode" | "block" | "lot">) => [unit.workCode, unit.block, unit.lot].join(".");

export function calculateDistrato(input: Pick<DistratoInput, "regime" | "fruitionMonths" | "brokerage" | "municipalTaxes">, property: CorrectedValue, receipts: CorrectedValue[]): DistratoCalculation {
  if (!receipts.length || !Number.isFinite(property.corrected) || property.corrected <= 0 || receipts.some((r) => !Number.isFinite(r.corrected) || !Number.isFinite(r.original))) throw new Error("Valores atualizados inválidos ou pagamentos ausentes.");
  if (!REGIME_LABELS[input.regime] || !Number.isInteger(input.fruitionMonths) || input.fruitionMonths < 0 || !Number.isFinite(input.brokerage) || input.brokerage < 0 || !Number.isFinite(input.municipalTaxes) || input.municipalTaxes < 0) throw new Error("Descontos inválidos.");
  const correctedPaid = roundMoney(receipts.reduce((sum, r) => sum + r.corrected, 0));
  const nominalPaid = roundMoney(receipts.reduce((sum, r) => sum + r.original, 0));
  const withLaw = input.regime === "com_lei";
  const raw = withLaw ? [
    { label: "Despesas administrativas e penais", basis: "10% do valor atualizado do imóvel", amount: property.corrected * .10 },
  ] : [
    { label: "Despesas administrativas", basis: "5% das parcelas atualizadas", amount: correctedPaid * .05 },
    { label: "Despesas tributárias", basis: "5% das parcelas atualizadas", amount: correctedPaid * .05 },
    { label: "Multa contratual", basis: "10% do valor atualizado do imóvel", amount: property.corrected * .10 },
  ];
  raw.push(
    { label: "Intermediação e corretagem", basis: "Valor informado", amount: input.brokerage },
    { label: "Fruição", basis: `${withLaw ? "0,75%" : "1%"} do imóvel × ${input.fruitionMonths} mês(es) · ${withLaw ? "desde a posse" : "desde o inadimplemento"}`, amount: property.corrected * (withLaw ? .0075 : .01) * input.fruitionMonths },
    { label: "Impostos e tributos municipais", basis: "Valor informado", amount: input.municipalTaxes },
  );
  // Preserve the reference workbook's formulas before rounding the total.
  const totalDeductions = roundMoney(raw.reduce((sum, r) => sum + r.amount, 0));
  const deductions = raw.map((r) => ({ ...r, amount: roundMoney(r.amount) }));
  const roundingAdjustment = roundMoney(totalDeductions - deductions.reduce((sum, r) => sum + r.amount, 0));
  const balance = roundMoney(correctedPaid - totalDeductions);
  return { property, receipts, correctedPaid, nominalPaid, deductions, roundingAdjustment, totalDeductions, balance, refund: Math.max(0, balance) };
}

export function distratoTerm(input: DistratoInput, unit: DistratoUnit, calculation: DistratoCalculation) {
  const fill = (value: string, label: string) => value.trim() || `[${label}]`;
  const draft = [input.sellerDocument, input.sellerAddress, input.sellerRepresentative, input.buyerDocument, input.buyerQualification, input.buyerAddress, input.registration, input.registryOffice, input.reason, input.possession, input.city].some((v) => !v.trim()) || (calculation.refund > 0 && !input.refundTerms.trim()) || calculation.balance < 0;
  const term = `INSTRUMENTO PARTICULAR DE DISTRATO DE COMPROMISSO DE COMPRA E VENDA DE LOTE

VENDEDORA: ${unit.companyName}, CNPJ ${fill(input.sellerDocument, "CNPJ")}, com sede em ${fill(input.sellerAddress, "endereço da vendedora")}, representada por ${fill(input.sellerRepresentative, "representante e qualificação")}.

COMPRADOR(ES): ${unit.buyerName}, CPF/documento ${fill(input.buyerDocument, "documento do comprador")}, ${fill(input.buyerQualification, "qualificação e demais titulares")}, com endereço em ${fill(input.buyerAddress, "endereço do comprador")}.

1. CONTRATO E IMÓVEL
As partes resolvem, de comum acordo, o compromisso de compra e venda nº ${unit.contractNumber}, celebrado em ${brDate(input.saleDate)}, referente ao empreendimento ${unit.workName}, quadra ${unit.block}, lote ${unit.lot}, identificador ${unitIdentifier(unit)}, matrícula ${fill(input.registration, "matrícula")}, do ${fill(input.registryOffice, "cartório")}.
Motivo: ${fill(input.reason, "motivo do distrato")}.

2. CRITÉRIO DE CÁLCULO
O enquadramento selecionado pelo responsável foi ${REGIME_LABELS[input.regime]}, sujeito à conferência da sua aplicação ao contrato. A memória de cálculo anexa integra este instrumento. Os pagamentos foram atualizados individualmente pelo INPC, sem juros, até ${brDate(input.correctionDate)}, com os índices disponíveis no TJDFT. O imóvel foi atualizado separadamente desde a data da venda. As bases e períodos dos descontos constam do anexo. A seleção do enquadramento não substitui a verificação contratual e legal de cada dedução.

3. APURAÇÃO FINANCEIRA
Valor atualizado do imóvel: ${brl(calculation.property.corrected)}. Pagamentos nominais: ${brl(calculation.nominalPaid)}. Pagamentos atualizados: ${brl(calculation.correctedPaid)}. Descontos: ${brl(calculation.totalDeductions)}. Saldo apurado: ${brl(calculation.balance)}. Valor a restituir conforme o cálculo: ${brl(calculation.refund)}.
${calculation.balance < 0 ? "O saldo negativo demanda definição expressa das partes antes da emissão definitiva. A memória de cálculo não constitui, por si só, reconhecimento de dívida pelo comprador." : "As partes declaram ciência dos valores e dos descontos discriminados na memória de cálculo."}

4. RESTITUIÇÃO
${calculation.refund > 0 ? `A vendedora restituirá ${brl(calculation.refund)}, nas seguintes condições: ${fill(input.refundTerms, "quantidade de parcelas, valores, vencimentos, forma de pagamento, atualização e condições de atraso")}. A quitação de cada parcela dependerá do efetivo recebimento.` : "Não há valor positivo a restituir na presente apuração. Eventuais obrigações adicionais dependerão de ajuste expresso, sem reconhecimento automático de dívida."}

5. POSSE, ENCARGOS E BENFEITORIAS
${fill(input.possession, "situação da posse, data e condições de devolução, encargos e tratamento das benfeitorias")}.
A responsabilidade por encargos observará os períodos e valores expressamente discriminados neste instrumento e seus anexos.

6. QUITAÇÃO E PROVIDÊNCIAS FINAIS
Cumpridas as obrigações deste instrumento, as partes darão quitação às obrigações aqui expressamente discriminadas, preservados os direitos indisponíveis e as obrigações ressalvadas. Eventuais providências registrais observarão a situação do imóvel e os requisitos aplicáveis.
${input.notes ? `Ressalvas e condições adicionais: ${input.notes}\n` : ""}As partes declaram ter lido este instrumento e a memória de cálculo, compreendido suas condições e recebido uma via de ambos.

${fill(input.city, "Município/UF")}, ${brDate(input.correctionDate)}.

________________________________
VENDEDORA — ${unit.companyName}

________________________________
COMPRADOR(ES) — ${unit.buyerName}

Testemunha 1 — Nome: ________________________ CPF: ________________________

Testemunha 2 — Nome: ________________________ CPF: ________________________

Anexo I — Memória de cálculo e relação dos pagamentos.`;
  return { term, draft };
}
