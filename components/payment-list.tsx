"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Copy, Plus, RefreshCw, Wallet } from "lucide-react";
import { Button, EmptyState, Field, PageIntro } from "./ui";
import { paymentFetch } from "@/lib/payment-client";
import {
  PAYMENT_STATUSES,
  PAYMENT_TYPES,
  paymentMoney,
  paymentProtocol,
  type PaymentRequest,
} from "@/lib/payment-requests";

export function PaymentList() {
  const loadSequence = useRef(0);
  const [rows, setRows] = useState<PaymentRequest[]>([]),
    [count, setCount] = useState(0),
    [page, setPage] = useState(0);
  const [manager, setManager] = useState(false),
    [scope, setScope] = useState("mine");
  const [status, setStatus] = useState(""),
    [type, setType] = useState(""),
    [company, setCompany] = useState("");
  const [companies, setCompanies] = useState<
    Array<{ company_key: string; name: string }>
  >([]);
  const [search, setSearch] = useState(""),
    [appliedSearch, setAppliedSearch] = useState("");
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        scope,
        status,
        type,
        company,
        search: appliedSearch,
        page: String(page),
      });
      const result = await paymentFetch(`/api/payments?${query}`);
      if (sequence !== loadSequence.current) return;
      setRows(result.rows);
      setCount(result.count || 0);
      setManager(result.can_manage);
    } catch (e) {
      if (sequence === loadSequence.current)
        setError(e instanceof Error ? e.message : "Não foi possível carregar.");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [scope, status, type, company, appliedSearch, page]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    paymentFetch("/api/payments/companies")
      .then((r) => setCompanies(r.companies))
      .catch(() => {});
  }, []);
  return (
    <>
      <PageIntro
        eyebrow="Financeiro"
        title="Solicitações de pagamento"
        description="Envie pedidos e acompanhe cada etapa até o comprovante de pagamento."
        action={
          <Link className="button button-primary" href="/pagamentos/nova">
            <Plus size={17} />
            Nova solicitação
          </Link>
        }
      />
      <div className="payment-list-top">
        <div
          className="payment-tabs"
          role="tablist"
          aria-label="Visão das solicitações"
        >
          <button
            role="tab"
            aria-selected={scope === "mine"}
            className={scope === "mine" ? "active" : ""}
            onClick={() => {
              setScope("mine");
              setPage(0);
            }}
          >
            Minhas solicitações
          </button>
          {manager && (
            <button
              role="tab"
              aria-selected={scope === "management"}
              className={scope === "management" ? "active" : ""}
              onClick={() => {
                setScope("management");
                setPage(0);
              }}
            >
              Gestão de pagamentos
            </button>
          )}
        </div>
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                `${location.origin}/solicitar-pagamento`,
              );
              setCopied(true);
              setTimeout(() => setCopied(false), 3000);
            } catch {
              setError(`Link público: ${location.origin}/solicitar-pagamento`);
            }
          }}
        >
          <Copy size={16} />
          {copied ? "Link copiado" : "Copiar link público"}
        </Button>
      </div>
      <section className="payment-section">
        <form
          className="payment-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedSearch(search);
            setPage(0);
          }}
        >
          <Field label="Buscar título ou protocolo">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ex.: PAG-000001"
            />
          </Field>
          <Field label="Status">
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              <option value="">Todos os status</option>
              {Object.entries(PAYMENT_STATUSES).map(([key, value]) => (
                <option key={key} value={key}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tipo">
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(0);
              }}
            >
              <option value="">Todos os tipos</option>
              {Object.entries(PAYMENT_TYPES).map(([key, value]) => (
                <option key={key} value={key}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Empresa">
            <select
              value={company}
              onChange={(e) => {
                setCompany(e.target.value);
                setPage(0);
              }}
            >
              <option value="">Todas as empresas</option>
              {companies.map((c) => (
                <option key={c.company_key} value={c.company_key}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" variant="secondary">
            Buscar
          </Button>
        </form>
      </section>
      {error && (
        <div role="alert" className="payment-alert">
          {error}
          <Button variant="ghost" onClick={() => void load()}>
            <RefreshCw size={16} />
            Tentar novamente
          </Button>
        </div>
      )}
      {loading ? (
        <p className="payment-loading">Carregando solicitações…</p>
      ) : rows.length ? (
        <section className="payment-section payment-table-section">
          <div className="payment-table-summary">
            <span>{count} solicitação(ões)</span>
            <Button variant="ghost" onClick={() => void load()}>
              <RefreshCw size={16} />
              Atualizar
            </Button>
          </div>
          <div className="payment-table-scroll">
            <table className="payment-table">
              <thead>
                <tr>
                  <th>Solicitação</th>
                  <th>Empresa / solicitante</th>
                  <th>Valor</th>
                  <th>Pagamento desejado</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Abrir</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/pagamentos/${row.id}`}>
                        <small>
                          {paymentProtocol(row.protocol)} ·{" "}
                          {PAYMENT_TYPES[row.type]}
                        </small>
                        <strong>{row.title}</strong>
                      </Link>
                    </td>
                    <td>
                      {row.company_name}
                      <small>{row.requester_name}</small>
                    </td>
                    <td>
                      <strong>{paymentMoney(row.amount)}</strong>
                      {row.budget_max !== null &&
                        row.amount > row.budget_max && (
                          <small className="payment-over-budget">
                            Acima do orçamento máximo
                          </small>
                        )}
                    </td>
                    <td>
                      {new Date(`${row.due_date}T12:00:00`).toLocaleDateString(
                        "pt-BR",
                      )}
                    </td>
                    <td>
                      <span
                        className={`payment-status payment-status-${row.status}`}
                      >
                        {PAYMENT_STATUSES[row.status]}
                      </span>
                    </td>
                    <td>
                      <Link
                        className="icon-button"
                        aria-label={`Abrir ${paymentProtocol(row.protocol)}`}
                        href={`/pagamentos/${row.id}`}
                      >
                        <ArrowRight size={18} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="payment-pagination">
            <Button
              variant="secondary"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Anterior
            </Button>
            <span>
              Página {page + 1} de {Math.max(1, Math.ceil(count / 40))}
            </span>
            <Button
              variant="secondary"
              disabled={(page + 1) * 40 >= count}
              onClick={() => setPage(page + 1)}
            >
              Próxima
            </Button>
          </div>
        </section>
      ) : (
        !error && (
          <EmptyState
            icon={<Wallet />}
            title="Nenhuma solicitação encontrada"
            description={
              scope === "management"
                ? "As solicitações recebidas aparecerão aqui para análise e pagamento."
                : "Comece escolhendo o tipo de pagamento que você precisa solicitar."
            }
            action={
              <Link className="button button-primary" href="/pagamentos/nova">
                Nova solicitação
              </Link>
            }
          />
        )
      )}
    </>
  );
}
