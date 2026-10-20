"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CONTRACT_STATUSES, CONTRACT_TYPES, contractProtocol, type ContractRequest, type ContractEvent, type ContractStatus } from "@/lib/contract-requests";
import { contractFetch, downloadContract } from "@/lib/contract-client";
import { ContractRequestForm } from "./contract-request-form";
import { Button, Field, PageIntro } from "./ui";
export function ContractDetail({ id, token }: { id?: string; token?: string }) {
  const [row, setRow] = useState<ContractRequest | null>(null), [events, setEvents] = useState<ContractEvent[]>([]), [manager, setManager] = useState(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<ContractStatus>("in_progress"), [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setError(""); setLoading(true);
    try {
      const resolvedId = id || (await contractFetch("/api/contracts/track", {}, token)).id;
      const result = await contractFetch(`/api/contracts/${resolvedId}`, {}, token);
      setRow(result.row); setEvents(result.events); setManager(result.can_manage); setStatus(result.row.status);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar."); }
    finally { setLoading(false); }
  }, [id, token]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  if (!row) return <section className="payment-section">{error ? <p role="alert">{error}</p> : <p>Carregando contrato…</p>}</section>;
  const protocol = contractProtocol(row.protocol);
  if (editing) return <><h1>Complementar {protocol}</h1><ContractRequestForm initialRequest={row} token={token} onSaved={() => { setEditing(false); void load(); }} onCancel={() => setEditing(false)} /></>;
  return <>
    {!token && <Link className="payment-back" href="/pagamentos">← Solicitações</Link>}
    <PageIntro eyebrow={protocol} title={row.details.title} description={`${CONTRACT_TYPES[row.details.type]} · ${row.details.company_name}`} />
    {error && <p role="alert" className="form-error">{error}</p>}
    <section className="payment-section"><div className="contract-summary"><span className={`payment-status payment-status-${row.status}`}>{CONTRACT_STATUSES[row.status]}</span><p>Solicitado por {row.requester_name} · {new Date(row.created_at).toLocaleDateString("pt-BR")}</p></div>
      <p><strong>Objeto:</strong> {row.details.object}</p><p><strong>Partes:</strong> {row.details.party_a_name} e {row.details.party_b_name}</p>
      <p><strong>Valor:</strong> {row.details.amount === null ? "Não informado" : row.details.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
      <p>{row.details.type === "rental" ? "Baixe a minuta de locação preenchida para revisar e finalizar no Word." : "Baixe a ficha editável com os dados para elaborar este tipo de contrato."}</p>
      <div className="form-actions"><Button disabled={busy || loading} onClick={async () => { setBusy(true); setError(""); try { await downloadContract(row.id, protocol, token); } catch (e) { setError(e instanceof Error ? e.message : "Falha no download."); } finally { setBusy(false); } }}>{row.details.type === "rental" ? "Baixar minuta .doc" : "Baixar dados .doc"}</Button>
        {(manager || row.status === "missing_information") && <Button variant="secondary" disabled={busy || loading} onClick={() => setEditing(true)}>{manager ? "Editar dados do contrato" : "Complementar informações"}</Button>}
        <Button variant="ghost" disabled={busy || loading} onClick={() => void load()}>Atualizar</Button>
      </div>
      <details><summary>Ver todos os dados informados</summary><dl className="contract-data">{Object.entries(row.details).filter(([key, value]) => key !== "type" && value !== "" && value !== null).map(([key, value]) => <div key={key}><dt>{CONTRACT_FIELD_LABELS[key] || key}</dt><dd>{String(value)}</dd></div>)}</dl></details>
    </section>
    <form className="payment-section" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError("");
      try { await contractFetch(`/api/contracts/${row.id}`, { method: "PATCH", body: JSON.stringify({ version: row.version, message, ...(manager && status !== row.status ? { status } : {}) }) }, token); setMessage(""); await load(); }
      catch (e) { setError(e instanceof Error ? e.message : "Não foi possível atualizar."); }
      finally { setBusy(false); }
    }}><h2>{manager ? "Atualizar solicitação" : "Falar com a gestão"}</h2><div className="form-grid">
      {manager && <Field label="Status"><select value={status} disabled={busy || loading} onChange={e => setStatus(e.target.value as ContractStatus)}>{Object.entries(CONTRACT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>}
      <Field label={status === "missing_information" && manager ? "Quais informações estão faltando? *" : "Mensagem"}><textarea value={message} onChange={e => setMessage(e.target.value)} maxLength={6000} required={!manager || status === row.status || status === "missing_information"} rows={4} disabled={busy || loading} /></Field>
    </div><Button loading={busy} disabled={loading}>Salvar atualização</Button></form>
    <section className="payment-section"><h2>Histórico</h2><ol className="contract-history">{events.map(event => <li key={event.id}><strong>{event.actor_name}</strong><span> · {new Date(event.created_at).toLocaleString("pt-BR")}</span><p>{CONTRACT_STATUSES[event.status]} · {event.message}</p></li>)}</ol></section>
  </>;
}
const CONTRACT_FIELD_LABELS: Record<string, string> = {
  title: "Título", company_name: "Empresa", other_type: "Tipo de contrato", party_a_name: "Parte A", party_a_tax_id: "CPF/CNPJ da parte A", party_a_address: "Endereço da parte A", party_a_qualification: "Qualificação da parte A", party_a_representative: "Representante da parte A", party_b_name: "Parte B", party_b_tax_id: "CPF/CNPJ da parte B", party_b_address: "Endereço da parte B", party_b_qualification: "Qualificação da parte B", party_b_representative: "Representante da parte B", contact_email: "E-mail", contact_phone: "Telefone", object: "Objeto", amount: "Valor (R$)", payment_terms: "Pagamento", start_date: "Início", end_date: "Término", deadline: "Prazo desejado", notes: "Observações", original_contract: "Contrato original", property_address: "Endereço do imóvel", property_registration: "Matrícula", purpose: "Finalidade", term_months: "Prazo em meses", first_payment: "Primeiro pagamento", due_day: "Dia de vencimento", grace_period: "Carência", adjustment_index: "Reajuste", bank_details: "Dados bancários", renewal: "Renovação", guarantee: "Garantia", jurisdiction: "Foro", signature_city: "Cidade da assinatura", signature_date: "Data da assinatura", witnesses: "Testemunhas",
};
