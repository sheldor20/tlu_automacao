"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange, Database, LoaderCircle, RefreshCw } from "lucide-react";
import { getSupabase, friendlyError } from "@/lib/supabase";
import {
  annualPerformance, capitalPerformance, currentPerformanceDate, datedIrr, datedNpv, datedPerformance,
  performanceAmounts, schedulePerformance, totalPerformance,
  type AnnualPerformance, type PerformanceMode, type PerformanceSnapshot,
} from "@/lib/enterprise-performance";
import "./enterprise-performance.css";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 2 });
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 2 });
const dateLabel = (date: string | null) => date ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)) : "—";
const modes: { key: PerformanceMode; label: string; incoming: string; outgoing: string }[] = [
  { key: "realized", label: "Realizada", incoming: "Recebido", outgoing: "Pago" },
  { key: "forecast", label: "Prevista", incoming: "A receber", outgoing: "A pagar" },
  { key: "total", label: "Total", incoming: "Recebimentos", outgoing: "Gastos" },
];
const sources = [
  ["Recebimentos", "bd84bea2-0f3c-4dc6-9081-0eab08502ba3"],
  ["Pagamentos", "96551230-06b0-4e0f-9881-890030e2992a"],
  ["Contas a receber", "32a488c2-14d8-4bde-ba4f-35211d75376b"],
];

