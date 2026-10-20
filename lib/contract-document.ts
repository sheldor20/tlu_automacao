import rentalTemplate from "./rental-contract-template.json" with { type: "json" };
import { CONTRACT_TYPES, contractProtocol, type ContractRequest } from "./contract-requests.ts";

const date = (v: string) => v ? v.split("-").reverse().join("/") : "[PREENCHER]";
export function contractDocumentText(row: ContractRequest) {
  const d = row.details;
  const values: Record<string, string> = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v === null || v === "" ? "[PREENCHER]" : String(v)]));
  for (const k of ["start_date", "end_date", "first_payment", "signature_date"] as const) values[k] = date(d[k]);
  values.amount = d.amount === null ? "[PREENCHER]" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(d.amount);
  const parties = `${d.type === "rental" ? "LOCADOR" : "PARTE A"}: ${d.party_a_name}, CPF/CNPJ ${d.party_a_tax_id}, ${d.party_a_qualification || "[QUALIFICAÇÃO A COMPLETAR]"}, endereço: ${d.party_a_address}. Representante: ${d.party_a_representative || "[SE APLICÁVEL]"}.\n\n${d.type === "rental" ? "LOCATÁRIA" : "PARTE B"}: ${d.party_b_name}, CPF/CNPJ ${d.party_b_tax_id}, ${d.party_b_qualification || "[QUALIFICAÇÃO A COMPLETAR]"}, endereço: ${d.party_b_address}. Representante: ${d.party_b_representative || "[SE APLICÁVEL]"}.`;
  const heading = `MINUTA PARA REVISÃO E FINALIZAÇÃO\n${CONTRACT_TYPES[d.type]}${d.type === "other" ? `: ${d.other_type}` : ""}\n${contractProtocol(row.protocol)} - ${d.title}\nEmpresa solicitante: ${d.company_name}\n\nIDENTIFICAÇÃO DAS PARTES\n${parties}`;
  if (d.type === "rental") return `${heading}\n\n${rentalTemplate.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] || "[PREENCHER]")}\n\nCONDIÇÕES ESPECÍFICAS PARA CONFERÊNCIA\nObjeto / escopo: ${d.object}\nPagamento: ${d.payment_terms || "[PREENCHER]"}\nGarantia: ${d.guarantee || "[DEFINIR]"}\nObservações: ${d.notes || "Sem observações adicionais."}`;
  return `${heading}\n\nDADOS PARA ELABORAÇÃO DO CONTRATO\nEste tipo ainda não possui minuta padrão. Utilize os dados abaixo para elaborar e finalizar o instrumento.\n\nObjeto: ${d.object}\nValor: ${values.amount}\nCondições de pagamento: ${d.payment_terms || "[PREENCHER]"}\nVigência: ${date(d.start_date)} a ${date(d.end_date)}\nPrazo desejado: ${date(d.deadline)}\nContrato original: ${d.original_contract || "[SE APLICÁVEL]"}\nContato: ${d.contact_email} ${d.contact_phone}\nCondições e observações: ${d.notes || "[PREENCHER]"}`;
}
// RTF is a Word-supported editable document format, served as .doc for the requested workflow.
// Escape control characters and encode Unicode as signed UTF-16, never interpolate RTF commands.
export function wordDocument(text: string) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], code = text.charCodeAt(i);
    if (ch === "\n") out += "\\par\n";
    else if (ch === "\\" || ch === "{" || ch === "}") out += "\\" + ch;
    else if (code > 127) out += `\\u${code > 32767 ? code - 65536 : code}?`;
    else if (code >= 32) out += ch;
  }
  return `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Arial;}}\\paperw11906\\paperh16838\\margl1417\\margr1417\\margt1134\\margb1134\\f0\\fs22\\sa160 ${out}}`;
}
