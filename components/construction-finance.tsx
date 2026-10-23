"use client";
import { paymentFetch } from "@/lib/payment-client";
import { useState } from "react";
import Link from "next/link";
import { Button, Dialog } from "./ui";
import { QlikWorkCodes } from "./qlik-work-select";
import {
  useOperations,
  OperationsError,
  money,
  day,
} from "./operations-common";
import {
  monthlyExpensesCsv,
  inheritedLinkMatches,
  type FinanceSources,
  type MonthlyFinance,
} from "@/lib/construction-finance";
export type ConstructionFinanceData = {
  work: {
    id: string;
    name: string;
    source_business_id: string | null;
    qlik_work_key: string | null;
    updated_at: string;
  };
  workKeys: string[];
  linkedWorks: Array<{
    key: string;
    name: string;
    company_id: string;
    active: boolean;
    qlik_companies: { name: string } | null;
  }>;
  monthly: MonthlyFinance;
  sources: FinanceSources;
  checkedAt: string;
  syncActive: boolean;
  commitments: Array<{
    id: string;
    description: string;
    supplier: string;
    due_date: string;
    amount: number;
    status: string;
  }>;
  estimate: { remaining_uncommitted: number; note: string } | null;
  stageBudgets: Array<{
    macro_stage_id: string;
    planned_budget: number;
    remaining_uncommitted: number | null;
  }>;
  stages: Array<{ id: string; name: string }>;
  canWrite: boolean;
  canSync?: boolean;
};
const timestamp = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("pt-BR", { timeZone: "UTC" }) + " UTC"
    : "Carga ainda não publicada";
const amount = (value: number | null) =>
  value === null ? "Sem registros" : money(value);
const monthLabel = (value: string | null) =>
  value ? `${value.slice(5, 7)}/${value.slice(0, 4)}` : "Sem data na origem";