export function EnterprisePerformance() {
  const [asOf, setAsOf] = useState(() => currentPerformanceDate());
  const [company, setCompany] = useState("");
  const [catalog, setCatalog] = useState<PerformanceSnapshot["companies"]>([]);
  const [result, setResult] = useState<{ company: string; snapshot: PerformanceSnapshot | null }>({ company: "", snapshot: null });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const refreshController = useRef<AbortController | null>(null);

  useEffect(() => {
    const updateDate = () => setAsOf(currentPerformanceDate());
    const timer = window.setInterval(updateDate, 30_000);
    window.addEventListener("focus", updateDate);
    document.addEventListener("visibilitychange", updateDate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", updateDate);
      document.removeEventListener("visibilitychange", updateDate);
    };
  }, []);
  useEffect(() => () => refreshController.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      const db = getSupabase();
      if (!db) { setError("A conexão financeira ainda não está configurada."); setLoading(false); return; }
      try {
        const { data, error: readError } = await db.rpc("enterprise_performance_snapshot", { p_company: company || null }).abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (readError) throw readError;
        const snapshot = data as PerformanceSnapshot;
        setResult({ company, snapshot });
        setCatalog(snapshot.companies);
      } catch (readError) {
        if (!controller.signal.aborted) { setResult({ company, snapshot: null }); setError(friendlyError(readError)); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [company, revision]);

  async function refresh() {
    const db = getSupabase();
    if (!db || refreshing) return;
    const controller = new AbortController();
    refreshController.current = controller;
    setRefreshing(true); setNotice("");
    try {
      const { data: { session } } = await db.auth.getSession();
      if (!session) throw new Error("Sua sessão expirou. Entre novamente para atualizar.");
      const response = await fetch("/api/enterprise-performance/refresh", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` }, signal: controller.signal });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "A atualização não foi concluída.");
      setNotice("Dados atualizados e conciliados com o Qlik.");
      setRevision((value) => value + 1);
    } catch (refreshError) { if (!controller.signal.aborted) setNotice(friendlyError(refreshError)); }
    finally { if (!controller.signal.aborted) setRefreshing(false); }
  }

  const busy = loading || result.company !== company;
  const snapshot = busy ? null : result.snapshot;
  return <div id="enterprise-performance">
    <div className="vh-main">
      <header className="vh-heading">
        <div><div className="vh-eyebrow">Novos negócios</div><h1>Performance de empreendimentos</h1><p className="vh-subtitle">Histórico financeiro, retorno e necessidade de capital</p></div>
        <span className="vh-tag"><CalendarRange size={14} aria-hidden="true" />Visão histórica e futura</span>
      </header>
      <div className="vh-filter">
        <label>Empresa no Qlik<select value={company} onChange={(event) => { setCompany(event.target.value); setNotice(""); }} disabled={!catalog.length}>
          <option value="">Geral — todas as empresas</option>
          {catalog.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
        </select></label>
        <button className="vh-refresh" type="button" disabled={refreshing || busy} onClick={() => void refresh()}><RefreshCw size={15} className={refreshing ? "spin" : ""} aria-hidden="true" />{refreshing ? "Atualizando…" : "Atualizar Qlik"}</button>
      </div>
      <div className="vh-status" role="status" aria-live="polite">
        {busy ? <><LoaderCircle className="spin" size={15} aria-hidden="true" />Carregando empresas e fluxos…</> : snapshot?.synchronized_at ? <><Database size={14} aria-hidden="true" />{company || `Consolidado de ${snapshot.companies.length} empresas`} · data-base {dateLabel(asOf)} (hoje) · sincronizado em {new Date(snapshot.synchronized_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</> : "Qlik Cloud · primeira carga pendente"}
      </div>
      {error ? <div className="vh-demo" role="alert"><span>{error}</span><button className="vh-close" type="button" onClick={() => setRevision((value) => value + 1)}>Tentar novamente</button></div> : null}
      {notice ? <div className="vh-demo" role="status">{notice}</div> : null}
      {!busy && !error && !snapshot?.synchronized_at ? <div className="vh-empty"><Database size={28} aria-hidden="true" /><h2>Aguardando a primeira carga do Qlik</h2><p>As empresas e os valores aparecerão após a validação e sincronização das fontes de recebimentos, pagamentos e contas a receber.</p><p className="vh-secondary">Os indicadores abaixo serão calculados com os movimentos reais de cada empresa.</p></div> : null}
      {!busy && snapshot?.synchronized_at && !snapshot.rows.length ? <div className="vh-empty"><h2>Sem movimentos para esta empresa</h2><p>A empresa está no cadastro do Qlik, mas não possui valores nas fontes financeiras desta carga.</p></div> : null}
      <PerformanceView key={company} snapshot={snapshot} asOf={asOf} />
    </div>
  </div>;
}

export function PerformanceView({ snapshot, asOf }: { snapshot: PerformanceSnapshot | null; asOf: string }) {
  const [mode, setMode] = useState<PerformanceMode>("total");
  const [rateInput, setRateInput] = useState("15");
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const rateValue = Number(rateInput.replace(",", "."));
  const validRate = rateInput.trim() !== "" && Number.isFinite(rateValue) && rateValue >= 0 && rateValue <= 100;
  const rate = validRate ? rateValue / 100 : null;
  const model = useMemo(() => {
    const scheduled = schedulePerformance(snapshot?.rows || [], asOf);
    const totals = totalPerformance(scheduled.rows);
    const flows = datedPerformance(scheduled.rows);
    const available = Boolean(snapshot?.synchronized_at && scheduled.rows.length);
    const dated = available && !scheduled.blockedReason;
    return {
      scheduled, totals, flows, available, dated,
      overall: performanceAmounts(totals, "total"),
      annual: annualPerformance(scheduled.rows, mode),
      irr: dated ? datedIrr(flows) : { rate: null, reason: scheduled.blockedReason },
      npv: dated && rate !== null ? datedNpv(flows, rate) : null,
      capital: dated ? capitalPerformance(flows) : null,
      discounted: dated && rate !== null ? capitalPerformance(flows, rate) : null,
    };
  }, [snapshot, asOf, mode, rate]);
  const { available, overall, scheduled, irr, capital, discounted } = model;
  const activeMode = modes.find((item) => item.key === mode)!;
  const annualTotal = performanceAmounts(model.totals, mode);
  const detail = model.annual.find((item) => item.year === selectedYear);
  const showAmount = (value: number) => available ? money.format(value) : "—";
  const recovery = (value: typeof capital) => !value ? "—" : !value.hasDeficit ? "Sem déficit no fluxo" : value.recovery ? dateLabel(value.recovery) : "Não recuperado no horizonte";
  const roi = available && overall.outgoing > 0 ? overall.net / overall.outgoing : null;
  const margin = available && overall.incoming > 0 ? overall.net / overall.incoming : null;
  const roiText = roi === null ? "—" : percent.format(roi);
  return <>
    {available && scheduled.blockedReason ? <div className="vh-demo" role="note"><span>{scheduled.blockedReason} Os totais permanecem disponíveis; os indicadores por data aguardam essa definição.</span></div> : null}
    {available && scheduled.overdue > 0 ? <div className="vh-demo vh-assumption">
      <span>Vencidos projetados para hoje ({dateLabel(asOf)}): {money.format(scheduled.overdue)} · soma dos valores absolutos.</span>
      <span>Premissa de cálculo para valores em aberto; as datas futuras são mantidas. Não altera o Qlik.</span>
    </div> : null}
    <section className="vh-return-section" aria-labelledby="performance-return-title">
      <div className="vh-return-header">
        <div><h2 id="performance-return-title">Retorno do empreendimento</h2><span className="vh-secondary">Ciclo completo dos fluxos cadastrados · histórico e futuro</span></div>
        <label className="vh-hurdle">Taxa mínima de retorno <input type="number" min="0" max="100" step="any" value={rateInput} onChange={(event) => setRateInput(event.target.value)} aria-invalid={!validRate} aria-describedby="performance-rate-hint" />% a.a.</label>
      </div>
      {!validRate ? <p className="vh-input-error" role="alert">Informe uma taxa entre 0% e 100% ao ano.</p> : null}
      <div className="vh-return-grid">
        <article className="vh-return-metric"><span className="vh-metric-label">Retorno sobre o custo</span><strong className="vh-metric-value">{roiText}</strong><span className="vh-secondary">{margin === null ? "Acumulado em todo o projeto" : `Margem do fluxo: ${percent.format(margin)} · ciclo completo`}</span></article>
        <article className="vh-return-metric vh-emphasis"><span className="vh-metric-label">TIR projetada anual</span><strong className="vh-metric-value">{irr.rate === null ? "—" : <>{percent.format(irr.rate)} <small>a.a.</small></>}</strong><span className="vh-secondary">{irr.reason || (irr.rate !== null && rate !== null ? `${decimal.format((irr.rate - rate) * 100)} p.p. em relação à taxa mínima` : "Calculada com as datas dos fluxos")}</span></article>
        <article className="vh-return-metric"><span className="vh-metric-label">Valor presente líquido</span><strong className="vh-metric-value" title={model.npv === null ? undefined : money.format(model.npv)}>{model.npv === null ? "—" : `R$ ${compact.format(model.npv)}`}</strong><span className="vh-secondary">VPL na origem{model.flows.length ? ` · ${dateLabel(model.flows[0].date)}` : " do fluxo"}</span></article>
      </div>
      <div className="vh-capital-summary">
        <div><span className="vh-metric-label">Prazo de recuperação · payback simples</span><strong>{recovery(capital)}</strong><span className="vh-secondary">Primeira data de recuperação definitiva no horizonte</span><span className="vh-secondary">Descontado à taxa mínima: {recovery(discounted)}</span></div>
        <div><span className="vh-metric-label">Necessidade máxima de caixa</span><strong>{capital ? money.format(capital.peak) : "—"}</strong><span className="vh-secondary">{capital?.peakDate ? `Maior déficit acumulado em ${dateLabel(capital.peakDate)}` : "Maior déficit acumulado no fluxo cadastrado"}</span><span className="vh-secondary">Caixa inicial zero · depende da abrangência das contas</span></div>
      </div>
      {capital?.points.length ? <CapitalChart capital={capital} asOf={asOf} /> : <div className="vh-chart-empty">{available ? "Trajetória de caixa disponível após validar as datas." : "A trajetória de caixa aparecerá com os dados do Qlik."}</div>}
      <div className="vh-capital-foot"><span>Saldo acumulado por data de caixa</span><span>Linha contínua: até hoje · tracejada: datas futuras</span></div>
      <p className="vh-model-note" id="performance-rate-hint">Taxa inicial de 15% como premissa editável, sem referência de mercado. Alterá-la recalcula o VPL e o payback descontado.</p>
    </section>
    <section aria-labelledby="performance-general-title">
      <div className="vh-section-heading"><h2 id="performance-general-title">Composição do resultado</h2><span className="vh-secondary">Todo o período · valores em R$</span></div>
      <div className="vh-summaries">
        {modes.map((item, index) => {
          const values = performanceAmounts(model.totals, item.key);
          return <article key={item.key} className={`vh-summary ${item.key === "total" ? "vh-summary-total" : ""}`}>
            <div className="vh-summary-top"><h3>{item.key === "realized" ? "Realizado" : item.key === "forecast" ? "Previsto" : "Total do fluxo"}</h3><span className="vh-index">0{index + 1}</span></div>
            <span className="vh-secondary">{item.key === "realized" ? "Valores já recebidos e pagos" : item.key === "forecast" ? "Saldos em aberto nas datas esperadas" : "Realizado e valores ainda em aberto"}</span>
            <dl><div><dt>{item.incoming}</dt><dd>{showAmount(values.incoming)}</dd></div><div><dt>{item.outgoing}</dt><dd>{showAmount(values.outgoing)}</dd></div><div className="vh-net"><dt>Saldo {item.key === "realized" ? "realizado" : item.key === "forecast" ? "previsto" : "total"}</dt><dd className={values.net < 0 ? "vh-negative" : undefined}>{showAmount(values.net)}</dd></div></dl>
          </article>;
        })}
      </div>
    </section>
    <section className="vh-panel" aria-labelledby="performance-annual-title">
      <div className="vh-panel-top"><div><h2 id="performance-annual-title">Ano a ano</h2><span className="vh-secondary">{mode === "realized" ? "Valores recebidos e pagos por ano de baixa" : mode === "forecast" ? "Saldos em aberto por ano esperado" : "Realizado e saldos em aberto por ano"}</span></div><div className="vh-tabs" role="group" aria-label="Visão dos valores anuais">{modes.map((item) => <button key={item.key} type="button" aria-pressed={mode === item.key} onClick={() => setMode(item.key)}>{item.label}</button>)}</div></div>
      <div className="vh-chart-meta"><span className="vh-secondary">Comparativo anual · valores em R$</span><div className="vh-legend"><span><b className="vh-swatch vh-in" />Recebimentos</span><span><b className="vh-swatch vh-out" />Gastos</span>{mode !== "realized" ? <span><b className="vh-swatch vh-hatch" />Em aberto</span> : null}</div></div>
      {available ? <AnnualChart rows={model.annual} mode={mode} selected={selectedYear} onSelect={setSelectedYear} /> : <div className="vh-chart-empty">Comparativo anual aguardando dados.</div>}
      <div className="vh-table-heading"><h3>Detalhamento anual</h3><span className="vh-secondary">Selecione um ano para abrir a composição</span></div>
      <div className="vh-table-scroll"><table>
        <caption className="vh-accessible">Valores em reais do cenário {activeMode.label}, por ano, e saldo acumulado a partir de zero.</caption>
        <thead><tr><th scope="col">Ano</th><th scope="col">{activeMode.incoming}</th><th scope="col">{activeMode.outgoing}</th><th scope="col">Saldo do ano</th><th scope="col">Saldo acumulado</th></tr></thead>
        <tbody>{model.annual.map((row) => <tr key={row.year} className={row.year === selectedYear ? "vh-focus-row" : undefined}><th scope="row"><button className="vh-year" aria-expanded={row.year === selectedYear} aria-controls="performance-year-detail" type="button" onClick={() => setSelectedYear(row.year === selectedYear ? null : row.year)}>{row.year}<span>↗</span></button></th><td>{money.format(row.incoming)}</td><td>{money.format(row.outgoing)}</td><td className={row.net < 0 ? "vh-negative" : undefined}>{money.format(row.net)}</td><td>{row.accumulated === null ? "—" : money.format(row.accumulated)}</td></tr>)}</tbody>
        <tfoot><tr><td>Total</td><td>{showAmount(annualTotal.incoming)}</td><td>{showAmount(annualTotal.outgoing)}</td><td>{showAmount(annualTotal.net)}</td><td>{scheduled.undated ? "—" : showAmount(annualTotal.net)}</td></tr></tfoot>
      </table></div>
      <div id="performance-year-detail" hidden={!detail} className="vh-detail" aria-live="polite">{detail ? <><div className="vh-detail-top"><h3>Composição · {detail.year}</h3><button className="vh-close" type="button" onClick={() => setSelectedYear(null)}>Fechar</button></div><div className="vh-detail-grid">{([['Recebido', detail.received], ['Pago', detail.paid], ['A receber', detail.receivable], ['A pagar', detail.payable]] as const).map(([label, value]) => <div key={label}><span>{label}</span><strong>{money.format(value)}</strong></div>)}</div></> : null}</div>
      <div className="vh-table-note"><span>Realizado por baixa · previsto por data da origem ou premissa informada</span><span>Saldo: recebimentos menos gastos · acumulado a partir de zero</span></div>
    </section>
    <details className="vh-criteria"><summary>Premissas, cálculos e fontes</summary><dl>
      <dt>Empresas</dt><dd>Catálogo do campo Empresa no Qlik. A visão geral soma os fluxos por data e recalcula os indicadores; a TIR não é a média das taxas das empresas.</dd>
      <dt>Realizado e previsto</dt><dd>Realizado usa recebimentos e pagamentos baixados. Previsto usa apenas os saldos em aberto, sem repetir parcelas liquidadas. As abas anuais não alteram o retorno do ciclo completo.</dd>
      <dt>Datas</dt><dd>A data-base é sempre hoje, no horário de São Paulo; a última sincronização do Qlik é informada separadamente. Valores em aberto vencidos são projetados para hoje como premissa de cálculo. Baixas realizadas e vencimentos futuros mantêm as datas da origem. Valores sem data continuam nos totais e na linha “Sem data”, mas impedem os indicadores por data.</dd>
      <dt>Retorno e margem</dt><dd>Retorno sobre custo = saldo total ÷ gastos totais. Margem = saldo total ÷ recebimentos totais. São indicadores do ciclo completo, não taxas anuais.</dd>
      <dt>TIR e VPL</dt><dd>TIR anual com datas efetivas (base de 365 dias), equivalente à XTIR. O cálculo busca a taxa que zera o VPL e verifica se ela é única, inclusive quando pagamentos e recebimentos se alternam. Se essa confirmação for inconclusiva, a TIR fica indisponível. VPL = soma dos fluxos descontados à taxa mínima desde a primeira data.</dd>
      <dt>Payback e capital</dt><dd>Recuperação na primeira data após a qual o acumulado não volta a ficar negativo no horizonte informado. Necessidade máxima de caixa = maior déficit acumulado, com saldo inicial zero. Não considera saldo bancário disponível nem linhas de crédito externas ao fluxo.</dd>
      <dt>Abrangência</dt><dd>Os resultados representam as contas cadastradas no Qlik. Terreno, obras, impostos, comissões, despesas, distratos, estoque ainda não vendido e eventuais financiamentos precisam estar corretamente incluídos ou separados na origem para uma análise econômica completa. Não representam automaticamente o retorno do capital dos sócios.</dd>
    </dl></details>
    <footer className="vh-footer"><span>Fonte: Qlik Cloud · Financeiro</span><nav className="vh-sources" aria-label="Fontes financeiras">{sources.map(([label, sheet]) => <a key={sheet} href={`https://terralotusurbanismo.us.qlikcloud.com/sense/app/e3d13862-ec1f-4332-8a5b-df4c7b93fa7c/sheet/${sheet}/state/analysis`} target="_blank" rel="noreferrer">{label} ↗</a>)}</nav></footer>
  </>;
}

function CapitalChart({ capital, asOf }: { capital: ReturnType<typeof capitalPerformance>; asOf: string }) {
  const points = capital.points;
  const width = 1000, height = 215, left = 65, right = 22, top = 24, bottom = 30;
  const minDate = Date.parse(points[0].date), maxDate = Math.max(Date.parse(points[points.length - 1].date), minDate + 86400000);
  const extent = points.reduce((range, point) => [Math.min(range[0], point.value), Math.max(range[1], point.value)], [0, 0]);
  if (extent[0] === extent[1]) extent[1] = extent[0] + 1;
  const range = Math.max(extent[1] - extent[0], 1);
  const x = (date: string) => left + (Date.parse(date) - minDate) / (maxDate - minDate) * (width - left - right);
  const y = (value: number) => top + (extent[1] - value) / range * (height - top - bottom);
  const actual = points.filter((point) => point.date <= asOf), future = points.filter((point) => point.date > asOf);
  const boundary = { date: asOf < points[0].date ? points[0].date : asOf, value: actual.at(-1)?.value || 0 };
  const path = (list: typeof points) => list.map((point, index) => `${index ? "H" : "M"}${x(point.date).toFixed(2)}${index ? "V" : ","}${y(point.value).toFixed(2)}`).join(" ");
  const actualLine = [{ date: points[0].date, value: 0 }, ...actual];
  if (future.length) actualLine.push(boundary);
  return <div className="vh-capital-chart"><svg viewBox={`0 0 ${width} ${height}`} className="vh-capital-plot" role="img" aria-label={`Saldo acumulado; maior déficit ${money.format(capital.peak)}. Recuperação ${capital.recovery ? dateLabel(capital.recovery) : "não identificada"}.`}>
    {[0, .5, 1].map((part) => { const value = extent[0] + range * part; return <g key={part}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="var(--vh-border)" /><text x={left - 9} y={y(value) + 4} textAnchor="end">{compact.format(value)}</text></g>; })}
    <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} stroke="var(--vh-muted)" strokeDasharray="2 4" />
    <path d={path(actualLine)} fill="none" stroke="var(--vh-green)" strokeWidth="2.5" />
    {future.length ? <path d={path([boundary, ...future])} fill="none" stroke="var(--vh-green)" strokeWidth="2.5" strokeDasharray="6 5" /> : null}
    {capital.peakDate ? <circle cx={x(capital.peakDate)} cy={y(-capital.peak)} r="4" fill="var(--vh-orange)"><title>{`Maior déficit: ${money.format(capital.peak)} em ${dateLabel(capital.peakDate)}`}</title></circle> : null}
    {[0, .25, .5, .75, 1].map((part) => <text key={part} x={left + part * (width - left - right)} y={height - 8} textAnchor={part === 0 ? "start" : part === 1 ? "end" : "middle"}>{new Date(minDate + part * (maxDate - minDate)).toLocaleDateString("pt-BR", { year: "numeric", month: "short", timeZone: "UTC" })}</text>)}
  </svg></div>;
}

function AnnualChart({ rows, mode, selected, onSelect }: { rows: AnnualPerformance[]; mode: PerformanceMode; selected: string | null; onSelect: (year: string) => void }) {
  const width = Math.max(950, rows.length * 70), height = 280, left = 65, top = 22, bottom = 35;
  const components = rows.map((row) => [mode === "forecast" ? 0 : row.received, mode === "realized" ? 0 : row.receivable, mode === "forecast" ? 0 : row.paid, mode === "realized" ? 0 : row.payable]);
  let max = 0, min = 0;
  for (const values of components) for (const pair of [values.slice(0, 2), values.slice(2)]) {
    max = Math.max(max, pair.reduce((sum, value) => sum + Math.max(value, 0), 0));
    min = Math.min(min, pair.reduce((sum, value) => sum + Math.min(value, 0), 0));
  }
  if (max === min) max = min + 1;
  const range = max - min, y = (value: number) => top + (max - value) / range * (height - top - bottom);
  const step = (width - left - 15) / Math.max(rows.length, 1), bar = Math.min(22, step * .25);
  return <div className="vh-chart-scroll"><svg className="vh-plot" style={{ minWidth: width > 950 ? width : undefined }} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Comparativo anual de recebimentos e gastos. Valores completos na tabela abaixo.">
    <defs>{["green", "orange"].map((color) => <pattern key={color} id={`performance-hatch-${color}`} width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill={`var(--vh-${color})`} opacity=".18" /><path d="M-1 1L1-1M0 5L5 0M4 6L6 4" stroke={`var(--vh-${color})`} strokeWidth="1" /></pattern>)}</defs>
    {[0, .25, .5, .75, 1].map((part) => { const value = min + range * part; return <g key={part}><line x1={left} x2={width - 15} y1={y(value)} y2={y(value)} stroke="var(--vh-border)" /><text x={left - 9} y={y(value) + 4} textAnchor="end">{compact.format(value)}</text></g>; })}
    {rows.map((row, index) => {
      const center = left + step * (index + .5), values = components[index];
      return <g key={row.year} className="vh-chart-hit" role="button" tabIndex={0} aria-label={`${row.year}: recebimentos ${money.format(row.incoming)}, gastos ${money.format(row.outgoing)}. Abrir composição.`} onClick={() => onSelect(row.year)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(row.year); } }}>
        <rect x={center - step / 2 + 2} y={top - 6} width={step - 4} height={height - top} rx="6" fill={selected === row.year ? "var(--vh-soft)" : "transparent"} />
        {[0, 1].map((side) => {
          let positive = 0, negative = 0;
          const color = side ? "orange" : "green";
          return <Fragment key={side}>{values.slice(side * 2, side * 2 + 2).map((value, forecast) => {
            const start = value >= 0 ? positive : negative, end = start + value;
            if (value >= 0) positive = end; else negative = end;
            return <rect key={forecast} x={center + (side ? 3 : -bar - 3)} y={Math.min(y(start), y(end))} width={bar} height={Math.abs(y(start) - y(end))} rx="1" fill={forecast ? `url(#performance-hatch-${color})` : `var(--vh-${color})`} />;
          })}</Fragment>;
        })}
        <text x={center} y={height - 10} textAnchor="middle">{row.year}</text>
        <title>{`${row.year} · ${money.format(row.incoming)} recebidos/a receber · ${money.format(row.outgoing)} pagos/a pagar`}</title>
      </g>;
    })}
  </svg></div>;
}
