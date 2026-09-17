"use client";
import { useState, type FormEvent } from "react";
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
import type {
  ClientWorkspaceData,
  ClientContract,
} from "@/lib/client-workspace";
import {
  COLLECTION_GROUPS,
  localToday,
  type CollectionCase,
  type CollectionGroup,
} from "@/lib/operational-finance";
export function CollectionsWorkspace() {
  const [group, setGroup] = useState<CollectionGroup | "all">("all");
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState("");
  const [page, setPage] = useState(0);
  const o = useOperations<ClientWorkspaceData>(
    `/api/operations/collections?page=${page}&q=${encodeURIComponent(query)}&group=${group}&company=${encodeURIComponent(company)}`,
  );
  const d = o.data;
  const [editing, setEditing] = useState<ClientContract | null>(null);
  const [legal, setLegal] = useState("unknown");
  const today = localToday();
  const rows = (d?.contracts || []).map((c) => ({
    ...c,
    client: d?.clients.find((a) => a.id === c.client_id),
    case: d?.cases.find((a) => a.contract_id === c.id) || null,
    classification: {
      lastReceipt: c.last_receipt,
      group: c.collection_group || "review",
      amount: Number(c.overdue_amount || 0),
      count: Number(c.overdue_count || 0),
      oldest: c.oldest_due,
      days: c.oldest_due
        ? Math.floor((Date.parse(today) - Date.parse(c.oldest_due)) / 86400000)
        : 0,
      promiseOverdue: !!c.promise_overdue,
      reason: (
        {
          easy: "Até duas parcelas vencidas e recebimentos posteriores.",
          negotiation: "Até 90 dias de atraso com histórico de recebimentos.",
          difficult:
            "Atraso persistente, histórico insuficiente ou promessa vencida.",
          review: "Histórico insuficiente para classificação.",
          judicial: "Tratativa jurídica ou suspensa.",
          current: "Sem títulos vencidos.",
        } as Record<string, string>
      )[c.collection_group || "review"],
    },
  }));
  const filtered = rows;
  const totalGroup = (groups: string[]) =>
    (d?.totals || []).filter((t) => groups.includes(t.collection_group));
  const current = d?.cases.find((r) => r.contract_id === editing?.id);
  const details = useOperations<{
    entries: import("@/lib/operational-finance").CashEntry[];
  }>(
    editing
      ? `/api/operations/entries?contract_id=${encodeURIComponent(editing.id)}&kind=received`
      : null,
  );
  const receipts = details.data?.entries || [];
  function open(c: ClientContract) {
    setEditing(c);
    setLegal(
      d?.cases.find((r) => r.contract_id === c.id)?.legal_status || "unknown",
    );
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const promiseDate = String(f.get("promise_date") || "");
    const last = String(f.get("last_contact_at") || "");
    const body: CollectionCase = {
      contract_id: editing!.id,
      version: current?.version || 0,
      responsible_user_id: String(f.get("responsible_user_id") || "") || null,
      legal_status: legal as CollectionCase["legal_status"],
      next_action: String(f.get("next_action") || ""),
      next_action_date: String(f.get("next_action_date") || "") || null,
      last_contact_at: last ? `${last}T12:00:00-03:00` : null,
      promise_date: promiseDate || null,
      promise_amount: promiseDate ? Number(f.get("promise_amount")) : null,
      promise_status: String(
        f.get("promise_status"),
      ) as CollectionCase["promise_status"],
      receipt_entry_id: String(f.get("receipt_entry_id") || "") || null,
      notes: String(f.get("notes") || ""),
    };
    if (await o.save("/api/operations/collections", body)) setEditing(null);
  }
  return (
    <>
      <OperationsHeader
        title="Cobrança"
        description="Uma carteira de trabalho por contrato, com prioridade explicada, próxima ação e comprovação de recebimento."
        loading={o.loading}
        onRefresh={() => void o.reload()}
      />
      <OperationsDataStatus sources={["receivable", "received", "catalog"]} />
      <OperationsError message={o.error} />
      <div className="ops-kpis">
        <div className="ops-kpi">
          <span>Contratos na carteira de recuperação</span>
          <strong>
            {totalGroup(["easy", "negotiation", "difficult"]).reduce(
              (s, t) => s + Number(t.contracts),
              0,
            )}
          </strong>
        </div>
        <div className="ops-kpi">
          <span>Saldo vencido da carteira</span>
          <strong>
            {money(
              totalGroup(["easy", "negotiation", "difficult"]).reduce(
                (s, t) => s + Number(t.amount),
                0,
              ),
            )}
          </strong>
        </div>
        <div className="ops-kpi">
          <span>Recuperação difícil</span>
          <strong>
            {totalGroup(["difficult"]).reduce(
              (s, t) => s + Number(t.contracts),
              0,
            )}
          </strong>
        </div>
        <div className="ops-kpi">
          <span>Promessas vencidas</span>
          <strong>
            {(d?.totals || []).reduce((s, t) => s + Number(t.promises), 0)}
          </strong>
        </div>
      </div>
      <div className="ops-tabs" role="tablist" aria-label="Grupos de cobrança">
        <button
          role="tab"
          aria-selected={group === "all"}
          onClick={() => {
            setGroup("all");
            setPage(0);
          }}
        >
          Todos os atrasos
        </button>
        {Object.entries(COLLECTION_GROUPS)
          .filter(([key]) => key !== "review")
          .map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={group === key}
              onClick={() => {
                setGroup(key as CollectionGroup);
                setPage(0);
              }}
            >
              {label} (
              {totalGroup([key]).reduce((s, t) => s + Number(t.contracts), 0)})
            </button>
          ))}
      </div>
      <div className="ops-filters">
        <input
          placeholder="Cliente, contrato ou lote"
          aria-label="Buscar contrato"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <select
          aria-label="Empresa"
          value={company}
          onChange={(e) => {
            setCompany(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Todas as empresas</option>
          {d?.companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="ops-notice">
        “Parcelas esquecidas” reúne contratos com até duas parcelas vencidas e
        pagamentos posteriores. A prioridade acompanha o histórico financeiro;
        a situação jurídica é registrada pela equipe em cada contrato.
      </div>
      {filtered.length ? (
        <>
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Cliente / contrato</th>
                  <th>Prioridade e evidência</th>
                  <th>Saldo vencido</th>
                  <th>Responsável / retorno</th>
                  <th>Promessa</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.client?.name || r.client_id}</strong>
                      <small>
                        {r.contract_number} ·{" "}
                        {d?.works.find((w) => w.key === r.work_key)?.name ||
                          "Obra não vinculada"}
                      </small>
                      <small>
                        Lote {r.lot || "—"} · Último contato:{" "}
                        {day(r.case?.last_contact_at)}
                      </small>
                    </td>
                    <td>
                      {COLLECTION_GROUPS[r.classification.group]}
                      <small>{r.classification.reason}</small>
                      <small>
                        Último recebimento: {day(r.classification.lastReceipt)}
                      </small>
                    </td>
                    <td>
                      {money(r.classification.amount)}
                      <small>
                        {r.classification.count} parcelas ·{" "}
                        {r.classification.days} dias
                      </small>
                    </td>
                    <td>
                      {d?.users.find(
                        (u) => u.user_id === r.case?.responsible_user_id,
                      )?.full_name || "A definir"}
                      <small>
                        {r.case?.next_action || "Próxima ação não definida"}
                      </small>
                      <small>{day(r.case?.next_action_date)}</small>
                    </td>
                    <td
                      className={
                        r.classification.promiseOverdue ? "ops-negative" : ""
                      }
                    >
                      {r.case?.promise_date
                        ? money(r.case.promise_amount)
                        : "Não registrada"}
                      <small>
                        {r.case?.promise_date ? day(r.case.promise_date) : ""}
                        {r.classification.promiseOverdue ? " · vencida" : ""}
                      </small>
                      <small>
                        {r.case?.promise_status === "fulfilled"
                          ? "Recebimento confirmado"
                          : ""}
                      </small>
                    </td>
                    <td>
                      {d?.canWrite ? (
                        <Button variant="secondary" onClick={() => open(r)}>
                          Tratar
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ops-pagination">
            <Button
              variant="secondary"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              Anterior
            </Button>
            <span>
              {d?.total || 0} contratos · página {page + 1}
            </span>
            <Button
              variant="secondary"
              disabled={(page + 1) * 25 >= (d?.total || 0)}
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
              ? "Carregando carteira…"
              : "Nenhum contrato neste grupo. A primeira carga precisa incluir títulos e contratos validados."
          }
        />
      )}
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Tratar contrato ${editing?.contract_number || ""}`}
        wide
      >
        <form className="form-grid" onSubmit={save}>
          <Field label="Situação jurídica">
            <select value={legal} onChange={(e) => setLegal(e.target.value)}>
              <option value="unknown">Ainda não verificada</option>
              <option value="extrajudicial">
                Cobrança extrajudicial confirmada
              </option>
              <option value="judicial">Em tratamento judicial</option>
              <option value="suspended">Cobrança suspensa</option>
            </select>
          </Field>
          <Field label="Responsável">
            <select
              name="responsible_user_id"
              defaultValue={current?.responsible_user_id || ""}
            >
              <option value="">A definir</option>
              {d?.users.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.full_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Último contato">
            <input
              type="date"
              name="last_contact_at"
              max={today}
              defaultValue={current?.last_contact_at?.slice(0, 10) || ""}
            />
          </Field>
          <Field label="Próximo retorno">
            <input
              type="date"
              name="next_action_date"
              defaultValue={current?.next_action_date || ""}
            />
          </Field>
          <Field label="Próxima ação" className="form-span-2">
            <textarea
              name="next_action"
              defaultValue={current?.next_action || ""}
              maxLength={2000}
            />
          </Field>
          <Field label="Data prometida">
            <input
              type="date"
              name="promise_date"
              defaultValue={current?.promise_date || ""}
            />
          </Field>
          <Field label="Valor prometido">
            <input
              name="promise_amount"
              type="number"
              min="0.01"
              step="0.01"
              defaultValue={current?.promise_amount || ""}
            />
          </Field>
          <Field label="Situação da promessa">
            <select
              name="promise_status"
              defaultValue={current?.promise_status || "none"}
            >
              <option value="none">Sem promessa</option>
              <option value="open">Aguardando pagamento</option>
              <option value="fulfilled">Recebimento confirmado</option>
              <option value="broken">Descumprida</option>
              <option value="cancelled">Cancelada</option>
            </select>
          </Field>
          <Field
            label="Baixa que confirma o recebimento"
            hint="Obrigatória ao confirmar recebimento; deve comprovar o valor prometido."
          >
            <select
              name="receipt_entry_id"
              defaultValue={current?.receipt_entry_id || ""}
            >
              <option value="">Selecione</option>
              {receipts.map((r) => (
                <option key={r.id} value={r.id}>
                  {day(r.cash_date)} · {money(r.amount)} · {r.title_key}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Observações" className="form-span-2">
            <textarea
              name="notes"
              defaultValue={current?.notes || ""}
              maxLength={5000}
            />
          </Field>
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditing(null)}
            >
              Cancelar
            </Button>
            <Button loading={o.saving}>Salvar tratativa</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
