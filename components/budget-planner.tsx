"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  CalendarRange,
  Copy,
  Download,
  Plus,
  Save,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { Button, Field } from "./ui";
import { getSupabase } from "@/lib/supabase";
import { paymentFetch } from "@/lib/payment-client";
import { currency, todayIso } from "@/lib/format";
import {
  addMonths,
  annualColumns,
  calculateBudget,
  monthNumber,
  newBudgetPlan,
  placeBusiness,
  planMonths,
  sourceKey,
  type BudgetAccount,
  type BudgetBusiness,
  type BudgetColumn,
  type BudgetPlan,
  type BudgetSources,
} from "@/lib/budget-planner";
import { budgetSchema } from "@/lib/budget-schema";
import "./budget-planner.css";
const monthLabel = (month: string) =>
  month.length === 4
    ? month
    : new Date(`${month}-02T12:00:00`).toLocaleDateString("pt-BR", {
        month: "short",
        year: "2-digit",
      });
const emptySource: BudgetSources = {
  rows: [],
  coverage: [],
  companies: [],
  overdue_receivables: 0,
};
export function BudgetPlanner() {
  const router = useRouter(),
    currentMonth = todayIso().slice(0, 7),
    currentYear = Number(currentMonth.slice(0, 4));
  const [plan, setPlan] = useState<BudgetPlan>(() =>
    newBudgetPlan(currentYear, currentMonth),
  );
  const [plans, setPlans] = useState<BudgetPlan[]>([]),
    [businesses, setBusinesses] = useState<BudgetBusiness[]>([]),
    [source, setSource] = useState<BudgetSources>(emptySource);
  const [loading, setLoading] = useState(true),
    [canWrite, setCanWrite] = useState(false),
    [saving, setSaving] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [mode, setMode] = useState<"budget" | "actual" | "forecast">(
      "forecast",
    ),
    [period, setPeriod] = useState<"year" | "month">("year"),
    [year, setYear] = useState(currentYear),
    [selectedBusiness, setSelectedBusiness] = useState("");
  const [lineType, setLineType] = useState<"budget" | "adjustment">("budget");
  const months = useMemo(() => planMonths(plan.start_year), [plan.start_year]);
  const load = useCallback(async (startYear: number, selected?: BudgetPlan) => {
    setLoading(true);
    setError("");
    try {
      const result = await paymentFetch(`/api/budget?year=${startYear}`);
      setPlans(result.plans);
      setBusinesses(result.businesses);
      setCanWrite(result.canWrite);
      const next = selected ||
        result.plans[0] || {
          ...newBudgetPlan(startYear, todayIso().slice(0, 7)),
          company_id: result.source.companies[0]?.id || null,
          baseline_receipts: result.source.rows.filter(
            (r: { kind: string }) => r.kind === "receivable",
          ),
        };
      if (next.start_year !== startYear) {
        const matching = await paymentFetch(
          `/api/budget?year=${next.start_year}`,
        );
        setSource(matching.source);
      } else setSource(result.source);
      if (!next.id)
        next.baseline_receipts = result.source.rows.filter(
          (r: { kind: string }) => r.kind === "receivable",
        );
      setPlan(next);
      setYear(next.start_year);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const db = getSupabase();
    if (!db) {
      const timer = window.setTimeout(() => {
        setError("Conexão indisponível. Configure o acesso ao sistema.");
        setLoading(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    let active = true;
    db.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (!data.session) router.replace("/login?next=/planejador-orcamentario");
      else void load(currentYear);
    });
    const { data } = db.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setLoading(true);
        setCanWrite(false);
        setSource(emptySource);
        setPlans([]);
        router.replace("/login?next=/planejador-orcamentario");
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [router, load, currentYear]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const update = (next: BudgetPlan) => {
    if (
      next.adjustments !== plan.adjustments ||
      next.mappings !== plan.mappings
    )
      next.reconciled_months = [];
    setPlan(next);
    setDirty(true);
    setMessage("");
  };
  const monthly = useMemo(
    () => calculateBudget(plan, businesses, source, mode),
    [plan, businesses, source, mode],
  );
  const comparison = useMemo(
    () => calculateBudget(plan, businesses, source, "budget"),
    [plan, businesses, source],
  );
  const columns =
    period === "year"
      ? annualColumns(monthly)
      : monthly.filter((m) => m.month.startsWith(String(year)));
  const totals = annualColumns(monthly);
  const activeMonths = monthly.filter((m) => m.active);
  const complete =
      activeMonths.length > 0 && activeMonths.every((m) => m.complete),
    resultTotal = monthly.reduce((n, m) => n + m.result, 0),
    investmentTotal = monthly.reduce((n, m) => n + m.investment, 0);
  const categories = Array.from(
    new Set(
      source.rows
        .filter((r) => !plan.company_id || r.company_id === plan.company_id)
        .map(sourceKey),
    ),
  ).sort();
  const unclassified = source.rows
    .filter(
      (r) =>
        r.kind === "paid" &&
        (!plan.company_id || r.company_id === plan.company_id) &&
        !plan.mappings[sourceKey(r)],
    )
    .reduce((n, r) => n + r.amount, 0);
  const missingActual = ["received", "paid"].filter(
    (kind) =>
      !source.coverage.some(
        (c) =>
          c.kind === kind &&
          c.count > 0 &&
          (!plan.company_id || c.company_id === plan.company_id),
      ),
  );
  async function save() {
    setError("");
    setSaving(true);
    try {
      const parsed = budgetSchema.safeParse(plan);
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      const saved = await paymentFetch("/api/budget/plans", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      setPlan(saved);
      setPlans((p) => [saved, ...p.filter((v) => v.id !== saved.id)]);
      setDirty(false);
      setMessage("Cenário salvo.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function addWork() {
    const b = businesses.find((b) => b.id === selectedBusiness);
    if (!b) return;
    if (!b.curve.length) {
      setError(
        "Cadastre primeiro a curva mensal deste negócio em Novos Negócios.",
      );
      return;
    }
    const start = months.find((m) => m > plan.closed_through) || months[0];
    update({
      ...plan,
      works: [
        ...plan.works,
        {
          business_id: b.id,
          business_name: b.name,
          linked: !!b.qlik_work_key,
          start,
          end: addMonths(
            start,
            Math.max(
              1,
              ...b.curve.filter((r) => r.investment > 0).map((r) => r.month),
            ) - 1,
          ),
          enabled: true,
          incremental: false,
          curve: b.curve,
        },
      ],
    });
    setSelectedBusiness("");
  }
  function shiftWork(id: string, start: string) {
    update({
      ...plan,
      works: plan.works.map((w) =>
        w.business_id === id
          ? {
              ...w,
              start,
              end: addMonths(start, monthNumber(w.end) - monthNumber(w.start)),
            }
          : w,
      ),
    });
  }
  function addLine(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    const entry = {
      id: crypto.randomUUID(),
      account_id: String(data.get("account")),
      month: String(data.get("month")),
      cash_month: String(data.get("cash_month") || data.get("month")),
      amount: Number(data.get("amount")),
      justification: String(data.get("justification")),
    };
    const repeatUntil = String(data.get("repeat_until") || entry.month);
    const count =
      lineType === "budget"
        ? monthNumber(repeatUntil) - monthNumber(entry.month) + 1
        : 1;
    if (count < 1 || count > 60) {
      setError("A repetição deve ficar entre 1 e 60 meses.");
      return;
    }
    const entries = Array.from({ length: count }, (_, i) => ({
      ...entry,
      id: crypto.randomUUID(),
      month: addMonths(entry.month, i),
      cash_month: addMonths(entry.cash_month, i),
    }));
    const next =
      lineType === "adjustment"
        ? { ...plan, adjustments: [...plan.adjustments, entry] }
        : { ...plan, lines: [...plan.lines, ...entries] };
    const parsed = budgetSchema.safeParse(next);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    update(parsed.data);
    form.reset();
    setError("");
  }
  function exportCsv() {
    const rows = [
      [
        "Período",
        "Entradas gerenciais",
        "Saídas operacionais",
        "Resultado gerencial",
        "Ajuste para caixa",
        "Transferências e aportes líquidos",
        "Investimentos",
        "Geração de caixa",
        "Saldo final",
        "Status",
      ],
      ...monthly.map((m) => [
        m.month,
        m.complete ? m.income : "",
        m.active ? m.expense : "",
        m.complete ? m.result : "",
        m.complete ? m.bridge : "",
        m.complete ? m.transfers : "",
        m.active ? m.investment : "",
        m.complete ? m.cashResult : "",
        m.closing ?? "",
        !m.active
          ? "Período aberto"
          : !m.complete
            ? "Dados incompletos"
            : !m.reconciled
              ? "Competência a conciliar"
              : m.actual
                ? "Realizado"
                : "Orçado",
      ]),
    ];
    const blob = new Blob(
      [
        "\uFEFF" +
          rows
            .map((row) =>
              row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(";"),
            )
            .join("\r\n"),
      ],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orcamento-${plan.start_year}-${mode}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function cellValue(
    c: BudgetColumn,
    value: number | null,
    requiresComplete = true,
  ) {
    return !c.active || value === null || (requiresComplete && !c.complete)
      ? "—"
      : currency(value);
  }
  const accountRows = (group: BudgetAccount["group"]) =>
    plan.accounts
      .filter((a) => a.group === group)
      .map((a) => (
        <tr key={a.id} className="bp-account">
          <th scope="row">{a.name}</th>
          {columns.map((c) => (
            <td key={c.month}>
              {cellValue(c, c.accounts[a.id] || 0, group === "income")}
            </td>
          ))}
        </tr>
      ));
  const row = (
    label: string,
    key:
      | "income"
      | "expense"
      | "result"
      | "bridge"
      | "investment"
      | "cashResult"
      | "opening"
      | "closing"
      | "transfers",
    strong = false,
  ) => (
    <tr className={strong ? "bp-total" : "bp-group"}>
      <th scope="row">{label}</th>
      {columns.map((c) => (
        <td
          className={c[key] !== null && c[key]! < 0 ? "bp-negative" : ""}
          key={c.month}
        >
          {cellValue(c, c[key], key !== "expense" && key !== "investment")}
        </td>
      ))}
    </tr>
  );
  if (loading)
    return (
      <main className="bp-page">
        <p role="status">Carregando o planejador e os dados financeiros…</p>
      </main>
    );
  if (!canWrite && !plans.length && !source.coverage.length && error)
    return (
      <main className="bp-page">
        <h1>Planejador orçamentário</h1>
        <p role="alert">{error}</p>
        <Button onClick={() => void load(currentYear)}>Tentar novamente</Button>
      </main>
    );
  return (
    <main className="bp-page">
      <header className="bp-header">
        <div className="bp-brand">
          <Image
            src="/logo-terra-lotus.png"
            width={146}
            height={54}
            alt="Terra Lótus"
          />
          <span>
            PLANEJAMENTO FINANCEIRO
            <br />
            <strong>Horizonte de cinco anos</strong>
          </span>
        </div>
        <div className="bp-actions">
          <span className="bp-save-state">
            {dirty
              ? "Alterações não salvas"
              : plan.id
                ? "Cenário salvo"
                : "Novo cenário"}
          </span>
          <Button variant="secondary" onClick={exportCsv}>
            <Download size={16} /> Exportar
          </Button>
          <Button
            disabled={!canWrite || saving}
            onClick={save}
            loading={saving}
          >
            <Save size={16} /> Salvar cenário
          </Button>
        </div>
      </header>
      <div className="bp-title">
        <div>
          <span className="bp-eyebrow">
            ORÇAMENTO BASE ZERO · {plan.start_year}—{plan.start_year + 4}
          </span>
          <h1>
            Planejar hoje.
            <br />
            <span>Enxergar os próximos passos.</span>
          </h1>
          <p>
            Carteira atual, novas obras e despesas em uma visão de resultado e
            caixa.
          </p>
        </div>
        <div className="bp-scenario">
          <Field label="Empresa do cenário">
            <select
              aria-label="Empresa do cenário"
              value={plan.company_id || ""}
              disabled={
                !canWrite ||
                !!plan.id ||
                !!plan.lines.length ||
                !!plan.works.length ||
                !!plan.adjustments.length
              }
              onChange={(e) =>
                update({
                  ...plan,
                  company_id: e.target.value || null,
                  opening_cash: null,
                })
              }
            >
              <option value="">Consolidado · todas as empresas</option>
              {source.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cenário">
            <select
              aria-label="Cenário"
              value={plan.id || ""}
              onChange={(e) => {
                const p = plans.find((p) => p.id === e.target.value);
                if (
                  p &&
                  (!dirty ||
                    window.confirm(
                      "Descartar alterações não salvas e abrir outro cenário?",
                    ))
                )
                  void load(p.start_year, p);
              }}
            >
              <option value="">Novo cenário</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="bp-actions">
            <Button
              variant="ghost"
              disabled={!canWrite}
              onClick={() => {
                const next = {
                  ...plan,
                  id: undefined,
                  version: 0,
                  name: `${plan.name} · cópia`,
                };
                update(next);
              }}
            >
              <Copy size={15} /> Duplicar
            </Button>
            <Button
              variant="ghost"
              disabled={!canWrite}
              onClick={() => {
                if (
                  dirty &&
                  !window.confirm(
                    "Descartar alterações e criar um orçamento do zero?",
                  )
                )
                  return;
                update({
                  ...newBudgetPlan(plan.start_year, currentMonth),
                  company_id: plan.company_id,
                  baseline_receipts: source.rows.filter(
                    (r) => r.kind === "receivable",
                  ),
                });
              }}
            >
              <Plus size={15} /> Base zero
            </Button>
          </div>
        </div>
      </div>
      {error ? (
        <div className="bp-alert" role="alert">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="bp-success" role="status">
          {message}
        </div>
      ) : null}
      <div className="bp-kpis">
        <article>
          <span>
            {mode === "actual"
              ? "Resultado gerencial · meses fechados"
              : "Resultado gerencial · 5 anos"}
          </span>
          <strong>
            {complete ? currency(resultTotal) : "Dados incompletos"}
          </strong>
          <small>
            {mode === "budget"
              ? "Entradas menos saídas operacionais"
              : "Confira a conciliação de competência"}
          </small>
        </article>
        <article>
          <span>Investimentos em obras</span>
          <strong>{currency(investmentTotal)}</strong>
          <small>Desembolso separado do resultado operacional</small>
        </article>
        <article>
          <span>Caixa ao final do período</span>
          <strong>
            {activeMonths.at(-1)?.closing == null
              ? "A apurar"
              : currency(monthly.at(-1)?.closing || 0)}
          </strong>
          <small>
            {plan.opening_cash === null
              ? "Informe o saldo inicial de caixa"
              : "Saldo inicial + geração acumulada"}
          </small>
        </article>
      </div>
      <section className="bp-panel">
        <div className="bp-section-head">
          <div>
            <span className="bp-eyebrow">DRE GERENCIAL E FLUXO DE CAIXA</span>
            <h2>O resultado, mês a mês.</h2>
          </div>
          <div className="bp-actions">
            <div className="bp-segment" aria-label="Visão financeira">
              {(
                [
                  ["budget", "Orçado"],
                  ["actual", "Realizado"],
                  ["forecast", "Projeção"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="bp-segment" aria-label="Agrupamento">
              {(
                [
                  ["year", "Ano"],
                  ["month", "Mês"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={period === value}
                  onClick={() => setPeriod(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {period === "month" ? (
              <select
                aria-label="Ano exibido"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              >
                {totals.map((t) => (
                  <option key={t.month}>{t.month}</option>
                ))}
              </select>
            ) : null}
          </div>
        </div>
        <p className="bp-caption">
          {mode === "forecast"
            ? `Realizado até ${monthLabel(plan.closed_through)}; orçamento nos meses seguintes.`
            : mode === "budget"
              ? "Premissas do cenário: carteira capturada, curvas de obras e despesas justificadas."
              : "Pagamentos e recebimentos efetivos do Qlik, com ajustes de competência informados."}
        </p>
        {missingActual.length && mode !== "budget" ? (
          <div className="bp-alert">
            Fonte incompleta:{" "}
            {missingActual
              .map((k) =>
                k === "received"
                  ? "recebimentos realizados"
                  : "pagamentos realizados",
              )
              .join(" e ")}{" "}
            ainda não carregados. Resultados e saldos dependentes ficam sem
            valor.
          </div>
        ) : null}
        {mode !== "budget" ? (
          <p className="bp-caption">
            Nos meses sem conciliação, a competência usa provisoriamente a data
            de caixa. Ajuste e concilie abaixo para validar o resultado
            gerencial.
          </p>
        ) : null}
        <div className="bp-table-scroll">
          <table className="bp-table">
            <caption className="sr-only">
              DRE simplificada com conciliação para caixa, em reais
            </caption>
            <thead>
              <tr>
                <th scope="col">Plano de contas</th>
                {columns.map((c) => (
                  <th scope="col" key={c.month}>
                    {monthLabel(c.month)}
                    <small>
                      {!c.complete
                        ? "Incompleto"
                        : !c.reconciled
                          ? "A conciliar"
                          : c.actual
                            ? "Realizado / orçado"
                            : "Orçado"}
                    </small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {row("(+) Entradas", "income")}
              {accountRows("income")}
              {row("(−) Saídas operacionais", "expense")}
              {accountRows("expense")}
              {row("(=) Resultado gerencial", "result", true)}
              {row("(±) Ajuste de competência para caixa", "bridge")}
              {row("(±) Transferências, aportes e distribuições", "transfers")}
              {row("(−) Investimentos em obras", "investment")}
              {row("(=) Geração de caixa", "cashResult", true)}
              {row("Saldo inicial de caixa", "opening")}
              {row("Saldo final de caixa", "closing", true)}
              {mode !== "budget" ? (
                <tr>
                  <th scope="row">Desvio do resultado vs. orçamento</th>
                  {columns.map((c) => {
                    const base = (
                      period === "year" ? annualColumns(comparison) : comparison
                    ).find((b) => b.month === c.month)!;
                    return (
                      <td key={c.month}>
                        {cellValue(c, c.result - base.result)}
                      </td>
                    );
                  })}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="bp-footnote">
          Resultado gerencial + ajuste de competência + transferências/aportes −
          investimentos = geração de caixa. Valores em R$. O saldo inicial não é
          receita.
        </div>
      </section>
      <section className="bp-panel">
        <div className="bp-section-head">
          <div>
            <span className="bp-eyebrow">SIMULAÇÃO DE OBRAS</span>
            <h2>O tempo também muda o caixa.</h2>
            <p>
              Arraste uma obra para outro mês ou edite início e término. A curva
              de investimento se adapta ao prazo; o VGV começa no mês seguinte à
              conclusão.
            </p>
          </div>
          <CalendarRange size={30} />
        </div>
        <fieldset disabled={!canWrite || saving} className="bp-fieldset">
          <div className="bp-add-work">
            <select
              aria-label="Adicionar negócio ao cenário"
              value={selectedBusiness}
              onChange={(e) => setSelectedBusiness(e.target.value)}
            >
              <option value="">Selecione um negócio</option>
              {businesses
                .filter((b) => !plan.works.some((w) => w.business_id === b.id))
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {!b.curve.length ? " · curva pendente" : ""}
                  </option>
                ))}
            </select>
            <Button
              variant="secondary"
              disabled={!selectedBusiness || !canWrite}
              onClick={addWork}
            >
              <Plus size={16} /> Incluir obra
            </Button>
          </div>
          {!plan.works.length ? (
            <div className="bp-empty">
              <TrendingUp size={26} />
              <strong>Monte seu cenário de crescimento</strong>
              <span>
                Cadastre as curvas mensais em Novos Negócios e inclua as obras
                aqui.
              </span>
            </div>
          ) : (
            plan.works.map((work) => {
              const business = businesses.find(
                (b) => b.id === work.business_id,
              );
              const placed = placeBusiness(work, work.curve);
              const outside = [...placed.investment, ...placed.receipts]
                .filter(
                  (r) =>
                    r.amount && (r.month < months[0] || r.month > months[59]),
                )
                .reduce((n, r) => n + r.amount, 0);
              return (
                <article className="bp-work" key={work.business_id}>
                  <div className="bp-work-head">
                    <label>
                      <input
                        type="checkbox"
                        checked={work.enabled}
                        onChange={(e) =>
                          update({
                            ...plan,
                            works: plan.works.map((w) =>
                              w === work
                                ? { ...w, enabled: e.target.checked }
                                : w,
                            ),
                          })
                        }
                      />{" "}
                      <strong>{business?.name || work.business_name}</strong>
                    </label>
                    <div className="bp-actions">
                      <Button
                        variant="ghost"
                        disabled={!business?.curve.length}
                        onClick={() => {
                          if (business)
                            update({
                              ...plan,
                              works: plan.works.map((w) =>
                                w === work
                                  ? { ...w, curve: business.curve }
                                  : w,
                              ),
                            });
                        }}
                      >
                        Atualizar curva
                      </Button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remover ${business?.name}`}
                        onClick={() =>
                          update({
                            ...plan,
                            works: plan.works.filter((w) => w !== work),
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="bp-work-fields">
                    <Field label="Início">
                      <input
                        type="month"
                        value={work.start}
                        onChange={(e) => {
                          if (e.target.value)
                            shiftWork(work.business_id, e.target.value);
                        }}
                      />
                    </Field>
                    <Field label="Conclusão">
                      <input
                        type="month"
                        value={work.end}
                        min={work.start}
                        max={addMonths(work.start, 119)}
                        onChange={(e) => {
                          if (
                            e.target.value >= work.start &&
                            e.target.value <= addMonths(work.start, 119)
                          )
                            update({
                              ...plan,
                              works: plan.works.map((w) =>
                                w === work ? { ...w, end: e.target.value } : w,
                              ),
                            });
                        }}
                      />
                    </Field>
                    <div>
                      <span>VGV após conclusão</span>
                      <strong>
                        {currency(work.curve.reduce((n, r) => n + r.vgv, 0))}
                      </strong>
                    </div>
                    <div>
                      <span>Investimento total</span>
                      <strong>
                        {currency(
                          work.curve.reduce((n, r) => n + r.investment, 0),
                        )}
                      </strong>
                    </div>
                  </div>
                  {business?.qlik_work_key || work.linked ? (
                    <label className="bp-caption">
                      <input
                        type="checkbox"
                        checked={work.incremental}
                        onChange={(e) =>
                          update({
                            ...plan,
                            works: plan.works.map((w) =>
                              w === work
                                ? { ...w, incremental: e.target.checked }
                                : w,
                            ),
                          })
                        }
                      />{" "}
                      Confirmo que esta curva é adicional à carteira Qlik, sem
                      duplicar recebimentos ou investimentos já orçados. Sem
                      confirmação, esta obra fica fora dos cálculos.
                    </label>
                  ) : null}
                  {outside > 0 ? (
                    <p className="bp-alert">
                      {currency(outside)} da curva ficam fora dos cinco anos e
                      não entram nos totais deste cenário.
                    </p>
                  ) : null}
                  {work.start <= plan.closed_through ? (
                    <p className="bp-caption">
                      A projeção preserva os meses realizados até{" "}
                      {monthLabel(plan.closed_through)}. Alterações só afetam os
                      meses futuros; o orçamento mostra a curva completa.
                    </p>
                  ) : null}
                  <div
                    className="bp-timeline"
                    aria-label={`Cronograma de ${business?.name}`}
                  >
                    {months.map((m) => (
                      <div
                        key={m}
                        className={
                          m >= work.start && m <= work.end
                            ? "bp-month bp-building"
                            : m === addMonths(work.end, 1)
                              ? "bp-month bp-receipt"
                              : "bp-month"
                        }
                        onDragOver={(e) => {
                          if (canWrite) e.preventDefault();
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (
                            canWrite &&
                            e.dataTransfer.getData("text/plain") ===
                              work.business_id
                          )
                            shiftWork(work.business_id, m);
                        }}
                      >
                        <span>{monthLabel(m)}</span>
                        {m >= work.start && m <= work.end ? (
                          <div
                            draggable={canWrite}
                            onDragStart={(e) =>
                              e.dataTransfer.setData(
                                "text/plain",
                                work.business_id,
                              )
                            }
                            title="Arraste para mudar o início"
                          >
                            Obra
                          </div>
                        ) : m === addMonths(work.end, 1) ? (
                          <div>VGV →</div>
                        ) : (
                          <div>·</div>
                        )}
                      </div>
                    ))}
                  </div>
                </article>
              );
            })
          )}
        </fieldset>
      </section>
      <section className="bp-panel">
        <div className="bp-section-head">
          <div>
            <span className="bp-eyebrow">PREMISSAS DO CENÁRIO</span>
            <h2>Cada valor tem uma origem.</h2>
          </div>
        </div>
        <fieldset className="bp-fieldset" disabled={!canWrite || saving}>
          <div className="bp-form-grid">
            <Field label="Nome do cenário">
              <input
                value={plan.name}
                onChange={(e) => update({ ...plan, name: e.target.value })}
              />
            </Field>
            <Field
              label="Primeiro ano"
              hint="Para outro horizonte, crie um cenário vazio."
            >
              <input
                type="number"
                value={plan.start_year}
                disabled={
                  !!plan.id ||
                  !!plan.lines.length ||
                  !!plan.works.length ||
                  !!plan.adjustments.length
                }
                min={2020}
                max={2095}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  if (y >= 2020 && y <= 2095)
                    void load(y, {
                      ...newBudgetPlan(y, currentMonth),
                      name: plan.name,
                    });
                }}
              />
            </Field>
            <Field
              label="Realizado até"
              hint="Meses posteriores usam o orçamento na projeção."
            >
              <input
                type="month"
                value={plan.closed_through}
                max={addMonths(currentMonth, -1)}
                onChange={(e) => {
                  if (e.target.value)
                    update({ ...plan, closed_through: e.target.value });
                }}
              />
            </Field>
            <Field
              label={`Saldo de caixa em 01/01/${plan.start_year}`}
              hint="Em branco: saldo final a apurar."
            >
              <input
                type="number"
                step="0.01"
                value={plan.opening_cash ?? ""}
                onChange={(e) =>
                  update({
                    ...plan,
                    opening_cash:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </Field>
          </div>
          <div className="bp-form-grid">
            {(
              [
                ["income", "Reajuste anual das novas entradas (%)"],
                ["expense", "Reajuste anual das despesas (%)"],
                ["investment", "Reajuste anual das obras (%)"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  type="number"
                  min={-50}
                  max={100}
                  step="0.01"
                  value={plan.annual_rates[key]}
                  onChange={(e) =>
                    update({
                      ...plan,
                      annual_rates: {
                        ...plan.annual_rates,
                        [key]: Number(e.target.value),
                      },
                    })
                  }
                />
              </Field>
            ))}
          </div>
          <p className="bp-caption">
            Valores manuais e curvas são expressos em reais do primeiro ano.
            Reajustes compostos se aplicam a partir do segundo ano. A carteira
            contratada e o realizado preservam seus valores de origem.
          </p>
          <div className="bp-inline-note">
            <p>
              A carteira atual está capturada neste cenário. Contas a pagar não
              preenchem automaticamente despesas: o orçamento parte de zero.
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                update({
                  ...plan,
                  baseline_receipts: source.rows.filter(
                    (r) => r.kind === "receivable",
                  ),
                });
                setMessage(
                  "Carteira do cenário atualizada com os recebíveis carregados nesta sessão. Salve para manter a nova base.",
                );
              }}
            >
              Atualizar carteira do cenário
            </Button>
          </div>
          <details>
            <summary>
              Despesas, outras entradas e ajustes de competência
            </summary>
            <p>
              Ajustes de competência alteram somente o resultado gerencial
              realizado. Ex.: despesa paga em março referente a fevereiro: +100
              em fevereiro e −100 em março, na mesma conta. O caixa permanece
              nos registros do Qlik.
            </p>
            <form className="bp-line-form" onSubmit={addLine}>
              <Field label="Tipo">
                <select
                  value={lineType}
                  onChange={(e) =>
                    setLineType(e.target.value as typeof lineType)
                  }
                >
                  <option value="budget">Valor orçado</option>
                  <option value="adjustment">Ajuste do realizado</option>
                </select>
              </Field>
              <Field label="Plano de contas">
                <select name="account" required>
                  {plan.accounts
                    .filter(
                      (a) =>
                        lineType !== "adjustment" ||
                        ["income", "expense"].includes(a.group),
                    )
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.group === "income"
                          ? "Entrada"
                          : a.group === "expense"
                            ? "Saída"
                            : a.group === "investment"
                              ? "Investimento"
                              : "Movimento de caixa"}{" "}
                        · {a.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Competência">
                <input
                  name="month"
                  type="month"
                  required
                  min={months[0]}
                  max={months[59]}
                  defaultValue={
                    months.find((m) => m > plan.closed_through) || months[0]
                  }
                />
              </Field>
              {lineType === "budget" ? (
                <Field label="Mês do caixa">
                  <input
                    name="cash_month"
                    type="month"
                    required
                    min={months[0]}
                    max={months[59]}
                    defaultValue={
                      months.find((m) => m > plan.closed_through) || months[0]
                    }
                  />
                </Field>
              ) : null}
              {lineType === "budget" ? (
                <Field
                  label="Repetir mensalmente até"
                  hint="Opcional; valores na moeda do primeiro ano."
                >
                  <input
                    name="repeat_until"
                    type="month"
                    min={months[0]}
                    max={months[59]}
                  />
                </Field>
              ) : null}
              <Field label="Valor (R$)">
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  min={lineType === "budget" ? 0 : undefined}
                  required
                />
              </Field>
              <Field label="Justificativa base zero">
                <input
                  name="justification"
                  minLength={3}
                  maxLength={1000}
                  required
                  placeholder="Necessidade e premissa do valor"
                />
              </Field>
              <Button type="submit">
                <Plus size={15} /> Adicionar
              </Button>
            </form>
            <div className="bp-table-scroll">
              <table className="bp-table">
                <thead>
                  <tr>
                    <th>Conta / justificativa</th>
                    <th>Competência</th>
                    <th>Caixa</th>
                    <th>Valor</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...plan.lines.map((l) => ({ ...l, adjustment: false })),
                    ...plan.adjustments.map((l) => ({
                      ...l,
                      cash_month: "",
                      adjustment: true,
                    })),
                  ].map((l) => (
                    <tr key={l.id}>
                      <th>
                        {plan.accounts.find((a) => a.id === l.account_id)?.name}
                        <small>
                          {l.adjustment ? "Ajuste · " : ""}
                          {l.justification}
                        </small>
                      </th>
                      <td>{monthLabel(l.month)}</td>
                      <td>
                        {l.cash_month ? monthLabel(l.cash_month) : "Sem efeito"}
                      </td>
                      <td>{currency(l.amount)}</td>
                      <td>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Remover lançamento ${l.justification}`}
                          onClick={() =>
                            update({
                              ...plan,
                              lines: plan.lines.filter((a) => a.id !== l.id),
                              adjustments: plan.adjustments.filter(
                                (a) => a.id !== l.id,
                              ),
                            })
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <details>
            <summary>Planos de contas e classificação do Qlik</summary>
            <p>
              Classifique as saídas de obras como investimentos para separá-las
              das despesas operacionais. {currency(unclassified)} de pagamentos
              ainda estão em “Saídas a classificar”.
            </p>
            <form
              className="bp-add-work"
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                update({
                  ...plan,
                  accounts: [
                    ...plan.accounts,
                    {
                      id: crypto.randomUUID(),
                      name: String(d.get("name")),
                      group: String(d.get("group")) as BudgetAccount["group"],
                    },
                  ],
                });
                e.currentTarget.reset();
              }}
            >
              <input
                name="name"
                aria-label="Nome do plano de contas"
                placeholder="Nome do novo plano de contas"
                maxLength={100}
                required
              />
              <select name="group" aria-label="Grupo do plano de contas">
                <option value="income">Entradas</option>
                <option value="expense">Saídas</option>
                <option value="investment">Investimentos</option>
                <option value="cash_in">Entradas de caixa sem receita</option>
                <option value="cash_out">Saídas de caixa sem despesa</option>
              </select>
              <Button variant="secondary" type="submit">
                Adicionar conta
              </Button>
            </form>
            <div className="bp-mappings">
              {categories.map((key) => (
                <Field
                  key={key}
                  label={(() => {
                    const r = source.rows.find((r) => sourceKey(r) === key)!;
                    return `${key.startsWith("income:") ? "Entrada" : "Saída"} · ${source.companies.find((c) => c.id === r.company_id)?.name || r.company_id} · ${r.work_key || "Sem obra"} · ${r.category}`;
                  })()}
                >
                  <select
                    value={plan.mappings[key] || ""}
                    onChange={(e) => {
                      const mappings = { ...plan.mappings };
                      if (e.target.value) mappings[key] = e.target.value;
                      else delete mappings[key];
                      update({ ...plan, mappings });
                    }}
                  >
                    <option value="">
                      {key.startsWith("income:")
                        ? "VGV da carteira atual"
                        : "Saídas a classificar"}
                    </option>
                    {plan.accounts
                      .filter((a) =>
                        key.startsWith("income:")
                          ? ["income", "cash_in"].includes(a.group)
                          : ["expense", "investment", "cash_out"].includes(
                              a.group,
                            ),
                      )
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </Field>
              ))}
            </div>
          </details>
          <details>
            <summary>Conciliação entre competência e caixa</summary>
            <p>
              Marque os meses após conferir e lançar todos os ajustes de
              competência. A marcação não modifica os valores importados.
            </p>
            <div className="bp-reconciled">
              {months
                .filter((m) => m <= plan.closed_through)
                .map((m) => (
                  <label key={m}>
                    <input
                      type="checkbox"
                      disabled={missingActual.length > 0}
                      checked={plan.reconciled_months.includes(m)}
                      onChange={(e) =>
                        update({
                          ...plan,
                          reconciled_months: e.target.checked
                            ? [...plan.reconciled_months, m]
                            : plan.reconciled_months.filter((v) => v !== m),
                        })
                      }
                    />{" "}
                    {monthLabel(m)}
                  </label>
                ))}
            </div>
          </details>
        </fieldset>
      </section>
      <footer className="bp-footer">
        <strong>Origem e cobertura dos dados</strong>
        <p>
          Empresas importadas:{" "}
          {source.companies.map((c) => c.name).join(" · ") || "Nenhuma"}.
          Valores anteriores ao horizonte não são distribuídos automaticamente.
        </p>
        {source.coverage
          .filter((c) => !plan.company_id || c.company_id === plan.company_id)
          .map((c) => (
            <span key={`${c.company_id}:${c.kind}`}>
              {source.companies.find((company) => company.id === c.company_id)
                ?.name || c.company_id}{" "}
              ·
              {
                (
                  {
                    paid: "Pagamentos",
                    received: "Recebimentos",
                    payable: "A pagar",
                    receivable: "A receber",
                  } as Record<string, string>
                )[c.kind]
              }
              : {c.count.toLocaleString("pt-BR")} registros ·{" "}
              {c.updated_at
                ? new Date(c.updated_at).toLocaleString("pt-BR")
                : "sem atualização"}
              {c.undated ? ` · ${c.undated} sem data, fora do cálculo` : ""}
            </span>
          ))}
        {source.overdue_receivables ? (
          <p>
            Recebíveis anteriores ao primeiro ano, em todas as empresas:{" "}
            {currency(source.overdue_receivables)}. Informe uma premissa de
            recuperação para incluí-los.
          </p>
        ) : null}
        <p>
          Link direto · acesso autenticado conforme as permissões de Financeiro
          · sem navegação do sistema
        </p>
      </footer>
    </main>
  );
}
