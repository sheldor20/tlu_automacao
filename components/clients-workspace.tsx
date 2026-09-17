"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button, Dialog, Field } from "./ui";
import {
  useOperations,
  OperationsHeader,
  OperationsDataStatus,
  OperationsError,
  OperationsEmpty,
  money,
  day,
} from "./operations-common";
import {
  EVENT_LABELS,
  EVENT_STATUSES,
  CLIENT_FINANCIAL_LABELS,
  clientFinancialStatus,
  type ClientWorkspaceData,
  type ClientEvent,
  type ClientFinancialStatus,
} from "@/lib/client-workspace";
import { localToday } from "@/lib/operational-finance";
import { paymentFetch } from "@/lib/payment-client";
import { getSupabase } from "@/lib/supabase";
const TABS = [
  ["all", "Visão geral"],
  ["payments", "Pagamentos"],
  ["collection", "Cobrança"],
  ["renegotiation", "Renegociação"],
  ["legal", "Jurídico"],
  ["document", "Documentos"],
  ["contact", "Atendimentos"],
  ["regularization", "Regularização"],
];
function FinancialBadge({ status }: { status: ClientFinancialStatus }) {
  return (
    <span className={`ops-client-status ops-client-status-${status}`}>
      {CLIENT_FINANCIAL_LABELS[status]}
    </span>
  );
}
export function ClientsWorkspace() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [clientId, setClientId] = useState(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("id") || ""
      : "",
  );
  const o = useOperations<ClientWorkspaceData>(
    `/api/operations/clients?q=${encodeURIComponent(query)}&page=${page}&client_id=${encodeURIComponent(clientId)}`,
  );
  const d = o.data;
  const [contractId, setContractId] = useState("");
  const [tab, setTab] = useState("all");
  const [edit, setEdit] = useState<Partial<ClientEvent> | null>(null);
  const [upload, setUpload] = useState(false);
  const client = d?.clients.find((c) => c.id === clientId);
  const contracts = d?.contracts.filter((c) => c.client_id === clientId) || [];
  const ids = new Set(
    contracts
      .filter((c) => !contractId || c.id === contractId)
      .map((c) => c.id),
  );
  const entries =
    d?.entries.filter((e) => e.contract_id && ids.has(e.contract_id)) || [];
  const events = (d?.events || [])
    .filter(
      (e) =>
        e.client_id === clientId &&
        (!contractId || e.contract_id === contractId) &&
        (tab === "all" || e.kind === tab),
    )
    .sort(
      (a, b) =>
        b.event_date.localeCompare(a.event_date) ||
        b.created_at.localeCompare(a.created_at),
    );
  const visible = d?.clients || [];
  const late = entries
    .filter(
      (e) =>
        e.kind === "receivable" && e.cash_date && e.cash_date < localToday(),
    )
    .reduce((s, e) => s + Number(e.amount), 0);
  async function saveEvent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (
      await o.save("/api/operations/clients", {
        ...(edit?.id ? { id: edit.id } : {}),
        client_id: clientId,
        contract_id: String(f.get("contract_id") || "") || null,
        kind: f.get("kind"),
        title: f.get("title"),
        description: f.get("description"),
        event_date: f.get("event_date"),
        due_date: String(f.get("due_date") || "") || null,
        status: f.get("status"),
        responsible_user_id: String(f.get("responsible_user_id") || "") || null,
      })
    )
      setEdit(null);
  }
  async function uploadFile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUpload(true);
    try {
      const f = new FormData(e.currentTarget);
      f.set("client_id", clientId);
      f.set("contract_id", contractId);
      const session = await getSupabase()?.auth.getSession();
      const res = await fetch("/api/operations/clients/document", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.data.session?.access_token || ""}`,
        },
        body: f,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      await o.reload();
    } catch (e) {
      o.setError(e instanceof Error ? e.message : "Falha no envio.");
    } finally {
      setUpload(false);
    }
  }
  async function openDocument(id: string) {
    try {
      const result = await paymentFetch(
        `/api/operations/clients/document?id=${id}`,
      );
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      o.setError(e instanceof Error ? e.message : "Documento indisponível.");
    }
  }
  return (
    <>
      <OperationsHeader
        title={client ? client.name : "Clientes"}
        description={
          client
            ? "Histórico compartilhado de contratos, pagamentos, tratativas e documentos."
            : "Encontre o cliente pelo nome, contrato, lote ou empreendimento e consulte o histórico antes do contato."
        }
        loading={o.loading}
        onRefresh={() => void o.reload()}
      >
        {client ? (
          <Button
            variant="secondary"
            onClick={() => {
              setClientId("");
              setContractId("");
            }}
          >
            Voltar à carteira
          </Button>
        ) : null}
      </OperationsHeader>
      <OperationsDataStatus
        sources={["receivable", "received", "catalog", "client_status"]}
      />
      <OperationsError message={o.error} />
      {!client ? (
        <>
          <div className="ops-filters">
            <input
              className="ops-filter-grow"
              aria-label="Buscar cliente"
              placeholder="Nome, contrato, lote ou empreendimento"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
            <span className="ops-subtle">{d?.total || 0} clientes</span>
          </div>
          {visible.length ? (
            <>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Contratos e unidades</th>
                      <th>Situação financeira</th>
                      <th>Registro</th>
                      <th>Escritura</th>
                      <th>Contato</th>
                      <th>Atualização</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((c) => {
                      const clientContracts =
                        d?.contracts.filter((k) => k.client_id === c.id) || [];
                      const financialStatus =
                        clientFinancialStatus(clientContracts);
                      return (
                        <tr key={c.id}>
                          <td>
                            <button
                              className="ops-text-button"
                              onClick={() => {
                                setClientId(c.id);
                                setTab("all");
                              }}
                            >
                              {c.name}
                            </button>
                            <small>ID {c.id}</small>
                          </td>
                          <td>
                            {clientContracts.map((k) => (
                              <div key={k.id}>
                                {k.contract_number} ·{" "}
                                {k.block ? `Quadra ${k.block} ` : ""}
                                {k.lot ? `Lote ${k.lot}` : ""}
                                <small>
                                  {d?.works.find((w) => w.key === k.work_key)
                                    ?.name ||
                                    d?.companies.find(
                                      (v) => v.id === k.company_id,
                                    )?.name}
                                </small>
                              </div>
                            ))}
                          </td>
                          <td>
                            <FinancialBadge status={financialStatus} />
                            {financialStatus === "overdue" ? (
                              <small>
                                {money(
                                  clientContracts.reduce(
                                    (sum, k) =>
                                      sum + Number(k.overdue_amount || 0),
                                    0,
                                  ),
                                )}{" "}
                                em atraso
                              </small>
                            ) : null}
                            {financialStatus === "unknown" ? (
                              <small>Situação ainda não confirmada</small>
                            ) : null}
                          </td>
                          {(
                            ["registration_status", "deed_status"] as const
                          ).map((field) => (
                            <td key={field}>
                              {clientContracts.length
                                ? clientContracts.map((k) => (
                                    <div
                                      className="ops-property-status"
                                      key={k.id}
                                    >
                                      <span>{k[field] || "Não informado"}</span>
                                      {clientContracts.length > 1 ? (
                                        <small>
                                          Contrato {k.contract_number}
                                        </small>
                                      ) : null}
                                    </div>
                                  ))
                                : "Não informado"}
                            </td>
                          ))}
                          <td>
                            {c.phone || "Telefone não informado"}
                            <small>{c.email}</small>
                          </td>
                          <td>{day(c.synchronized_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="ops-pagination">
                <Button
                  variant="secondary"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  Anterior
                </Button>
                <span>
                  Página {page + 1} de{" "}
                  {Math.max(1, Math.ceil((d?.total || 0) / 30))}
                </span>
                <Button
                  variant="secondary"
                  disabled={(page + 1) * 30 >= (d?.total || 0)}
                  onClick={() => setPage(page + 1)}
                >
                  Próxima
                </Button>
              </div>
            </>
          ) : (
            <OperationsEmpty
              text={
                o.loading
                  ? "Carregando clientes…"
                  : "Nenhum cliente encontrado. A carteira depende da carga validada de clientes e contratos do Qlik."
              }
            />
          )}
        </>
      ) : (
        <>
          <div className="ops-inline">
            <p className="ops-subtle">
              ID {client.id} · {client.phone || "Telefone não informado"} ·{" "}
              {client.email || "E-mail não informado"}
            </p>
            {d?.canWrite ? (
              <Button
                onClick={() => setEdit({ kind: "contact", status: "open" })}
              >
                Registrar acompanhamento
              </Button>
            ) : null}
          </div>
          <div className="ops-filters">
            <select
              aria-label="Contrato"
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
            >
              <option value="">Todos os contratos</option>
              {contracts.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.contract_number} · {c.lot || "Unidade não informada"}
                </option>
              ))}
            </select>
          </div>
          <div className="ops-kpis">
            <div className="ops-kpi">
              <span>Contratos</span>
              <strong>{ids.size}</strong>
            </div>
            <div className="ops-kpi">
              <span>Recebido na origem</span>
              <strong>
                {money(
                  entries
                    .filter((e) => e.kind === "received")
                    .reduce((s, e) => s + Number(e.amount), 0),
                )}
              </strong>
            </div>
            <div className="ops-kpi">
              <span>Saldo vencido</span>
              <strong className={late ? "ops-negative" : ""}>
                {money(late)}
              </strong>
            </div>
            <div className="ops-kpi">
              <span>Próximas providências</span>
              <strong>
                {
                  (d?.events || []).filter(
                    (e) =>
                      e.client_id === clientId &&
                      ["open", "in_progress"].includes(e.status),
                  ).length
                }
              </strong>
            </div>
          </div>
          <div className="ops-contracts">
            {contracts
              .filter((c) => !contractId || c.id === contractId)
              .map((c) => (
                <div className="ops-contract" key={c.id}>
                  <strong>Contrato {c.contract_number}</strong>
                  <div className="ops-contract-status">
                    <FinancialBadge status={c.financial_status || "unknown"} />
                  </div>
                  <p>
                    {d?.works.find((w) => w.key === c.work_key)?.name ||
                      "Obra não vinculada"}
                  </p>
                  <small>
                    Quadra {c.block || "—"} · Lote {c.lot || "—"} ·{" "}
                    {c.sale_status || c.status || "Situação não informada"}
                  </small>
                  <dl className="ops-property-details">
                    <div>
                      <dt>Registro</dt>
                      <dd>{c.registration_status || "Não informado"}</dd>
                    </div>
                    <div>
                      <dt>Escritura</dt>
                      <dd>{c.deed_status || "Não informado"}</dd>
                    </div>
                  </dl>
                  {c.status_synced_at ? (
                    <small>
                      Escrituração atualizada em {day(c.status_synced_at)}
                    </small>
                  ) : null}
                </div>
              ))}
          </div>
          <div
            className="ops-tabs"
            role="tablist"
            aria-label="Histórico do cliente"
          >
            {TABS.map(([key, label]) => (
              <button
                role="tab"
                aria-selected={tab === key}
                key={key}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "payments" ? (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Parcela / lançamento</th>
                    <th>Situação</th>
                    <th>Data</th>
                    <th>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {entries
                    .filter(
                      (e) => e.kind === "received" || e.kind === "receivable",
                    )
                    .sort((a, b) =>
                      (b.cash_date || "").localeCompare(a.cash_date || ""),
                    )
                    .map((e) => (
                      <tr key={e.id}>
                        <td>
                          {e.description || e.title_key}
                          <small>
                            Contrato{" "}
                            {
                              contracts.find((c) => c.id === e.contract_id)
                                ?.contract_number
                            }
                          </small>
                        </td>
                        <td>
                          {e.kind === "received"
                            ? "Recebido"
                            : e.cash_date && e.cash_date < localToday()
                              ? "Vencido"
                              : "A receber"}
                        </td>
                        <td>{day(e.cash_date)}</td>
                        <td>{money(e.amount)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : tab === "collection" ? (
            <section className="ops-panel">
              <h2>Tratativas de cobrança</h2>
              {contracts
                .filter((c) => ids.has(c.id))
                .map((c) => {
                  const r = d?.cases.find((r) => r.contract_id === c.id);
                  return (
                    <div className="ops-event" key={c.id}>
                      <strong>Contrato {c.contract_number}</strong>
                      <p>
                        {r?.next_action || "Próxima ação ainda não definida."}
                      </p>
                      <small>
                        Responsável:{" "}
                        {d?.users.find(
                          (u) => u.user_id === r?.responsible_user_id,
                        )?.full_name || "A definir"}{" "}
                        · Retorno: {day(r?.next_action_date)}
                      </small>
                      <p>
                        Promessa:{" "}
                        {r?.promise_date
                          ? `${day(r.promise_date)} · ${money(r.promise_amount)}`
                          : "Não registrada"}
                      </p>
                    </div>
                  );
                })}
              <Link href="/cobranca">Abrir central de cobrança</Link>
            </section>
          ) : (
            <>
              {tab === "document" && d?.canWrite ? (
                <form className="ops-panel" onSubmit={uploadFile}>
                  <Field
                    label="Adicionar documento"
                    hint="PDF, JPG ou PNG, até 4 MB. O documento fica restrito à equipe autorizada."
                  >
                    <input
                      type="file"
                      name="file"
                      accept="application/pdf,image/jpeg,image/png"
                      required
                    />
                  </Field>
                  <Button loading={upload}>Enviar documento</Button>
                </form>
              ) : null}
              {events.length ? (
                <div className="ops-timeline">
                  {events.map((e) => (
                    <article className="ops-event" key={e.id}>
                      <div className="ops-inline">
                        <strong>{e.title}</strong>
                        <small>
                          {day(e.event_date)} · {EVENT_LABELS[e.kind]}
                        </small>
                      </div>
                      <p>
                        {e.kind === "collection"
                          ? "Responsável, próxima ação ou promessa atualizados. Consulte a aba Cobrança."
                          : e.description}
                      </p>
                      <small>
                        {EVENT_STATUSES[e.status]}
                        {e.due_date ? ` · Prazo: ${day(e.due_date)}` : ""}
                        {e.responsible_user_id
                          ? ` · ${d?.users.find((u) => u.user_id === e.responsible_user_id)?.full_name || "Responsável"}`
                          : ""}
                      </small>
                      <div className="ops-actions">
                        {e.file_path ? (
                          <Button
                            variant="secondary"
                            onClick={() => void openDocument(e.id)}
                          >
                            Abrir documento
                          </Button>
                        ) : null}
                        {d?.canWrite &&
                        e.kind !== "collection" &&
                        e.kind !== "document" ? (
                          <Button variant="ghost" onClick={() => setEdit(e)}>
                            Atualizar
                          </Button>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <OperationsEmpty text="Nenhum registro nesta visão. Registre a próxima ação ou importe o histórico validado da área." />
              )}
            </>
          )}
        </>
      )}
      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? "Atualizar acompanhamento" : "Novo acompanhamento"}
        wide
      >
        <form className="form-grid" onSubmit={saveEvent}>
          <Field label="Tipo">
            <select name="kind" defaultValue={edit?.kind || "contact"}>
              {Object.entries(EVENT_LABELS)
                .filter(([k]) => k !== "collection" && k !== "document")
                .map(([k, v]) => (
                  <option value={k} key={k}>
                    {v}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Contrato">
            <select
              name="contract_id"
              defaultValue={edit?.contract_id || contractId}
            >
              <option value="">Histórico geral do cliente</option>
              {contracts.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.contract_number}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Título / número do processo" className="form-span-2">
            <input
              name="title"
              defaultValue={edit?.title || ""}
              maxLength={300}
              required
            />
          </Field>
          <Field
            label="Histórico, condições ou providências"
            className="form-span-2"
          >
            <textarea
              name="description"
              defaultValue={edit?.description || ""}
              maxLength={10000}
            />
          </Field>
          <Field label="Data do registro">
            <input
              name="event_date"
              type="date"
              defaultValue={edit?.event_date || localToday()}
              required
            />
          </Field>
          <Field label="Prazo / próxima ação">
            <input
              name="due_date"
              type="date"
              defaultValue={edit?.due_date || ""}
            />
          </Field>
          <Field label="Responsável">
            <select
              name="responsible_user_id"
              defaultValue={edit?.responsible_user_id || ""}
            >
              <option value="">A definir</option>
              {d?.users.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.full_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select name="status" defaultValue={edit?.status || "open"}>
              {Object.entries(EVENT_STATUSES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEdit(null)}
            >
              Cancelar
            </Button>
            <Button loading={o.saving}>Salvar registro</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
