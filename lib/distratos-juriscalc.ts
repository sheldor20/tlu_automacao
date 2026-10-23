import { z } from "zod";
import { JURISCALC_SOURCE, roundMoney, type DistratoCorrection, type DistratoReceipt, type CorrectedValue } from "./distratos.ts";

const itemSchema = z.object({ descricao: z.string(), data: z.string(), valorInicial: z.coerce.number().finite(), valorCorrigido: z.coerce.number().finite(), juros: z.coerce.number().finite(), total: z.coerce.number().finite(), indicesDeCorrecao: z.array(z.string()) });
const responseSchema = z.array(z.unknown()).min(1).transform((rows) => z.object({ itensDeSaida: z.array(itemSchema), total: z.coerce.number().finite(), dataFinalDaCorrecao: z.string(), dataFinalDoCalculo: z.string() }).parse(rows[0]));

export function juriscalcPayload(values: Array<{ id: string; date: string; amount: number }>, referenceDate: string) {
  return {
    dataFinalCalculo: referenceDate, indiceString: "INPC", juros: null,
    valores: values.map((v) => ({ descricao: v.id, dataInicio: v.date, valor: v.amount, valorBruto: v.amount, especieValor: "DEBITO" })),
    multas: [], honorarios: [], custas: [], art354: true, jurosAteDataFinalDoCalculo: true, multasArt523: [], honorariosArt523: [],
  };
}

export function parseJuriscalcResponse(raw: unknown, values: Array<{ id: string; date: string; amount: number }>, referenceDate: string): DistratoCorrection {
  const report = responseSchema.parse(raw);
  if (report.dataFinalDoCalculo !== referenceDate.split("-").reverse().join("/")) throw new Error("TJDFT retornou uma data de cálculo diferente da solicitada.");
  const rows = report.itensDeSaida.filter((r) => r.descricao !== "Totais");
  if (rows.length !== values.length || new Set(rows.map((r) => r.descricao)).size !== values.length) throw new Error("TJDFT retornou uma relação incompleta de valores.");
  const corrected: CorrectedValue[] = values.map((value) => {
    const row = rows.find((r) => r.descricao === value.id);
    if (!row || row.data !== value.date.split("-").reverse().join("/") || Math.abs(row.valorInicial - value.amount) > .005 || row.juros !== 0 || Math.abs(row.total - row.valorCorrigido) > .005 || !row.indicesDeCorrecao.every((s) => s.includes("INPC"))) throw new Error("TJDFT retornou valores, datas, juros ou índice incompatíveis com a solicitação.");
    return { id: value.id, date: value.date, original: value.amount, corrected: row.valorCorrigido, factor: value.amount === 0 ? 1 : row.valorCorrigido / value.amount, indices: row.indicesDeCorrecao };
  });
  if (Math.abs(roundMoney(corrected.reduce((sum, r) => sum + r.corrected, 0)) - report.total) > .01) throw new Error("O total do TJDFT não confere com os valores individuais.");
  return { source: JURISCALC_SOURCE, index: "INPC", interest: 0, referenceDate, availableThrough: report.dataFinalDaCorrecao, values: corrected };
}

export async function correctDistratoValues(receipts: DistratoReceipt[], saleDate: string, saleValue: number, referenceDate: string, fetcher: typeof fetch = fetch) {
  const values = [{ id: "imovel", date: saleDate, amount: saleValue }, ...receipts.map((r, i) => ({ id: `parcela-${i + 1}`, date: r.date, amount: r.amount }))];
  if (values.some((r) => r.date > referenceDate || !Number.isFinite(r.amount) || r.amount === 0) || new Set(receipts.map((r) => r.id)).size !== receipts.length) throw new Error("Há pagamentos sem valor, duplicados ou posteriores à data do cálculo.");
  // Isolate each entry as a debit so payments are corrected independently,
  // rather than deducted from a running judicial-debt balance.
  const all: CorrectedValue[] = [];
  let availableThrough: string | undefined;
  for (let start = 0; start < values.length; start += 200) {
    const batch = values.slice(start, start + 200);
    const response = await fetcher("https://juriscalc.tjdft.jus.br/public/calculos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(juriscalcPayload(batch, referenceDate)), cache: "no-store", signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error("A atualização do TJDFT está indisponível. Tente novamente; nenhum índice será estimado.");
    const parsed = parseJuriscalcResponse(await response.json(), batch, referenceDate);
    if (availableThrough && parsed.availableThrough !== availableThrough) throw new Error("Os índices do TJDFT mudaram durante o cálculo. Gere novamente.");
    availableThrough = parsed.availableThrough;
    all.push(...parsed.values);
  }
  return { source: JURISCALC_SOURCE, index: "INPC" as const, interest: 0 as const, referenceDate, availableThrough: availableThrough!, values: all };
}
