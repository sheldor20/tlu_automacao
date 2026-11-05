import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { FileDown, RefreshCw, ShieldCheck } from "lucide-react";
import { Button, Field } from "@/components/ui";
import { paymentFetch } from "@/lib/payment-client";
import { getSupabase } from "@/lib/supabase";
import { salePrefill } from "@/lib/distratos-prefill";
import { localToday } from "@/lib/operational-finance";
import { brl, brDate, distratoInputSchema, REGIME_LABELS, roundMoney, unitIdentifier, type DistratoDocument, type DistratoInput, type DistratoUnit } from "@/lib/distratos";
import type { GenerationInput, SaleSource } from "@/lib/distratos-batch";

type Form = Omit<DistratoInput, "requestId" | "sourceRevision" | "contractId" | "regime" | "fruitionMonths" | "brokerage" | "municipalTaxes"> & { regime: DistratoInput["regime"] | ""; fruitionMonths: number | ""; brokerage: number | ""; municipalTaxes: number | "" };
type Detail = { unit: DistratoUnit; sourceRevision: string; history: Array<Pick<DistratoDocument, "id" | "created_at" | "draft" | "input" | "calculation">> };
const blank = (): Form => ({ regime: "", correctionDate: localToday(), saleDate: "", saleValue: 0, fruitionMonths: "", brokerage: "", municipalTaxes: "", sellerDocument: "", sellerAddress: "", sellerRepresentative: "", buyerDocument: "", buyerQualification: "", buyerAddress: "", registration: "", registryOffice: "", reason: "", possession: "", refundTerms: "", city: "", notes: "" });

