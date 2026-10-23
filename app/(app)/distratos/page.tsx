"use client";

import { useEffect, useRef, useState } from "react";
import { FileDown, FileX2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button, Field, PageIntro } from "@/components/ui";
import { paymentFetch } from "@/lib/payment-client";
import { getSupabase } from "@/lib/supabase";
import { SearchableSelect } from "./searchable-select";
import { salePrefill } from "@/lib/distratos-prefill";
import { localToday } from "@/lib/operational-finance";
import { brl, brDate, displayWorkCode, REGIME_LABELS, unitIdentifier, type DistratoDocument, type DistratoInput, type DistratoUnit } from "@/lib/distratos";
import "./distratos.css";

type Work = { key: string; company_id: string; work_id: string; name: string };
type Contract = { id: string; block: string; lot: string; contract_number: string; buyerName: string };
type Form = Omit<DistratoInput, "requestId" | "sourceRevision" | "contractId" | "regime" | "fruitionMonths" | "brokerage" | "municipalTaxes"> & { regime: DistratoInput["regime"] | ""; fruitionMonths: number | ""; brokerage: number | ""; municipalTaxes: number | "" };
type Detail = { unit: DistratoUnit; sourceRevision: string; history: Array<Pick<DistratoDocument, "id" | "created_at" | "draft" | "input" | "calculation">> };
const blank = (): Form => ({ regime: "", correctionDate: localToday(), saleDate: "", saleValue: 0, fruitionMonths: "", brokerage: "", municipalTaxes: "", sellerDocument: "", sellerAddress: "", sellerRepresentative: "", buyerDocument: "", buyerQualification: "", buyerAddress: "", registration: "", registryOffice: "", reason: "", possession: "", refundTerms: "", city: "", notes: "" });