export function ConstructionFinance({
  id,
  progress,
}: {
  id: string;
  progress: number;
}) {
  const o = useOperations<ConstructionFinanceData>(
    `/api/operations/construction?id=${id}`,
  );
  // Never display/export an old construction or stale successful response as current after a failed reload.
  const d = !o.error && !o.loading && o.data?.work.id === id ? o.data : null;
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");
  const [syncError, setSyncError] = useState("");
  const [link, setLink] = useState(false);
  const [codes, setCodes] = useState("");
  const [keys, setKeys] = useState<string[]>([]);
  const [valid, setValid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [year, setYear] = useState("");
  const inherited = Boolean(d?.work.source_business_id);
  const missingInherited = inherited && !d?.work.qlik_work_key;
  const inheritanceMatches = !inherited || inheritedLinkMatches(d!.work.qlik_work_key, keys);
  const sourceHref = d?.work.source_business_id
    ? `/novos-negocios/origem/${encodeURIComponent(d.work.source_business_id)}`
    : null;
  const canSaveLink = valid && !saving && !missingInherited && inheritanceMatches;
  const rows =
    d?.monthly.rows.filter((r) => !year || r.month?.startsWith(year)) || [];
  const unit = (key: string) => {
    const w = d?.linkedWorks.find((w) => w.key === key);
    return w
      ? `${key} · ${w.name} · ${w.qlik_companies?.name || w.company_id}${w.active ? "" : " (inativa no catálogo)"}`
      : `${key} · indisponível no catálogo`;
  };
  function exportCsv() {
    if (!d || !rows.length) return;
    const blob = new Blob(
      [monthlyExpensesCsv(d.work.name, d.workKeys.map(unit), rows, d.sources)],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `gastos-qlik-${id}-${year || "todos"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="ops-panel">
      <div className="ops-inline">
        <div>
          <h2>Gastos mensais · Qlik</h2>
          <p className="ops-subtle">
            Somente tag Reformas ou agrupador 9.118 e seus subcódigos. Pagamentos por mês de pagamento e contas a pagar
            por mês de vencimento.
          </p>
        </div>
        <div className="ops-actions">
          <Button
            variant="secondary"
            loading={o.loading}
            onClick={() => void o.reload()}
          >
            Recarregar dados
          </Button>
          {d?.canSync ? <Button variant="secondary" loading={syncing} onClick={async () => {
            setSyncing(true); setSyncError(""); setSyncNotice("");
            try {
              await paymentFetch("/api/operations/construction/refresh", { method: "POST" });
              setSyncNotice("Sincronização Qlik iniciada. Aguarde a publicação e recarregue os dados.");
              await o.reload();
            } catch (error) { setSyncError(error instanceof Error ? error.message : "Falha ao iniciar sincronização."); }
            finally { setSyncing(false); }
          }}>Sincronizar Qlik</Button> : null}
          {d?.canWrite ? (
            <Button
              variant="secondary"
              onClick={() => {
                setCodes(d.workKeys.join("\n"));
                setKeys(d.workKeys);
                setValid(false);
                setLinkError("");
                setLink(true);
              }}
            >
              Vincular empresa e obra
            </Button>
          ) : null}
        </div>
      </div>
      <OperationsError message={o.error || syncError} />
      {syncNotice ? <p role="status">{syncNotice}</p> : null}
      {o.loading ? <p role="status">Carregando gastos sincronizados…</p> : null}
      {d ? (
        <>
          <p className="ops-subtle">
            Fonte: Qlik · qlik-operations. Consulta: {timestamp(d.checkedAt)}.
            Avanço físico: {progress.toFixed(1)}%.
          </p>
          <div className="ops-notice" role="status">
            <div>
              Pagamentos publicados: {timestamp(d.sources.paid.at)}. Contas a
              pagar publicadas: {timestamp(d.sources.payable.at)}.
            </div>
            {(["paid", "payable"] as const).map((kind) => {
              const source = d.sources[kind],
                label = kind === "paid" ? "pagamentos" : "contas a pagar";
              const stale =
                source.at &&
                Date.parse(d.checkedAt) - Date.parse(source.at) > 36 * 3600000;
              return (
                <div key={kind}>
                  {source.status === "error"
                    ? `A última carga de ${label} falhou; exibimos a publicação anterior. `
                    : source.status !== "success"
                      ? `Atualização de ${label} pendente ou em andamento. `
                      : ""}
                  {stale
                    ? `A publicação de ${label} tem mais de 36 horas.`
                    : ""}
                </div>
              );
            })}
            {!d.syncActive ? (
              <div>Sincronização automática pausada.</div>
            ) : null}
          </div>
          {!d.workKeys.length ? (
            <div className="ops-notice">
              {missingInherited ? <>O negócio de origem ainda não tem vínculo principal.
                Defina-o em <Link href={sourceHref!}>Novos Negócios — abrir origem</Link> e recarregue esta obra.</>
                : <>Vínculo pendente. Preencha o código Qlik em “Vincular empresa e obra”.</>}
              {" "}Nenhuma unidade foi escolhida automaticamente.
            </div>
          ) : (
            <>
              <div>
                <strong>Unidades vinculadas</strong>
                {d.workKeys.map((key) => (
                  <p key={key}>{unit(key)}</p>
                ))}
              </div>
              <div className="ops-kpis">
                <div className="ops-kpi">
                  <span>Pagamentos realizados · Qlik</span>
                  <strong>{amount(d.monthly.paid)}</strong>
                  <small>
                    Todos os períodos disponíveis; somente pagamentos.
                  </small>
                </div>
                <div className="ops-kpi">
                  <span>Contas a pagar · Qlik</span>
                  <strong>{amount(d.monthly.payable)}</strong>
                  <small>
                    Obrigações em aberto; não são gastos realizados.
                  </small>
                </div>
              </div>
              {d.monthly.missingPaidKeys.length ||
              d.monthly.missingPayableKeys.length ? (
                <div className="ops-notice">
                  {d.monthly.missingPaidKeys.length ? (
                    <p>
                      Sem pagamentos disponíveis:{" "}
                      {d.monthly.missingPaidKeys.join(", ")}.
                    </p>
                  ) : null}
                  {d.monthly.missingPayableKeys.length ? (
                    <p>
                      Sem contas a pagar disponíveis:{" "}
                      {d.monthly.missingPayableKeys.join(", ")}.
                    </p>
                  ) : null}
                  Os totais abrangem apenas registros encontrados. Ausência de
                  registros não confirma saldo zero.
                </div>
              ) : null}
              <div className="ops-inline">
                <label>
                  Período{" "}
                  <select
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                  >
                    <option value="">Todos os períodos</option>
                    {[
                      ...new Set(
                        d.monthly.rows.flatMap((r) =>
                          r.month ? [r.month.slice(0, 4)] : [],
                        ),
                      ),
                    ].map((y) => (
                      <option key={y}>{y}</option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="secondary"
                  disabled={!rows.length}
                  onClick={exportCsv}
                >
                  Exportar planilha mensal (CSV)
                </Button>
              </div>
              {rows.length ? (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <caption>
                      Fonte: Qlik / qlik-operations. Valores dos registros
                      sincronizados; “Sem registros” não significa zero. Meses
                      sem movimentos não são preenchidos com zero.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Mês</th>
                        <th scope="col">Pagamentos realizados</th>
                        <th scope="col">Contas a pagar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.month || "undated"}>
                          <th scope="row">{monthLabel(r.month)}</th>
                          <td>
                            {amount(r.paid)}
                            <small>{r.paidCount} registros</small>
                          </td>
                          <td>
                            {amount(r.payable)}
                            <small>{r.payableCount} registros</small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="ops-notice">
                  Nenhum lançamento disponível neste período para as unidades
                  vinculadas. Isso não confirma gasto zero.
                </div>
              )}
            </>
          )}
          <details className="ops-panel">
            <summary>
              Histórico manual legado · compromissos e estimativas
            </summary>
            <p>
              Somente consulta. Estes valores não entram nos totais nem na
              planilha Qlik.
            </p>
            {d.commitments.length ? (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Descrição / fornecedor</th>
                      <th>Data informada</th>
                      <th>Valor manual</th>
                      <th>Status legado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.commitments.map((c) => (
                      <tr key={c.id}>
                        <td>
                          {c.description}
                          <small>{c.supplier}</small>
                        </td>
                        <td>{day(c.due_date)}</td>
                        <td>{money(c.amount)}</td>
                        <td>
                          {c.status === "paid"
                            ? "Pago informado manualmente"
                            : c.status === "cancelled"
                              ? "Cancelado"
                              : "Compromisso informado"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>Sem compromissos manuais legados.</p>
            )}
            {d.estimate ? (
              <p>
                Estimativa manual restante:{" "}
                {money(d.estimate.remaining_uncommitted)}. {d.estimate.note}
              </p>
            ) : null}
            {d.stageBudgets.map((b) => (
              <p key={b.macro_stage_id}>
                {d.stages.find((s) => s.id === b.macro_stage_id)?.name ||
                  "Etapa"}
                : orçamento manual {money(b.planned_budget)}; estimativa
                restante {money(b.remaining_uncommitted)}.
              </p>
            ))}
          </details>
        </>
      ) : null}
      <Dialog
        open={link}
        onClose={() => setLink(false)}
        title="Vincular empresa e obra por código"
      >
        {link && d ? (
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!canSaveLink) return;
              setSaving(true);
              setLinkError("");
              try {
                await paymentFetch("/api/operations/construction", {
                  method: "POST",
                  body: JSON.stringify({
                    action: "link",
                    id,
                    work_keys: keys,
                    expected_updated_at: d.work.updated_at,
                    confirmed: true,
                  }),
                });
                setLink(false);
                await o.reload();
              } catch (error) {
                setLinkError(
                  error instanceof Error
                    ? error.message
                    : "Não foi possível salvar o vínculo.",
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            <OperationsError message={linkError} />
            {sourceHref ? <div className="form-span-2 ops-notice">
              {missingInherited
                ? "O negócio de origem ainda não tem vínculo principal. Defina esse vínculo antes de adicionar unidades a esta obra."
                : `O primeiro código (${d.work.qlik_work_key}) é herdado e deve permanecer como principal. Edite abaixo somente as unidades adicionais.`}
              {" "}<Link href={sourceHref}>Abrir negócio de origem</Link>.
              {" "}Depois de alterar a origem, recarregue esta obra e revise as unidades adicionais.
            </div> : null}
            {!missingInherited ? <QlikWorkCodes
              id={id}
              value={codes}
              onChange={(text, nextKeys, ok) => {
                setCodes(text);
                setKeys(nextKeys);
                setValid(ok);
              }}
            /> : null}
            <p className="form-span-2 ops-subtle">
              Confira empresa, nome, etapa e código antes de salvar. Um código reconhecido no catálogo não confirma a etapa desta obra. O primeiro código
              é o vínculo principal; os demais adicionam unidades apenas a esta
              obra. Limpar o campo remove o vínculo de obras sem negócio de
              origem.
            </p>
            {inherited && !missingInherited && !inheritanceMatches ? (
              <p className="form-span-2 ops-notice" role="alert">
                Mantenha {d.work.qlik_work_key} como primeiro código. Para mudar o vínculo principal, abra o negócio de origem.
              </p>
            ) : null}
            <Button type="submit" loading={saving} disabled={!canSaveLink}>
              Salvar vínculo
            </Button>
          </form>
        ) : null}
      </Dialog>
    </section>
  );
}
