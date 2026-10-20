"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CONTRACT_STATUSES, CONTRACT_TYPES, contractProtocol, type ContractRequest } from "@/lib/contract-requests";
import { contractFetch } from "@/lib/contract-client";
import { Button, Field } from "./ui";
export function ContractList({ management = false, onAccess }: { management?: boolean; onAccess?: (allowed: boolean) => void }) {
  const [rows, setRows] = useState<ContractRequest[]>([]), [count, setCount] = useState(0), [page, setPage] = useState(0);
  const [search, setSearch] = useState(""), [status, setStatus] = useState(""), [type, setType] = useState(""), [company, setCompany] = useState("");
  const [filters, setFilters] = useState({ search: "", status: "", type: "", company: "" });
  const [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const result = await contractFetch(`/api/contracts?${new URLSearchParams({ scope: management ? "management" : "mine", page: String(page), ...filters })}`, { signal });
      if (signal?.aborted) return;
      setRows(result.rows); setCount(result.count || 0); onAccess?.(result.can_manage);
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : "Não foi possível carregar contratos."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [management, page, filters, onAccess]);
  useEffect(() => { const controller = new AbortController(); const timer = setTimeout(() => void load(controller.signal), 0); return () => { clearTimeout(timer); controller.abort(); }; }, [load]);
  return <section className="payment-section"><h2>{management ? "Gestão de contratos" : "Meus contratos"}</h2>
    <form className="payment-filters" onSubmit={e => { e.preventDefault(); setPage(0); setFilters({ search, status, type, company }); }}>
      <Field label="Buscar título ou protocolo"><input placeholder="Ex.: CON-000001" value={search} onChange={e => setSearch(e.target.value)} /></Field>
      <Field label="Status"><select value={status} onChange={e => setStatus(e.target.value)}><option value="">Todos</option>{Object.entries(CONTRACT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Tipo de contrato"><select value={type} onChange={e => setType(e.target.value)}><option value="">Todos</option>{Object.entries(CONTRACT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Empresa"><input value={company} onChange={e => setCompany(e.target.value)} /></Field><Button type="submit" variant="secondary">Filtrar contratos</Button>
      <Button type="button" variant="ghost" onClick={() => void load()}>Atualizar</Button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {loading ? <p role="status">Carregando contratos…</p> : !error && (rows.length ? <>
      <div className="payment-table-scroll"><table className="payment-table"><thead><tr><th>Protocolo</th><th>Contrato / empresa</th><th>Tipo</th><th>Solicitante</th><th>Status</th><th>Ações</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}>
        <td>{contractProtocol(row.protocol)}</td><td><strong>{row.details.title}</strong><br />{row.details.company_name}</td><td>{CONTRACT_TYPES[row.details.type]}</td><td>{row.requester_name}</td>
        <td><span className={`payment-status payment-status-${row.status}`}>{CONTRACT_STATUSES[row.status]}</span></td><td><Link href={`/pagamentos/contratos/${row.id}`}>Abrir contrato</Link></td>
      </tr>)}</tbody></table></div>
      <div className="payment-pagination"><Button variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button><span>Página {page + 1} de {Math.max(1, Math.ceil(count / 40))}</span><Button variant="secondary" disabled={(page + 1) * 40 >= count} onClick={() => setPage(page + 1)}>Próxima</Button></div>
    </> : <p>Nenhuma solicitação de contrato encontrada.</p>)}
  </section>;
}
