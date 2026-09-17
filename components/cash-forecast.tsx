"use client";
import { useMemo, useState, type FormEvent } from "react";
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
  forecast13Weeks,
  buildForecastMovements,
  localToday,
  type QlikCompany,
  type QlikWork,
  type CashEntry,
  type ForecastMovement,
} from "@/lib/operational-finance";
type Payment = {
  id: string;
  company_key: string;
  qlik_work_key: string | null;
  amount: number | null;
  due_date: string;
  scheduled_date: string | null;
  title: string;
  status: string;
};
type Commitment = {
  id: string;
  construction_id: string;
  amount: number;
  due_date: string;
  description: string;
  status: string;
  payment_request_id: string | null;
  cash_entry_id: string | null;
};
type CashData = {
  companies: QlikCompany[];
  catalog: QlikWork[];
  entries: CashEntry[];
  payments: Payment[];
  balances: Array<{ company_id: string; as_of: string; amount: number }>;
  reconciliations: Array<{ request_id: string; state: string }>;
  commitments: Commitment[];
  works: Array<{ id: string; qlik_work_key: string | null }>;
  connection: {
    last_success_at: string | null;
    last_error_at: string | null;
  } | null;
  canWrite: boolean;
};
export function CashForecast() {
  const [date, setDate] = useState(localToday);
  const o = useOperations<CashData>(`/api/operations/cash?date=${date}`);
  const [company, setCompany] = useState("");
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [detail, setDetail] = useState<{
    title: string;
    rows: ForecastMovement[];
    week?: number;
  } | null>(null);
  const [reconcile, setReconcile] = useState<Payment | null>(null);
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupPage, setLookupPage] = useState(0);
  const lookup = useOperations<{ entries: CashEntry[]; total: number }>(
    reconcile
      ? `/api/operations/cash/lookup?company_key=${encodeURIComponent(reconcile.company_key)}&work_key=${encodeURIComponent(reconcile.qlik_work_key || "")}&q=${encodeURIComponent(lookupQuery)}&page=${lookupPage}`
      : detail?.week !== undefined
        ? `/api/operations/cash/lookup?date=${date}&week=${detail.week}&company_id=${encodeURIComponent(company)}&page=${lookupPage}`
        : null,
  );
  const d = o.data;
  const calculation = useMemo(() => {
    if (!d) return null;
    const commitments = d.commitments.flatMap((c) => {
      const w = d.works.find((w) => w.id === c.construction_id);
      const companyId = d.catalog.find(
        (q) => q.key === w?.qlik_work_key,
      )?.company_id;
      if (!w?.qlik_work_key || !companyId) return [];
      return [{ ...c, company_id: companyId, work_key: w.qlik_work_key }];
    });
    const { moves, unmatchedPayments } = buildForecastMovements(
      d.entries,
      d.payments,
      d.companies,
      d.reconciliations,
      commitments,
    );
    const filtered = moves.filter((m) => !company || m.company_id === company);
    const selected = d.companies.filter((c) => !company || c.id === company);
    const complete =
      selected.length > 0 &&
      selected.every((c) => d.balances.some((b) => b.company_id === c.id));
    const opening = complete
      ? selected.reduce(
          (s, c) =>
            s + Number(d.balances.find((b) => b.company_id === c.id)!.amount),
          0,
        )
      : null;
    return {
      ...forecast13Weeks(date, filtered, opening),
      moves,
      opening,
      unmatchedPayments,
      byCompany: selected.map((c) => ({
        ...c,
        forecast: forecast13Weeks(
          date,
          moves.filter((m) => m.company_id === c.id),
          d.balances.find((b) => b.company_id === c.id)?.amount ?? null,
        ),
      })),
    };
  }, [d, company, date]);
  async function saveBalance(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (
      await o.save("/api/operations/cash", {
        action: "balance",
        company_id: f.get("company_id"),
        as_of: date,
        amount: Number(f.get("amount")),
        note: String(f.get("note") || ""),
      })
    )
      setBalanceOpen(false);
  }
  async function saveReconciliation(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (
      await o.save("/api/operations/cash", {
        action: "reconcile",
        request_id: reconcile!.id,
        state: f.get("state"),
        cash_entry_id: String(f.get("cash_entry_id") || "") || null,
      })
    )
      setReconcile(null);
  }
  const pending =
    d?.payments.filter(
      (p) =>
        !d.reconciliations.some((r) => r.request_id === p.id) &&
        (!company ||
          d.companies.find((c) => c.id === company)?.company_key ===
            p.company_key),
    ) || [];
  const totalIn = calculation?.weeks.reduce((s, w) => s + w.incoming, 0) || 0,
    totalOut = calculation?.weeks.reduce((s, w) => s + w.outgoing, 0) || 0;
  const max = Math.max(
    1,
    ...(calculation?.weeks.flatMap((w) => [w.incoming, w.outgoing]) || []),
  );
  return (
    <>
      <OperationsHeader
        title="Caixa projetado"
        description="Treze semanas para antecipar compromissos, acompanhar entradas e localizar necessidades de caixa por empresa."
        loading={o.loading}
        onRefresh={() => void o.reload()}
      >
        {d?.canWrite ? (
          <Button onClick={() => setBalanceOpen(true)}>
            Informar saldo inicial
          </Button>
        ) : null}
      </OperationsHeader>
      <OperationsDataStatus sources={["receivable", "payable", "catalog"]} />
      <OperationsError message={o.error} />
      <div className="ops-filters">
        <select
          aria-label="Empresa"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        >
          <option value="">Todas as empresas</option>
          {d?.companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label>
          Início{" "}
          <input
            aria-label="Data inicial"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || localToday())}
          />
        </label>
        <span className="ops-subtle">
          Última carga: {day(d?.connection?.last_success_at)}
        </span>
      </div>
      {!o.loading && d && !d.companies.length ? (
        <OperationsEmpty text="A projeção ficará disponível após a primeira carga validada de empresas e títulos do Qlik." />
      ) : calculation ? (
        <>
          {calculation.opening === null ? (
            <div className="ops-notice">
              Informe o saldo inicial de cada empresa em {day(date)} para
              calcular o saldo e identificar falta de caixa. Entradas e saídas
              continuam disponíveis.
            </div>
          ) : null}
          <div className="ops-kpis">
            <div className="ops-kpi">
              <span>Saldo inicial</span>
              <strong>{money(calculation.opening)}</strong>
              <small>Na data de início</small>
            </div>
            <div className="ops-kpi">
              <span>Entradas previstas</span>
              <strong>{money(totalIn)}</strong>
              <small>13 semanas</small>
            </div>
            <div className="ops-kpi">
              <span>Saídas confirmadas na projeção</span>
              <strong>{money(totalOut)}</strong>
              <small>Sem duplicar vínculos conciliados</small>
            </div>
            <div className="ops-kpi">
              <span>Saldo na semana 13</span>
              <strong
                className={
                  (calculation.weeks[12].closing ?? 0) < 0 ? "ops-negative" : ""
                }
              >
                {money(calculation.weeks[12].closing)}
              </strong>
              <small>Variação: {money(totalIn - totalOut)}</small>
            </div>
          </div>
          <div className="ops-panel">
            <h2>Entradas e saídas por semana</h2>
            <p className="ops-subtle">
              Verde: entradas · areia: saídas. Valores vencidos aguardam uma
              data esperada de caixa.
            </p>
            <div style={{ overflowX: "auto" }}>
              <div className="ops-chart">
                {calculation.weeks.map((w) => (
                  <div
                    className="ops-chart-col"
                    key={w.index}
                    title={`Semana ${w.index + 1}: entradas ${money(w.incoming)}, saídas ${money(w.outgoing)}`}
                  >
                    <span
                      className="ops-chart-in"
                      style={{ height: `${(w.incoming / max) * 100}%` }}
                    />
                    <span
                      className="ops-chart-out"
                      style={{ height: `${(w.outgoing / max) * 100}%` }}
                    />
                    <label>S{w.index + 1}</label>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Semana</th>
                  <th>Entradas</th>
                  <th>Saídas</th>
                  <th>A conciliar</th>
                  <th>Saldo final</th>
                  <th>Com solicitações a conciliar</th>
                </tr>
              </thead>
              <tbody>
                {calculation.weeks.map((w) => (
                  <tr key={w.index}>
                    <td>
                      <button
                        className="ops-text-button"
                        onClick={() =>
                          setDetail({
                            title: `Semana ${w.index + 1}`,
                            rows: w.movements,
                            week: w.index,
                          })
                        }
                      >
                        Semana {w.index + 1}
                      </button>
                      <small>
                        {day(w.start)} a {day(w.end)}
                      </small>
                    </td>
                    <td>{money(w.incoming)}</td>
                    <td>{money(w.outgoing)}</td>
                    <td>{money(w.pending)}</td>
                    <td className={(w.closing ?? 0) < 0 ? "ops-negative" : ""}>
                      {money(w.closing)}
                    </td>
                    <td
                      className={
                        (w.closingWithPending ?? 0) < 0 ? "ops-negative" : ""
                      }
                    >
                      {money(w.closingWithPending)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!company ? (
            <section className="ops-panel">
              <h2>Necessidade de caixa por empresa</h2>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Empresa</th>
                      <th>Primeiro saldo negativo</th>
                      <th>Saldo na semana 13</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calculation.byCompany.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <button
                            className="ops-text-button"
                            onClick={() => setCompany(c.id)}
                          >
                            {c.name}
                          </button>
                        </td>
                        <td>
                          {c.forecast.weeks[0].closing === null
                            ? "Saldo inicial pendente"
                            : c.forecast.firstShortfall
                              ? `Semana ${c.forecast.firstShortfall.index + 1} · ${money(c.forecast.firstShortfall.closing)}`
                              : "Nenhum nas 13 semanas"}
                        </td>
                        <td>{money(c.forecast.weeks[12].closing)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
          <div className="ops-notice">
            {calculation.overdue.length} grupos de títulos vencidos e{" "}
            {calculation.undated.length} sem data estão fora da distribuição
            semanal.{" "}
            <button
              className="button button-ghost"
              onClick={() =>
                setDetail({
                  title: "Vencidos e sem data esperada",
                  week: -1,
                  rows: [...calculation.overdue, ...calculation.undated],
                })
              }
            >
              Conferir
            </button>
          </div>
          {pending.length ? (
            <section className="ops-panel">
              <h2>Solicitações aprovadas a conciliar ({pending.length})</h2>
              <p className="ops-subtle">
                Confirme se cada pedido é adicional ou já está no Qlik. Até lá,
                aparece em “A conciliar” e não altera o saldo confirmado.
              </p>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <tbody>
                    {pending.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/pagamentos/${p.id}`}>{p.title}</Link>
                          <small>{p.company_key}</small>
                        </td>
                        <td>{money(p.amount)}</td>
                        <td>{day(p.scheduled_date || p.due_date)}</td>
                        <td>
                          {d?.canWrite ? (
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setLookupPage(0);
                                setLookupQuery("");
                                setReconcile(p);
                              }}
                            >
                              Conciliar
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
          {calculation.unmatchedPayments.length ? (
            <div className="ops-notice">
              {calculation.unmatchedPayments.length} solicitações sem empresa
              vinculada ou valor completo precisam de revisão.
            </div>
          ) : null}
        </>
      ) : o.loading ? (
        <OperationsEmpty text="Carregando a projeção…" />
      ) : null}
      <Dialog
        open={balanceOpen}
        onClose={() => setBalanceOpen(false)}
        title="Saldo inicial por empresa"
        description={`Saldo disponível no início de ${day(date)}.`}
      >
        <form className="form-grid" onSubmit={saveBalance}>
          <Field label="Empresa">
            <select name="company_id" defaultValue={company} required>
              <option value="">Selecione</option>
              {d?.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Saldo disponível">
            <input name="amount" type="number" step="0.01" required />
          </Field>
          <Field label="Origem ou observação">
            <textarea name="note" maxLength={2000} />
          </Field>
          <Button type="submit" loading={o.saving}>
            Salvar saldo
          </Button>
        </form>
      </Dialog>
      <Dialog
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.title || ""}
        wide
      >
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Lançamento</th>
                <th>Empresa</th>
                <th>Data</th>
                <th>Valor</th>
              </tr>
            </thead>
            <tbody>
              {detail?.rows.map((m) => (
                <tr key={`${m.source}-${m.id}`}>
                  <td>
                    {m.href ? (
                      <Link href={m.href}>{m.description}</Link>
                    ) : (
                      m.description
                    )}
                    <small>
                      {m.source === "qlik"
                        ? "Qlik"
                        : m.source === "payment"
                          ? "Solicitação"
                          : "Compromisso de obra"}{" "}
                      {m.pending ? "· a conciliar" : ""}
                    </small>
                  </td>
                  <td>
                    {d?.companies.find((c) => c.id === m.company_id)?.name}
                  </td>
                  <td>{day(m.date)}</td>
                  <td>
                    {m.direction === "out" ? "− " : ""}
                    {money(m.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {detail?.week !== undefined ? (
          <>
            <h3>Títulos do Qlik nesta seleção</h3>
            <OperationsError message={lookup.error} />
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Título / cliente ou fornecedor</th>
                    <th>Data</th>
                    <th>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {lookup.data?.entries.map((e) => (
                    <tr key={e.id}>
                      <td>
                        {e.counterparty}
                        <small>{e.description}</small>
                      </td>
                      <td>{day(e.cash_date)}</td>
                      <td>
                        {e.kind === "payable" ? "− " : ""}
                        {money(e.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ops-pagination">
              <Button
                variant="secondary"
                disabled={!lookupPage}
                onClick={() => setLookupPage(lookupPage - 1)}
              >
                Anterior
              </Button>
              <span>{lookup.data?.total || 0} títulos</span>
              <Button
                variant="secondary"
                disabled={(lookupPage + 1) * 100 >= (lookup.data?.total || 0)}
                onClick={() => setLookupPage(lookupPage + 1)}
              >
                Próxima
              </Button>
            </div>
          </>
        ) : null}
      </Dialog>
      <Dialog
        open={!!reconcile}
        onClose={() => setReconcile(null)}
        title="Conciliar solicitação"
      >
        <form className="form-grid" onSubmit={saveReconciliation}>
          <p>{reconcile?.title}</p>
          <Field label="Como considerar no caixa">
            <select name="state">
              <option value="additional">
                Compromisso adicional — somar ao caixa
              </option>
              <option value="linked">Já registrado no Qlik — vincular</option>
            </select>
          </Field>
          <Field label="Buscar título ou fornecedor">
            <input
              value={lookupQuery}
              onChange={(e) => {
                setLookupQuery(e.target.value);
                setLookupPage(0);
              }}
            />
          </Field>
          <OperationsError message={lookup.error} />
          <p className="ops-subtle">
            Exibindo até 100 de {lookup.data?.total || 0} títulos. Use a busca
            para localizar o correspondente.
          </p>
          <Field label="Lançamento correspondente no Qlik">
            <select name="cash_entry_id">
              <option value="">Selecione se já registrado</option>
              {lookup.data?.entries.map((e) => (
                <option value={e.id} key={e.id}>
                  {day(e.cash_date)} · {e.counterparty} · {e.description} ·{" "}
                  {money(e.amount)}
                </option>
              ))}
            </select>
          </Field>
          <Button loading={o.saving}>Salvar conciliação</Button>
        </form>
      </Dialog>
    </>
  );
}