export type ContractReport = { ready: boolean; busy: boolean; document: DistratoDocument | null; sourceSale: SaleSource | null; nominalPaid: number | null };
export type ContractHandle = { generate: () => Promise<DistratoDocument> };
export function ContractPanel({ contractId, label, canWrite, locked, ref, onReport, createDocument }: {
  contractId: string; label: string; canWrite: boolean; locked: boolean;
  ref: Ref<ContractHandle>;
  onReport: (id: string, report: ContractReport) => void;
  createDocument: (input: GenerationInput) => Promise<DistratoDocument>;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [document, setDocument] = useState<DistratoDocument | null>(null);
  const [currentDocument, setCurrentDocument] = useState<DistratoDocument | null>(null);
  const [loadingUnit, setLoadingUnit] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [saleLoading, setSaleLoading] = useState(false);
  const [saleMessage, setSaleMessage] = useState("");
  const [sourceSale, setSourceSale] = useState<SaleSource | null>(null);
  const [error, setError] = useState("");
  const active = useRef(false);
  const inFlight = useRef<Promise<DistratoDocument> | null>(null);
  const formElement = useRef<HTMLFormElement>(null);

  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    const signal = controller.signal;
    async function load() {
      try {
        const data: Detail = await paymentFetch(`/api/distratos?contractId=${encodeURIComponent(contractId)}`, { signal });
        if (signal.aborted) return;
        if (data.unit.contractId !== contractId) throw new Error("A consulta retornou outro contrato.");
        setDetail(data);
        setForm(current => ({ ...current, fruitionMonths: data.unit.paidInstallments?.count ?? "" }));
        setLoadingUnit(false); setSaleLoading(true);
        try {
          const sale = await paymentFetch(`/api/distratos/sale?contractId=${encodeURIComponent(contractId)}`, { signal });
          if (signal.aborted) return;
          const confirmed = salePrefill(sale, localToday());
          setSourceSale({ saleDate: confirmed.saleDate || null, saleValue: confirmed.saleValue > 0 ? confirmed.saleValue : null, label: typeof sale.source === "string" ? sale.source : null });
          setForm(current => ({ ...current, ...confirmed }));
          setSaleMessage(confirmed.saleDate && confirmed.saleValue ? `Data e valor da venda consultados no ${sale.source}. Confira com o contrato.` : "Data ou valor original não confirmados pela fonte. Confira os campos pendentes no contrato.");
        } catch {
          if (!signal.aborted) setSaleMessage("A data e o valor original da venda precisam ser preenchidos conforme o contrato. Os pagamentos abaixo vieram da base do Qlik.");
        } finally { if (!signal.aborted) setSaleLoading(false); }
      } catch (e) { if (!signal.aborted) { setError((e as Error).message); setLoadingUnit(false); } }
    }
    void load();
    return () => { active.current = false; controller.abort(); };
  }, [contractId]);

  function change<K extends keyof Form>(key: K, value: Form[K]) {
    setForm(current => ({ ...current, [key]: value })); setDocument(null); setCurrentDocument(null);
  }
  async function download(id: string) {
    setDownloading(true); setError("");
    try {
      const session = await getSupabase()?.auth.getSession();
      const response = await fetch(`/api/distratos/${encodeURIComponent(id)}?pdf=1`, { headers: { Authorization: `Bearer ${session?.data.session?.access_token || ""}` }, cache: "no-store" });
      if (!response.ok) throw new Error((await response.json()).error || "Não foi possível baixar o PDF.");
      const url = URL.createObjectURL(await response.blob());
      if (!active.current) { URL.revokeObjectURL(url); return; }
      const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = `distrato-${id}.pdf`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { if (active.current) setError((e as Error).message); }
    finally { if (active.current) setDownloading(false); }
  }
  const unit = detail?.unit;
  const parsed = detail && distratoInputSchema.safeParse({ ...form, contractId, sourceRevision: detail.sourceRevision, requestId: "00000000-0000-4000-8000-000000000000" });
  const correctionDateValid = Boolean(parsed?.success && form.saleDate >= "1994-07-01" && form.correctionDate <= localToday() && !saleLoading);
  const ready = Boolean(canWrite && correctionDateValid && unit?.receipts.length);
  const nominalPaid = unit ? roundMoney(unit.receipts.reduce((total, receipt) => total + receipt.amount, 0)) : null;
  useEffect(() => {
    onReport(contractId, { ready: ready && Boolean(formElement.current?.checkValidity()), busy: generating || downloading, document: currentDocument, sourceSale, nominalPaid });
  }, [contractId, ready, form, generating, downloading, currentDocument, sourceSale, nominalPaid, onReport]);

  async function generate(): Promise<DistratoDocument> {
    if (inFlight.current) return inFlight.current;
    if (!ready || !detail || !parsed?.success) throw new Error("Confira os campos obrigatórios e os pagamentos deste contrato.");
    setGenerating(true); setError("");
    const pending = createDocument(parsed.data).then(result => {
      if (active.current) {
        setDocument(result); setCurrentDocument(result);
        setDetail(current => current ? { ...current, history: [result, ...current.history.filter(r => r.id !== result.id)].slice(0, 20) } : current);
      }
      return result;
    }).catch(e => { if (active.current) setError((e as Error).message); throw e; })
      .finally(() => { inFlight.current = null; if (active.current) setGenerating(false); });
    inFlight.current = pending;
    return pending;
  }
  useImperativeHandle(ref, () => ({ generate }));
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    try { const result = await generate(); if (active.current) await download(result.id); } catch { /* The panel keeps the error and the request ID for an explicit retry. */ }
  }
  async function openHistory(id: string) {
    setError("");
    try {
      const data = await paymentFetch(`/api/distratos/${encodeURIComponent(id)}`);
      if (!active.current) return;
      if (data.document.unit.contractId !== contractId) throw new Error("Este documento pertence a outro contrato.");
      setDocument(data.document);
    } catch (e) { if (active.current) setError((e as Error).message); }
  }
  const textField = (key: keyof Form, title: string) => <Field label={title}><input value={String(form[key])} maxLength={4000} onChange={e => change(key, e.target.value as never)} /></Field>;
  return <article className="distrato-contract" aria-label={label} data-contract-id={contractId}>
    <header className="distrato-panel">
      <h2>{label}</h2>
      {error ? <div className="distrato-message error" role="alert">{error}</div> : null}
      {loadingUnit ? <p role="status">Consultando este contrato e seus recebimentos…</p> : null}
      {unit ? <div className="distrato-unit"><strong>{unit.buyerName}</strong><span>{unitIdentifier(unit)} · Contrato {unit.contractNumber}</span><small>{unit.companyName} · Base Qlik publicada em {new Date(unit.synchronizedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</small></div> : null}
    </header>
    {unit ? <form ref={formElement} onSubmit={(e) => void submit(e)}>
      <fieldset disabled={locked || generating || downloading || !canWrite} className="distrato-form-fieldset">
        <section className="distrato-panel">
          <div className="distrato-panel-title"><ShieldCheck size={22} /><div><h2>2. Regra e cálculo</h2><p>A regra é escolhida pelo usuário para este contrato.</p></div></div>
          <div className="distrato-regimes" role="group" aria-label="Enquadramento do distrato">{Object.entries(REGIME_LABELS).map(([value, label]) => <label key={value} className={form.regime === value ? "selected" : ""}><input required type="radio" name={`regime-${contractId}`} value={value} checked={form.regime === value} onChange={() => change("regime", value as DistratoInput["regime"])} /><span><strong>{label}</strong><small>{value === "com_lei" ? "10% do imóvel + fruição de 0,75% ao mês" : "5% + 5% dos pagamentos, multa de 10% e fruição de 1% ao mês"}</small></span></label>)}</div>
          {saleLoading ? <p role="status">Consultando a data e o valor original da venda no Qlik…</p> : <p className="distrato-help">{saleMessage}</p>}
          <div className="distrato-fields">
            <Field label="Data da venda"><input disabled={saleLoading} required type="date" min="1994-07-01" max={form.correctionDate} value={form.saleDate} onChange={(e) => change("saleDate", e.target.value)} /></Field>
            <Field label="Valor original de venda (R$)"><input disabled={saleLoading} required type="number" min="0.01" max="10000000000" step="0.01" value={form.saleValue || ""} onChange={(e) => change("saleValue", Number(e.target.value))} /></Field>
            <Field label="Atualizar até"><input required type="date" max={localToday()} min={form.saleDate || "1994-07-01"} value={form.correctionDate} onChange={(e) => change("correctionDate", e.target.value)} /></Field>
            <Field label="Meses de fruição" hint={unit.paidInstallments?.count != null ? `Preenchido automaticamente: ${unit.paidInstallments.count} parcela(s) paga(s). ${unit.paidInstallments.reason}` : `Meses de fruição = total de parcelas pagas. ${unit.paidInstallments?.reason || "Total ainda não confirmado pela fonte."} Informe somente um total conferido.`}><input required readOnly={unit.paidInstallments?.count != null} placeholder="Total não confirmado" type="number" min="0" max="1200" step="1" value={form.fruitionMonths} onChange={(e) => change("fruitionMonths", e.target.value === "" ? "" : Number(e.target.value))} /></Field>
            <Field label="Intermediação e corretagem (R$)" hint="Sem fonte confirmada vinculada ao contrato. Informe o valor conferido; zero somente se confirmado."><input required type="number" min="0" max="10000000000" step="0.01" placeholder="Não informado" value={form.brokerage} onChange={(e) => change("brokerage", e.target.value === "" ? "" : Number(e.target.value))} /></Field>
            <Field label="IPTU e tributos municipais (R$)" hint="Sem fonte confirmada vinculada ao contrato. Informe o valor conferido; zero somente se confirmado."><input required type="number" min="0" max="10000000000" step="0.01" placeholder="Não informado" value={form.municipalTaxes} onChange={(e) => change("municipalTaxes", e.target.value === "" ? "" : Number(e.target.value))} /></Field>
          </div>
          <p className="distrato-help">Atualização pelo INPC no TJDFT, pagamento por pagamento, sem juros. As taxas seguem a planilha de referência; confira a aplicação ao contrato.</p>
        </section>
        <section className="distrato-panel">
          <h2>Pagamentos deste contrato</h2><p>{unit.receipts.length} lançamento(s) · Total nominal: <strong>{brl(unit.receipts.reduce((sum, r) => sum + r.amount, 0))}</strong></p>
          <div className="distrato-table"><table><thead><tr><th>Recebimento</th><th>Parcela / descrição</th><th>Valor recebido</th></tr></thead><tbody>{unit.receipts.map((r) => <tr key={r.id}><td>{brDate(r.date)}</td><td>{r.description}</td><td>{brl(r.amount)}</td></tr>)}</tbody></table></div>
          {!unit.receipts.length ? <p>Não há pagamentos disponíveis para gerar este distrato.</p> : null}
        </section>
        <section className="distrato-panel">
          <h2>3. Termo de distrato</h2><p>Preencha a qualificação e as condições. Campos pendentes geram uma minuta identificada no PDF.</p>
          <details><summary>Dados das partes e do imóvel</summary><div className="distrato-fields distrato-legal-fields">
            {textField("sellerDocument", "CNPJ da vendedora")}{textField("sellerRepresentative", "Representante da vendedora")}{textField("sellerAddress", "Endereço da vendedora")}
            {textField("buyerDocument", "CPF / documento do comprador")}{textField("buyerQualification", "Qualificação e demais titulares")}{textField("buyerAddress", "Endereço do comprador")}
            {textField("registration", "Matrícula do imóvel")}{textField("registryOffice", "Cartório")}{textField("city", "Município / UF")}
          </div></details>
          <div className="distrato-fields distrato-legal-fields">
            <Field label="Motivo do distrato"><textarea rows={2} maxLength={4000} value={form.reason} onChange={(e) => change("reason", e.target.value)} /></Field>
            <Field label="Posse, devolução e benfeitorias"><textarea rows={2} maxLength={4000} value={form.possession} onChange={(e) => change("possession", e.target.value)} /></Field>
            <Field label="Condições de restituição" hint="Parcelas, valores, vencimentos, forma de pagamento, atualização e condições de atraso."><textarea rows={3} maxLength={4000} value={form.refundTerms} onChange={(e) => change("refundTerms", e.target.value)} /></Field>
            <Field label="Ressalvas e condições adicionais"><textarea rows={3} maxLength={4000} value={form.notes} onChange={(e) => change("notes", e.target.value)} /></Field>
          </div>
        </section>
      </fieldset>
      <div className="distrato-actions"><span>{canWrite ? "O PDF reúne a memória de cálculo, os pagamentos e o termo." : "Seu acesso permite consultar e baixar os registros existentes."}</span><Button type="submit" loading={generating} disabled={locked || generating || !canWrite || !correctionDateValid || !unit.receipts.length || downloading}><FileDown size={18} />Gerar distrato</Button></div>
    </form> : null}
    {document ? <section className="distrato-panel distrato-result" aria-live="polite"><div className="distrato-result-heading"><div><span>{document.draft ? "Minuta para conferência" : "Documento gerado"}</span><h2>Saldo apurado: {brl(document.calculation.balance)}</h2><p>Restituição: {brl(document.calculation.refund)} · INPC até {document.correction.availableThrough}</p></div><Button variant="secondary" disabled={locked || generating || downloading} loading={downloading} onClick={() => void download(document.id)}><FileDown size={17} />Baixar PDF</Button></div><dl><div><dt>Pagamentos atualizados</dt><dd>{brl(document.calculation.correctedPaid)}</dd></div><div><dt>Descontos</dt><dd>{brl(document.calculation.totalDeductions)}</dd></div><div><dt>Imóvel atualizado</dt><dd>{brl(document.calculation.property.corrected)}</dd></div></dl>{document.calculation.balance < 0 ? <p className="distrato-message">O saldo negativo não gera cobrança automática ao cliente. A minuta permanece para conferência.</p> : null}<details><summary>Conferir o termo gerado</summary><pre className="distrato-term">{document.term}</pre></details></section> : null}
    {detail?.history.length ? <section className="distrato-panel"><h2>Histórico deste contrato</h2><p>Os cálculos preservam os pagamentos, os índices e as condições usados na geração.</p><div className="distrato-history">{detail.history.map((r) => <button key={r.id} type="button" disabled={locked || generating || downloading} onClick={() => void openHistory(r.id)}><RefreshCw size={15} /><span>{new Date(r.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · {REGIME_LABELS[r.input.regime]} · {r.draft ? "Minuta" : "Documento"}</span><strong>{brl(r.calculation.refund)}</strong></button>)}</div></section> : null}
  </article>;
}