export default function DistratosPage() {
  const [works, setWorks] = useState<Work[]>([]);
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [workKey, setWorkKey] = useState("");
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [block, setBlock] = useState("");
  const [lot, setLot] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [document, setDocument] = useState<DistratoDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingUnit, setLoadingUnit] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [saleLoading, setSaleLoading] = useState(false);
  const [saleMessage, setSaleMessage] = useState("");
  const [error, setError] = useState("");
  const selection = useRef("");
  const generationRequest = useRef<{ input: string; id: string } | null>(null);

  useEffect(() => {
    let active = true;
    paymentFetch("/api/distratos").then((data) => {
      if (active) { setWorks(data.works); setCompanies(data.companies); setCanWrite(data.canWrite); }
    }).catch((e: Error) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; selection.current = ""; };
  }, []);

  function resetUnit() {
    selection.current = ""; setLoadingUnit(false); setDetail(null); setDocument(null); setForm(blank()); setSaleMessage(""); setSaleLoading(false); setError("");
  }
  async function selectWork(key: string) {
    resetUnit(); setWorkKey(key); setContracts([]); setBlock(""); setLot("");
    if (!key) return;
    selection.current = key; setLoadingUnit(true);
    try {
      const data = await paymentFetch(`/api/distratos?workKey=${encodeURIComponent(key)}`);
      if (selection.current === key) setContracts(data.contracts);
    } catch (e) { if (selection.current === key) setError((e as Error).message); }
    finally { if (selection.current === key) setLoadingUnit(false); }
  }
  async function selectContract(id: string) {
    resetUnit(); if (!id) return;
    selection.current = id; setLoadingUnit(true);
    try {
      const data: Detail = await paymentFetch(`/api/distratos?contractId=${encodeURIComponent(id)}`);
      if (selection.current !== id) return;
      setDetail(data); setForm((current) => ({ ...current, fruitionMonths: data.unit.paidInstallments?.count ?? "" })); setLoadingUnit(false); setSaleLoading(true);
      try {
        const sale = await paymentFetch(`/api/distratos/sale?contractId=${encodeURIComponent(id)}`);
        if (selection.current !== id) return;
        const confirmed = salePrefill(sale, localToday());
        setForm((current) => ({ ...current, ...confirmed }));
        setSaleMessage(confirmed.saleDate && confirmed.saleValue ? `Data e valor da venda consultados no ${sale.source}. Confira com o contrato.` : "Data ou valor original não confirmados pela fonte. Confira os campos pendentes no contrato.");
      } catch {
        if (selection.current === id) setSaleMessage("A data e o valor original da venda precisam ser preenchidos conforme o contrato. Os pagamentos abaixo vieram da base do Qlik.");
      } finally { if (selection.current === id) setSaleLoading(false); }
    } catch (e) { if (selection.current === id) { setError((e as Error).message); setLoadingUnit(false); } }
  }
  function change<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => ({ ...current, [key]: value })); setDocument(null);
  }
  async function download(id: string) {
    setDownloading(true); setError("");
    try {
      const session = await getSupabase()?.auth.getSession();
      const response = await fetch(`/api/distratos/${encodeURIComponent(id)}?pdf=1`, { headers: { Authorization: `Bearer ${session?.data.session?.access_token || ""}` }, cache: "no-store" });
      if (!response.ok) throw new Error((await response.json()).error || "Não foi possível baixar o PDF.");
      const url = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = `distrato-${id}.pdf`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { setError((e as Error).message); }
    finally { setDownloading(false); }
  }
  async function generate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!detail) return;
    setGenerating(true); setDocument(null); setError("");
    const body = { ...form, sourceRevision: detail.sourceRevision, contractId: detail.unit.contractId };
    const serialized = JSON.stringify(body);
    if (generationRequest.current?.input !== serialized) generationRequest.current = { input: serialized, id: crypto.randomUUID() };
    try {
      const data = await paymentFetch("/api/distratos", { method: "POST", body: JSON.stringify({ ...body, requestId: generationRequest.current.id }) });
      setDocument(data.document);
      setDetail((current) => current ? { ...current, history: [data.document, ...current.history.filter((r) => r.id !== data.document.id)].slice(0, 20) } : current);
      await download(data.document.id);
    } catch (e) { setError((e as Error).message); }
    finally { setGenerating(false); }
  }
  async function openHistory(id: string) {
    setError("");
    const selected = selection.current;
    try { const data = await paymentFetch(`/api/distratos/${encodeURIComponent(id)}`); if (selection.current === selected) setDocument(data.document); }
    catch (e) { setError((e as Error).message); }
  }
  const blocks = [...new Set(contracts.map((c) => c.block))].sort();
  const lots = [...new Set(contracts.filter((c) => c.block === block).map((c) => c.lot))].sort();
  const unitContracts = contracts.filter((c) => c.block === block && c.lot === lot);
  const unit = detail?.unit;
  const correctionDateValid = form.saleDate && form.saleValue > 0 && form.regime && form.fruitionMonths !== "" && form.brokerage !== "" && form.municipalTaxes !== "" && !saleLoading;
  const textField = (key: keyof Form, label: string) => <Field label={label}><input value={String(form[key])} maxLength={4000} onChange={(e) => change(key, e.target.value as never)} /></Field>;

  return <div className="distratos-page">
    <PageIntro eyebrow="Jurídico e pós-vendas" title="Distratos" description="Selecione a unidade, confira os pagamentos e gere o cálculo com o termo de distrato." />
    {error ? <div className="distrato-message error" role="alert">{error}</div> : null}
    <section className="distrato-panel">
      <div className="distrato-panel-title"><FileX2 size={22} /><div><h2>1. Empreendimento e unidade</h2><p>O contrato identifica a empresa, a obra e o cliente dos recebimentos.</p></div></div>
      <fieldset disabled={loading || generating || downloading} className="distrato-fields">
        <SearchableSelect label="Empreendimento / Obra" className="distrato-wide" value={workKey} disabled={loading || generating || downloading} placeholder={loading ? "Carregando empreendimentos…" : "Selecione o empreendimento"} options={works.map((w) => ({ value: w.key, label: `${w.name} · Obra ${displayWorkCode(w.work_id)} · ${companies.find((c) => c.id === w.company_id)?.name || ""}` }))} onChange={(value) => void selectWork(value)} />
        <SearchableSelect key={`block-${workKey}`} label="Quadra" value={block} disabled={!contracts.length || loadingUnit || generating || downloading} placeholder="Selecione a quadra" options={blocks.map((value) => ({ value, label: value }))} onChange={(value) => { resetUnit(); setBlock(value); setLot(""); }} />
        <SearchableSelect key={`lot-${workKey}-${block}`} label="Lote" value={lot} disabled={!block || loadingUnit || generating || downloading} placeholder="Selecione o lote" options={lots.map((value) => ({ value, label: value }))} onChange={(value) => { setLot(value); const found = contracts.filter((c) => c.block === block && c.lot === value); if (found.length === 1) void selectContract(found[0].id); else resetUnit(); }} />
        {unitContracts.length > 1 ? <Field label="Contrato / Cliente" className="distrato-wide" hint="Este lote possui mais de um contrato. Selecione o cliente correto."><select value={unit?.contractId || ""} onChange={(e) => void selectContract(e.target.value)}><option value="">Selecione o contrato</option>{unitContracts.map((c) => <option key={c.id} value={c.id}>{c.buyerName} · Contrato {c.contract_number}</option>)}</select></Field> : null}
      </fieldset>
      {loadingUnit ? <p role="status">Consultando a unidade e os recebimentos…</p> : null}
      {workKey && !loadingUnit && !contracts.length ? <p>Nenhuma unidade com quadra e lote identificados nesta obra.</p> : null}
      {unit ? <div className="distrato-unit"><strong>{unit.buyerName}</strong><span>{unitIdentifier(unit)} · Contrato {unit.contractNumber}</span><small>{unit.companyName} · Base Qlik publicada em {new Date(unit.synchronizedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</small></div> : null}
    </section>
    {unit ? <form onSubmit={(e) => void generate(e)}>
      <fieldset disabled={generating || downloading || !canWrite} className="distrato-form-fieldset">
        <section className="distrato-panel">
          <div className="distrato-panel-title"><ShieldCheck size={22} /><div><h2>2. Regra e cálculo</h2><p>A regra é escolhida pelo usuário para este lote.</p></div></div>
          <div className="distrato-regimes" role="group" aria-label="Enquadramento do distrato">{Object.entries(REGIME_LABELS).map(([value, label]) => <label key={value} className={form.regime === value ? "selected" : ""}><input required type="radio" name="regime" value={value} checked={form.regime === value} onChange={() => change("regime", value as DistratoInput["regime"])} /><span><strong>{label}</strong><small>{value === "com_lei" ? "10% do imóvel + fruição de 0,75% ao mês" : "5% + 5% dos pagamentos, multa de 10% e fruição de 1% ao mês"}</small></span></label>)}</div>
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
          <h2>Pagamentos da unidade</h2><p>{unit.receipts.length} lançamento(s) · Total nominal: <strong>{brl(unit.receipts.reduce((sum, r) => sum + r.amount, 0))}</strong></p>
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
      <div className="distrato-actions"><span>{canWrite ? "O PDF reúne a memória de cálculo, os pagamentos e o termo." : "Seu acesso permite consultar e baixar os registros existentes."}</span><Button type="submit" loading={generating} disabled={!canWrite || !correctionDateValid || !unit.receipts.length || downloading}><FileDown size={18} />Gerar distrato</Button></div>
    </form> : null}
    {document ? <section className="distrato-panel distrato-result" aria-live="polite"><div className="distrato-result-heading"><div><span>{document.draft ? "Minuta para conferência" : "Documento gerado"}</span><h2>Saldo apurado: {brl(document.calculation.balance)}</h2><p>Restituição: {brl(document.calculation.refund)} · INPC até {document.correction.availableThrough}</p></div><Button variant="secondary" loading={downloading} onClick={() => void download(document.id)}><FileDown size={17} />Baixar PDF</Button></div><dl><div><dt>Pagamentos atualizados</dt><dd>{brl(document.calculation.correctedPaid)}</dd></div><div><dt>Descontos</dt><dd>{brl(document.calculation.totalDeductions)}</dd></div><div><dt>Imóvel atualizado</dt><dd>{brl(document.calculation.property.corrected)}</dd></div></dl>{document.calculation.balance < 0 ? <p className="distrato-message">O saldo negativo não gera cobrança automática ao cliente. A minuta permanece para conferência.</p> : null}<details><summary>Conferir o termo gerado</summary><pre className="distrato-term">{document.term}</pre></details></section> : null}
    {detail?.history.length ? <section className="distrato-panel"><h2>Histórico desta unidade</h2><p>Os cálculos preservam os pagamentos, os índices e as condições usados na geração.</p><div className="distrato-history">{detail.history.map((r) => <button key={r.id} type="button" disabled={generating || downloading} onClick={() => void openHistory(r.id)}><RefreshCw size={15} /><span>{new Date(r.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · {REGIME_LABELS[r.input.regime]} · {r.draft ? "Minuta" : "Documento"}</span><strong>{brl(r.calculation.refund)}</strong></button>)}</div></section> : null}
  </div>;
}
