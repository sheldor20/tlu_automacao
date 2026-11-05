"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileDown, FileX2 } from "lucide-react";
import { Button, PageIntro } from "@/components/ui";
import { paymentFetch } from "@/lib/payment-client";
import { getSupabase } from "@/lib/supabase";
import { brl, brDate, displayWorkCode, type DistratoDocument } from "@/lib/distratos";
import { consolidateDistratos, consolidatedCsv, createGenerationLedger, generateContractBatch, type BatchItem, type GenerationInput } from "@/lib/distratos-batch";
import { SearchableSelect } from "./searchable-select";
import { ContractPanel, type ContractHandle, type ContractReport } from "./contract-panel";
import "./distratos.css";

type Work = { key: string; company_id: string; work_id: string; name: string };
type Contract = { id: string; block: string; lot: string; contract_number: string; buyerName: string };
const contractLabel = (contract: Contract) => `${contract.buyerName} · Contrato ${contract.contract_number}`;

export default function DistratosPage() {
  const [works, setWorks] = useState<Work[]>([]);
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [workKey, setWorkKey] = useState("");
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [block, setBlock] = useState("");
  const [lot, setLot] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [reports, setReports] = useState<Record<string, ContractReport>>({});
  const [loading, setLoading] = useState(true);
  const [loadingContracts, setLoadingContracts] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [results, setResults] = useState<BatchItem[]>([]);
  const [error, setError] = useState("");
  const selectedRef = useRef<string[]>([]);
  const selectionRequest = useRef<AbortController | null>(null);
  const panels = useRef(new Map<string, ContractHandle>());
  const cancel = useRef(false);
  const batchActive = useRef(false);
  const active = useRef(false);
  const [generateDocument] = useState(() => createGenerationLedger({
    journal: () => window.sessionStorage,
    execute: async input => (await paymentFetch("/api/distratos", { method: "POST", body: JSON.stringify(input) })).document,
  }));

  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    paymentFetch("/api/distratos", { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) { setWorks(data.works); setCompanies(data.companies); setCanWrite(data.canWrite); }
    }).catch((e: Error) => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { active.current = false; cancel.current = true; controller.abort(); selectionRequest.current?.abort(); };
  }, []);

  function selectContracts(ids: string[]) {
    const next = [...new Set(ids)];
    selectedRef.current = next;
    setSelected(next);
    setReports(current => Object.fromEntries(next.flatMap(id => current[id] ? [[id, current[id]]] : [])));
    setResults([]); setError("");
  }
  async function selectWork(key: string) {
    selectionRequest.current?.abort();
    const controller = new AbortController(); selectionRequest.current = controller;
    selectContracts([]); setWorkKey(key); setContracts([]); setBlock(""); setLot(""); setLoadingContracts(Boolean(key));
    if (!key) return;
    try {
      const data = await paymentFetch(`/api/distratos?workKey=${encodeURIComponent(key)}`, { signal: controller.signal });
      if (!controller.signal.aborted) setContracts([...new Map<string, Contract>(data.contracts.map((c: Contract) => [c.id, c])).values()]);
    } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    finally { if (!controller.signal.aborted) setLoadingContracts(false); }
  }
  const onReport = useCallback((id: string, report: ContractReport) => {
    if (active.current && selectedRef.current.includes(id)) setReports(current => ({ ...current, [id]: report }));
  }, []);
  const createDocument = useCallback(async (input: GenerationInput) => {
    const session = await getSupabase()?.auth.getSession();
    return generateDocument(session?.data.session?.user.id || "", input);
  }, [generateDocument]);
  async function generateSelected() {
    if (batchActive.current || !canWrite) return;
    batchActive.current = true; cancel.current = false;
    setBatchRunning(true); setStopping(false); setResults([]); setError("");
    try {
      await generateContractBatch({
        contractIds: selectedRef.current,
        cancelled: () => cancel.current,
        generate: id => {
          const panel = panels.current.get(id);
          if (!panel) throw new Error("Este contrato não está mais selecionado.");
          return panel.generate();
        },
        onResult: item => { if (active.current) setResults(current => [...current, item]); },
      });
    } finally { batchActive.current = false; if (active.current) { setBatchRunning(false); setStopping(false); } }
  }
  const busy = batchRunning || Object.values(reports).some(report => report.busy);
  const blocks = [...new Set(contracts.map(c => c.block))].sort();
  const lots = [...new Set(contracts.filter(c => c.block === block).map(c => c.lot))].sort();
  const unitContracts = contracts.filter(c => c.block === block && c.lot === lot);
  const selectedContracts = selected.flatMap(id => { const contract = unitContracts.find(c => c.id === id); return contract ? [contract] : []; });
  const currentDocuments = new Map<string, DistratoDocument>(selected.flatMap(id => reports[id]?.document ? [[id, reports[id].document!]] : []));
  let summary: ReturnType<typeof consolidateDistratos> | null = null;
  let summaryError = "";
  try { summary = consolidateDistratos(selected, currentDocuments); }
  catch (e) { summaryError = (e as Error).message; }
  function exportSummary() {
    if (!summary) return;
    const sources = new Map(selected.map(id => [id, reports[id]?.sourceSale ?? null]));
    const url = URL.createObjectURL(new Blob([consolidatedCsv(summary, sources)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "distratos-consolidado.csv"; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  return <div className="distratos-page">
    <PageIntro eyebrow="Jurídico e pós-vendas" title="Distratos" description="Selecione os contratos da unidade. Cada contrato mantém seus pagamentos, cálculo e documento próprios." />
    {error ? <div className="distrato-message error" role="alert">{error}</div> : null}
    <section className="distrato-panel">
      <div className="distrato-panel-title"><FileX2 size={22} /><div><h2>1. Empreendimento e unidade</h2><p>Selecione uma ou mais pessoas pelos respectivos contratos. Um contrato compartilhado gera um único documento, sem rateio entre titulares.</p></div></div>
      <fieldset disabled={loading || busy} className="distrato-fields">
        <SearchableSelect label="Empreendimento / Obra" className="distrato-wide" value={workKey} disabled={loading || busy} placeholder={loading ? "Carregando empreendimentos…" : "Selecione o empreendimento"} options={works.map(w => ({ value: w.key, label: `${w.name} · Obra ${displayWorkCode(w.work_id)} · ${companies.find(c => c.id === w.company_id)?.name || ""}` }))} onChange={value => void selectWork(value)} />
        <SearchableSelect key={`block-${workKey}`} label="Quadra" value={block} disabled={!contracts.length || loadingContracts || busy} placeholder="Selecione a quadra" options={blocks.map(value => ({ value, label: value }))} onChange={value => { selectContracts([]); setBlock(value); setLot(""); }} />
        <SearchableSelect key={`lot-${workKey}-${block}`} label="Lote" value={lot} disabled={!block || loadingContracts || busy} placeholder="Selecione o lote" options={lots.map(value => ({ value, label: value }))} onChange={value => { setLot(value); const found = contracts.filter(c => c.block === block && c.lot === value); selectContracts(found.length === 1 ? [found[0].id] : []); }} />
      </fieldset>
      {loadingContracts ? <p role="status">Consultando os contratos…</p> : null}
      {workKey && !loadingContracts && !contracts.length ? <p>Nenhuma unidade com quadra e lote identificados nesta obra.</p> : null}
      {unitContracts.length ? <fieldset className="distrato-contract-options" disabled={busy}>
        <legend>Contratos / Pessoas</legend>
        {unitContracts.map(contract => <label key={contract.id}><input type="checkbox" value={contract.id} checked={selected.includes(contract.id)} onChange={event => selectContracts(event.target.checked ? [...selected, contract.id] : selected.filter(id => id !== contract.id))} /><span>{contractLabel(contract)}</span></label>)}
        <p>{selected.length} contrato(s) selecionado(s). Remover uma seleção também remove seus valores do resumo.</p>
      </fieldset> : null}
    </section>
    {selected.length ? <section className="distrato-panel distrato-consolidated" aria-label="Resumo dos contratos selecionados">
      <h2>Resumo dos contratos selecionados</h2>
      <p>Venda e pagamentos consultados na origem, separados dos valores atualizados e da restituição calculada por contrato. Valores não confirmados ficam identificados.</p>
      <div className="distrato-actions">
        <Button disabled={!canWrite || busy || !selected.every(id => reports[id]?.ready)} loading={batchRunning} onClick={() => void generateSelected()}><FileDown size={18} />Gerar documentos selecionados</Button>
        {batchRunning ? <Button variant="secondary" disabled={stopping} onClick={() => { cancel.current = true; setStopping(true); }}>Parar após contrato atual</Button> : null}
        <Button variant="secondary" disabled={busy || !summary?.rows.length || Boolean(summary.missing.length)} onClick={exportSummary}>Exportar resumo CSV</Button>
      </div>
      {!canWrite ? <p>Seu acesso permite consultar e baixar registros existentes.</p> : !selected.every(id => reports[id]?.ready) ? <p>Confira os campos obrigatórios de cada contrato antes de gerar os documentos selecionados.</p> : null}
      {stopping ? <p role="status">Concluindo o contrato em andamento. Os próximos contratos não serão iniciados.</p> : null}
      {results.length ? <ul className="distrato-batch-status" aria-live="polite">{results.map(item => <li key={item.contractId}>{contractLabel(contracts.find(c => c.id === item.contractId)!)}: {item.status === "generated" ? "documento disponível" : item.status === "cancelled" ? "não iniciado" : `falha — ${item.error}`}</li>)}</ul> : null}
      {summaryError ? <p role="alert" className="distrato-message error">{summaryError}</p> : null}
      {summary ? <>
        <p>{summary.rows.length} de {selected.length} documento(s) disponíveis para os dados atuais. {summary.missing.length ? "Resumo parcial: faltam documentos." : "Todos os contratos selecionados estão incluídos."}</p>
        <div className="distrato-table"><table><thead><tr><th>Contrato / Pessoa</th><th>Venda na origem</th><th>Pagamentos nominais na origem</th><th>Base de venda usada no cálculo</th><th>Pagamentos atualizados</th><th>Descontos</th><th>Saldo individual</th><th>Restituição individual</th></tr></thead><tbody>{selectedContracts.map(c => {
          const d = currentDocuments.get(c.id), report = reports[c.id], source = report?.sourceSale;
          return <tr key={c.id} data-summary-contract={c.id}>
            <td>{contractLabel(c)}{d ? <small>{d.draft ? "Minuta" : "Documento"}</small> : null}</td>
            <td>{source?.saleValue != null ? brl(source.saleValue) : "Não confirmado"}<small>{source?.saleDate ? brDate(source.saleDate) : "Data não confirmada"}{source?.label ? ` · ${source.label}` : ""}</small></td>
            <td>{report?.nominalPaid != null ? brl(report.nominalPaid) : "Não confirmado"}</td>
            {d ? <><td>{brl(d.input.saleValue)}<small>{brDate(d.input.saleDate)}</small></td><td>{brl(d.calculation.correctedPaid)}</td><td>{brl(d.calculation.totalDeductions)}</td><td>{brl(d.calculation.balance)}</td><td>{brl(d.calculation.refund)}</td></> : <td colSpan={5}>Documento pendente para os dados atuais</td>}
          </tr>;
        })}</tbody><tfoot><tr><th>Total dos documentos disponíveis</th><td>Por contrato</td><td>{summary.rows.length ? brl(summary.nominalPaid) : "Pendente"}</td><td>Por contrato</td><td>{summary.rows.length ? brl(summary.correctedPaid) : "Pendente"}</td><td>{summary.rows.length ? brl(summary.totalDeductions) : "Pendente"}</td><td>Sem compensação</td><td>{summary.rows.length ? brl(summary.refund) : "Pendente"}</td></tr></tfoot></table></div>
        <p>Saldos negativos de um contrato não reduzem a restituição de outro. Os PDFs individuais ficam disponíveis abaixo de cada contrato.</p>
      </> : null}
    </section> : lot ? <p role="status">Selecione ao menos um contrato para consultar seus dados.</p> : null}
    {selectedContracts.map(contract => <ContractPanel key={contract.id} contractId={contract.id} label={contractLabel(contract)} canWrite={canWrite} locked={batchRunning} onReport={onReport} createDocument={createDocument} ref={handle => { if (handle) panels.current.set(contract.id, handle); else panels.current.delete(contract.id); }} />)}
  </div>;
}
