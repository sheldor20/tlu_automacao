"use client";
import { useState, type FormEvent } from "react";
import { Button, Dialog, Field } from "./ui";
import { QlikWorkSelect } from "./qlik-work-select";
import {
  useOperations,
  OperationsError,
  OperationsDataStatus,
  money,
  day,
} from "./operations-common";
import { constructionBudget, type CashEntry } from "@/lib/operational-finance";
type Commitment = {
  id: string;
  macro_stage_id: string | null;
  supplier: string;
  description: string;
  due_date: string;
  amount: number;
  status: string;
  payment_request_id: string | null;
  cash_entry_id: string | null;
};
type Data = {
  work: {
    id: string;
    name: string;
    qlik_work_key: string | null;
    planned_budget: number;
  };
  commitments: Commitment[];
  estimate: { remaining_uncommitted: number; note: string } | null;
  entries: CashEntry[];
  stages: Array<{
    id: string;
    name: string;
    progress_percent: number;
    weight_percent: number;
  }>;
  payments: Array<{
    id: string;
    title: string;
    amount: number;
    status: string;
  }>;
  mappings: Array<{ source_category: string; macro_stage_id: string }>;
  stageBudgets: Array<{
    macro_stage_id: string;
    planned_budget: number;
    remaining_uncommitted: number | null;
  }>;
  reconciliations: Array<{
    request_id: string;
    state: string;
    cash_entry_id: string | null;
  }>;
  canWrite: boolean;
};
export function ConstructionFinance({
  id,
  progress,
}: {
  id: string;
  progress: number;
}) {
  const o = useOperations<Data>(`/api/operations/construction?id=${id}`);
  const d = o.data;
  const [link, setLink] = useState(false);
  const [workKey, setWorkKey] = useState("");
  const [estimate, setEstimate] = useState(false);
  const [edit, setEdit] = useState<Partial<Commitment> | null>(null);
  const [supplier, setSupplier] = useState("");
  const [stage, setStage] = useState("");
  const [stageDialog, setStageDialog] = useState(false);
  const remaining = d?.estimate
    ? Number(d.estimate.remaining_uncommitted)
    : null;
  const budget = constructionBudget(
    d?.entries || [],
    d?.commitments || [],
    d?.reconciliations || [],
    remaining,
  );
  const { paid, committed, total } = budget;
  const stageName = (e: CashEntry) =>
    d?.stages.find(
      (s) =>
        s.id ===
        d.mappings.find((m) => m.source_category === e.source_category)
          ?.macro_stage_id,
    )?.name ||
    e.stage_name ||
    "Não classificada";
  const rawRows = [
    ...(d?.entries || [])
      .filter((e) => e.kind === "paid" || e.kind === "payable")
      .map((e) => ({
        id: e.id,
        supplier: e.counterparty || "Sem fornecedor",
        stage: stageName(e),
        description: e.description,
        date: e.cash_date,
        amount: Number(e.amount),
        kind: e.kind === "paid" ? "Pago no Qlik" : "A pagar no Qlik",
        commitment: null as Commitment | null,
      })),
    ...(d?.commitments || [])
      .filter((c) => budget.independent.some((b) => b.id === c.id))
      .map((c) => ({
        id: c.id,
        supplier: c.supplier,
        stage:
          d?.stages.find((s) => s.id === c.macro_stage_id)?.name ||
          "Não classificada",
        description: c.description,
        date: c.due_date,
        amount: Number(c.amount),
        kind: c.status === "paid" ? "Pagamento informado" : "Compromisso",
        commitment: c,
      })),
  ];
  const visible = rawRows.filter(
    (r) =>
      (!supplier || r.supplier === supplier) && (!stage || r.stage === stage),
  );
  async function saveCommitment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (
      await o.save("/api/operations/construction", {
        action: "commitment",
        id,
        ...(edit?.id ? { commitment_id: edit.id } : {}),
        macro_stage_id: String(f.get("macro_stage_id") || "") || null,
        supplier: f.get("supplier"),
        description: f.get("description"),
        due_date: f.get("due_date"),
        amount: Number(f.get("amount")),
        status: f.get("status"),
        payment_request_id: String(f.get("payment_request_id") || "") || null,
        cash_entry_id: String(f.get("cash_entry_id") || "") || null,
      })
    )
      setEdit(null);
  }
  return (
    <section className="ops-panel">
      <div className="ops-inline">
        <div>
          <h2>Obra conectada ao orçamento</h2>
          <p className="ops-subtle">
            Realizado, compromissos e custo estimado para concluir, vinculados à
            empresa e à obra do Qlik.
          </p>
        </div>
        {d?.canWrite ? (
          <Button
            variant="secondary"
            onClick={() => {
              setWorkKey(d.work.qlik_work_key || "");
              setLink(true);
            }}
          >
            Vincular empresa e obra
          </Button>
        ) : null}
      </div>
      <OperationsDataStatus sources={["paid", "payable", "catalog"]} />
      <OperationsError message={o.error} />
      {d?.work.qlik_work_key ? (
        <>
          <div className="ops-kpis">
            <div className="ops-kpi">
              <span>Avanço físico</span>
              <strong>{progress.toFixed(1)}%</strong>
              <small>
                Avanço financeiro:{" "}
                {d.work.planned_budget
                  ? ((paid / Number(d.work.planned_budget)) * 100).toFixed(1) +
                    "%"
                  : "Orçamento a informar"}
              </small>
            </div>
            <div className="ops-kpi">
              <span>Gasto realizado</span>
              <strong>{money(paid)}</strong>
            </div>
            <div className="ops-kpi">
              <span>Comprometido a pagar</span>
              <strong>{money(committed)}</strong>
              <small>Qlik + compromissos sem título vinculado</small>
            </div>
            <div className="ops-kpi">
              <span>Custo estimado final</span>
              <strong>{money(total)}</strong>
              <small>
                Desvio:{" "}
                {total === null
                  ? "Estimativa pendente"
                  : money(total - Number(d.work.planned_budget))}
              </small>
            </div>
          </div>
          <p className="ops-subtle">
            Estimativa adicional para concluir: {money(remaining)}. Deve excluir
            o que já está pago ou comprometido.
          </p>
          {d.canWrite ? (
            <div className="ops-actions">
              <Button variant="secondary" onClick={() => setStageDialog(true)}>
                Orçamento e classificação por etapa
              </Button>
              <Button onClick={() => setEdit({ status: "committed" })}>
                Novo compromisso
              </Button>
              <Button variant="secondary" onClick={() => setEstimate(true)}>
                Atualizar estimativa restante
              </Button>
            </div>
          ) : null}
          <div className="ops-filters">
            <select
              aria-label="Fornecedor"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            >
              <option value="">Todos os fornecedores</option>
              {[...new Set(rawRows.map((r) => r.supplier))].sort().map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select
              aria-label="Etapa"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
            >
              <option value="">Todas as etapas</option>
              {[...new Set(rawRows.map((r) => r.stage))].sort().map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Compromisso / lançamento</th>
                  <th>Fornecedor e etapa</th>
                  <th>Data</th>
                  <th>Valor</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.description}
                      <small>{r.kind}</small>
                    </td>
                    <td>
                      {r.supplier}
                      <small>{r.stage}</small>
                    </td>
                    <td>{day(r.date)}</td>
                    <td>{money(r.amount)}</td>
                    <td>
                      {r.commitment && d.canWrite ? (
                        <Button
                          variant="ghost"
                          onClick={() => setEdit(r.commitment!)}
                        >
                          Editar / conciliar
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="ops-notice">
          Vincule esta obra aos identificadores do Qlik para consultar os
          lançamentos e registrar compromissos.
        </div>
      )}
      <Dialog
        open={stageDialog}
        onClose={() => setStageDialog(false)}
        title="Orçamento e custos por etapa"
        wide
      >
        <OperationsError message={o.error} />
        <h3>Orçamento por etapa</h3>
        {d?.stages.map((s) => {
          const b = d.stageBudgets.find((b) => b.macro_stage_id === s.id);
          const rows = rawRows.filter((r) => r.stage === s.name);
          const actual = rows
            .filter(
              (r) =>
                r.kind.includes("Pago") || r.kind === "Pagamento informado",
            )
            .reduce((v, r) => v + r.amount, 0);
          const cost = rows.reduce((v, r) => v + r.amount, 0);
          return (
            <form
              className="ops-panel"
              key={s.id}
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await o.save("/api/operations/construction", {
                  action: "stage_budget",
                  id,
                  macro_stage_id: s.id,
                  planned_budget: Number(f.get("planned")),
                  remaining_uncommitted:
                    f.get("remaining") === ""
                      ? null
                      : Number(f.get("remaining")),
                });
              }}
            >
              <h4>
                {s.name} · avanço físico {Number(s.progress_percent).toFixed(1)}
                %
              </h4>
              <p>
                Realizado {money(actual)} · realizado + comprometido{" "}
                {money(cost)} · desvio estimado{" "}
                {b?.remaining_uncommitted !== null && b
                  ? money(
                      cost +
                        Number(b.remaining_uncommitted) -
                        Number(b.planned_budget),
                    )
                  : "A informar"}
              </p>
              <div className="form-grid">
                <Field label="Orçamento da etapa">
                  <input
                    name="planned"
                    type="number"
                    min="0"
                    step=".01"
                    defaultValue={b?.planned_budget || ""}
                    required
                  />
                </Field>
                <Field label="Custo ainda não contratado">
                  <input
                    name="remaining"
                    type="number"
                    min="0"
                    step=".01"
                    defaultValue={b?.remaining_uncommitted ?? ""}
                  />
                </Field>
                <Button loading={o.saving}>Salvar etapa</Button>
              </div>
            </form>
          );
        })}
        <h3>Classificar categorias do Qlik</h3>
        <p className="ops-subtle">
          Vincule cada categoria de custo à etapa correspondente nesta obra.
        </p>
        {[
          ...new Set(
            d?.entries
              .map((e) => e.source_category)
              .filter((s): s is string => !!s),
          ),
        ]
          .sort()
          .map((category) => (
            <form
              className="ops-inline ops-panel"
              key={category}
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await o.save("/api/operations/construction", {
                  action: "stage_mapping",
                  id,
                  source_category: category,
                  macro_stage_id: f.get("stage"),
                });
              }}
            >
              <span>{category}</span>
              <select
                name="stage"
                aria-label={`Etapa de ${category}`}
                defaultValue={
                  d?.mappings.find((m) => m.source_category === category)
                    ?.macro_stage_id || ""
                }
                required
              >
                <option value="">Selecione a etapa</option>
                {d?.stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <Button loading={o.saving}>Vincular</Button>
            </form>
          ))}
      </Dialog>
      <Dialog
        open={link}
        onClose={() => setLink(false)}
        title="Empresa e obra do Qlik"
      >
        <form
          className="form-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await o.save("/api/operations/construction", {
                action: "link",
                id,
                work_key: workKey || null,
              })
            )
              setLink(false);
          }}
        >
          <QlikWorkSelect value={workKey} onChange={setWorkKey} />
          <p className="ops-subtle">
            O mesmo vínculo será aplicado ao negócio de origem, quando houver.
          </p>
          <Button loading={o.saving}>Salvar vínculo</Button>
        </form>
      </Dialog>
      <Dialog
        open={estimate}
        onClose={() => setEstimate(false)}
        title="Estimativa para concluir"
      >
        <form
          className="form-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (
              await o.save("/api/operations/construction", {
                action: "estimate",
                id,
                remaining_uncommitted: Number(f.get("amount")),
                note: String(f.get("note") || ""),
              })
            )
              setEstimate(false);
          }}
        >
          <Field
            label="Custo ainda não contratado"
            hint="Exclua valores já pagos e compromissos já registrados."
          >
            <input
              name="amount"
              type="number"
              min="0"
              step="0.01"
              defaultValue={d?.estimate?.remaining_uncommitted ?? ""}
              required
            />
          </Field>
          <Field label="Premissas da estimativa">
            <textarea
              name="note"
              defaultValue={d?.estimate?.note || ""}
              maxLength={3000}
            />
          </Field>
          <Button loading={o.saving}>Salvar estimativa</Button>
        </form>
      </Dialog>
      <Dialog
        open={!!edit}
        onClose={() => setEdit(null)}
        title="Compromisso da obra"
        wide
      >
        <form className="form-grid" onSubmit={saveCommitment}>
          <Field label="Fornecedor">
            <input
              name="supplier"
              defaultValue={edit?.supplier || ""}
              required
              maxLength={300}
            />
          </Field>
          <Field label="Etapa">
            <select
              name="macro_stage_id"
              defaultValue={edit?.macro_stage_id || ""}
            >
              <option value="">Não classificada</option>
              {d?.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Descrição" className="form-span-2">
            <input
              name="description"
              defaultValue={edit?.description || ""}
              required
              maxLength={1000}
            />
          </Field>
          <Field label="Data esperada de pagamento">
            <input
              name="due_date"
              type="date"
              defaultValue={edit?.due_date || ""}
              required
            />
          </Field>
          <Field label="Valor">
            <input
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              defaultValue={edit?.amount || ""}
              required
            />
          </Field>
          <Field label="Status">
            <select name="status" defaultValue={edit?.status || "committed"}>
              <option value="committed">Comprometido</option>
              <option value="paid">Pago informado</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </Field>
          <Field label="Solicitação já registrada">
            <select
              name="payment_request_id"
              defaultValue={edit?.payment_request_id || ""}
            >
              <option value="">Sem solicitação vinculada</option>
              {d?.payments.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} · {money(p.amount)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Título já registrado no Qlik" className="form-span-2">
            <select
              name="cash_entry_id"
              defaultValue={edit?.cash_entry_id || ""}
            >
              <option value="">Ainda não registrado no Qlik</option>
              {d?.entries
                .filter((e) => e.kind === "paid" || e.kind === "payable")
                .map((e) => (
                  <option value={e.id} key={e.id}>
                    {e.description || e.counterparty} · {day(e.cash_date)} ·{" "}
                    {money(e.amount)}
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
            <Button loading={o.saving}>Salvar compromisso</Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
