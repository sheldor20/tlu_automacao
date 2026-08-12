"use client";

import { GroupedBarChart, TrendChart } from "@/components/management-charts";
import { Button, KpiCard, ProgressBar, StatusPill } from "@/components/ui";
import { BUSINESS_STAGES } from "@/lib/constants";
import { currency } from "@/lib/format";
import { friendlyError, getSupabase } from "@/lib/supabase";
import type {
  ManagementAreaSlug,
  ManagementBusinessStageSnapshot,
  ManagementConstructionSnapshot,
  ManagementIndicatorValue,
  ManagementRentalSnapshot,
} from "@/lib/types";
import {
  ArrowUpRight,
  BadgeDollarSign,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  CircleDollarSign,
  Clock3,
  Gauge,
  HandCoins,
  HardHat,
  Landmark,
  Maximize2,
  Minimize2,
  RefreshCw,
  Scale,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

const PRESENTATION_WIDTH = 1360;
const PRESENTATION_HEIGHT = 680;
const PRESENTATION_PADDING = 14;
const PRESENTATION_STORAGE_KEY = "terra-lotus-management-presentation";

const managementAreas: Array<{
  slug: ManagementAreaSlug;
  label: string;
  shortLabel: string;
  eyebrow: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    slug: "empresa",
    label: "Empresa",
    shortLabel: "Empresa",
    eyebrow: "DRE e caixa",
    description: "Receitas, despesas, resultado gerencial e posição de caixa em uma visão consolidada.",
    icon: Landmark,
  },
  {
    slug: "juridico-vendas-cobranca",
    label: "Jurídico, Pós-vendas, Vendas e Cobrança",
    shortLabel: "Jurídico e comercial",
    eyebrow: "Operação comercial",
    description: "Cobrança, vendas, distratos e evolução da escrituração das unidades quitadas.",
    icon: Scale,
  },
  {
    slug: "rh-marketing-clientes",
    label: "RH, Marketing e Clientes",
    shortLabel: "RH, Marketing e Clientes",
    eyebrow: "Pessoas e clientes",
    description: "Aluguéis, clima organizacional e experiência dos clientes acompanhados no tempo.",
    icon: UsersRound,
  },
  {
    slug: "novos-negocios",
    label: "Novos Negócios",
    shortLabel: "Novos negócios",
    eyebrow: "Pipeline de áreas",
    description: "Quantidade de áreas, VGV potencial e velocidade de passagem por cada fase do funil.",
    icon: TrendingUp,
  },
  {
    slug: "obras-engenharia",
    label: "Obras e Engenharia",
    shortLabel: "Obras e Engenharia",
    eyebrow: "Execução do portfólio",
    description: "Orçamento previsto e evolução física e financeira das obras em andamento.",
    icon: HardHat,
  },
];

const allowedAreas = new Set(managementAreas.map((area) => area.slug));
const monthFormatter = new Intl.DateTimeFormat("pt-BR", { month: "short" });
const competenceFormatter = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" });

function monthDate(key: string) {
  return new Date(`${key.slice(0, 10)}T12:00:00`);
}

function buildMonthRange(length = 12) {
  const today = new Date();
  return Array.from({ length }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() - (length - 1 - index), 1, 12);
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`,
      label: monthFormatter.format(date).replace(".", ""),
    };
  });
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function displayNumber(value: number | null, suffix = "") {
  if (value === null) return "—";
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)}${suffix}`;
}

function BreakdownList({
  items,
  emptyLabel,
}: {
  items: Array<{ label: string; value: number }>;
  emptyLabel: string;
}) {
  const maximum = Math.max(...items.map((item) => item.value), 1);
  if (!items.length) return <div className="management-empty-panel"><BarChart3 size={20} /><span>{emptyLabel}</span></div>;
  return (
    <div className="management-breakdown-list">
      {items.map((item) => (
        <div key={item.label}>
          <div><span>{item.label}</span><strong>{currency(item.value, true)}</strong></div>
          <div className="management-breakdown-track"><span style={{ width: `${Math.max(2, item.value / maximum * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export function ManagementDashboard({ area }: { area: ManagementAreaSlug }) {
  const supabase = getSupabase();
  const [values, setValues] = useState<ManagementIndicatorValue[]>([]);
  const [businessStages, setBusinessStages] = useState<ManagementBusinessStageSnapshot[]>([]);
  const [constructions, setConstructions] = useState<ManagementConstructionSnapshot[]>([]);
  const [rentalSnapshot, setRentalSnapshot] = useState<ManagementRentalSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [liveStatus, setLiveStatus] = useState<"connecting" | "live" | "manual">("connecting");
  const [presentationMode, setPresentationMode] = useState(false);
  const [presentationScale, setPresentationScale] = useState(1);
  const [presentationContentScale, setPresentationContentScale] = useState(1);
  const reloadTimer = useRef<number | null>(null);
  const presentationContentRef = useRef<HTMLDivElement | null>(null);
  const fullscreenRequestedRef = useRef(false);
  const currentArea = managementAreas.find((item) => item.slug === area);
  const months = useMemo(() => buildMonthRange(12), []);

  const loadData = useCallback(async (background = false) => {
    if (!supabase) return;
    if (background) setRefreshing(true);
    else setLoading(true);
    setError("");

    const [valueResult, businessResult, constructionResult, rentalResult] = await Promise.all([
      supabase.from("management_indicator_values").select("*").order("reference_month", { ascending: true }),
      supabase.rpc("management_business_funnel_snapshot"),
      supabase.rpc("management_construction_snapshot"),
      supabase.rpc("management_rental_snapshot"),
    ]);
    const firstError = valueResult.error || businessResult.error || constructionResult.error || rentalResult.error;
    if (firstError) {
      setError(friendlyError(firstError));
    } else {
      setValues(((valueResult.data || []) as ManagementIndicatorValue[]).map((item) => ({ ...item, value: toNumber(item.value) })));
      setBusinessStages(((businessResult.data || []) as ManagementBusinessStageSnapshot[]).map((item) => ({
        ...item,
        area_count: toNumber(item.area_count),
        potential_vgv: toNumber(item.potential_vgv),
        average_days: toNumber(item.average_days),
      })));
      setConstructions(((constructionResult.data || []) as ManagementConstructionSnapshot[]).map((item) => ({
        ...item,
        planned_budget: toNumber(item.planned_budget),
        realized_total: toNumber(item.realized_total),
        physical_progress: toNumber(item.physical_progress),
        financial_progress: toNumber(item.financial_progress),
      })));
      const rental = (rentalResult.data || [])[0] as ManagementRentalSnapshot | undefined;
      setRentalSnapshot(rental ? {
        total_properties: toNumber(rental.total_properties),
        available_properties: toNumber(rental.available_properties),
        rented_properties: toNumber(rental.rented_properties),
        renovation_properties: toNumber(rental.renovation_properties),
      } : null);
      setLastSync(new Date());
    }
    setLoading(false);
    setRefreshing(false);
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    if (window.sessionStorage.getItem(PRESENTATION_STORAGE_KEY) === "true") {
      const timer = window.setTimeout(() => setPresentationMode(true), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    document.body.classList.toggle("management-presenting", presentationMode);
    return () => document.body.classList.remove("management-presenting");
  }, [presentationMode]);

  useEffect(() => {
    if (!presentationMode) return;

    let animationFrame = 0;
    const fitPresentation = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        setPresentationScale(Math.min(
          window.innerWidth / PRESENTATION_WIDTH,
          window.innerHeight / PRESENTATION_HEIGHT,
        ));

        const content = presentationContentRef.current;
        if (!content) return;
        const availableWidth = PRESENTATION_WIDTH - PRESENTATION_PADDING * 2;
        const availableHeight = PRESENTATION_HEIGHT - PRESENTATION_PADDING * 2;
        setPresentationContentScale(Math.min(
          1,
          availableWidth / Math.max(content.scrollWidth, 1),
          availableHeight / Math.max(content.scrollHeight, 1),
        ));
      });
    };

    fitPresentation();
    window.addEventListener("resize", fitPresentation);
    const resizeObserver = new ResizeObserver(fitPresentation);
    if (presentationContentRef.current) resizeObserver.observe(presentationContentRef.current);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", fitPresentation);
      resizeObserver.disconnect();
    };
  }, [presentationMode, area]);

  useEffect(() => {
    const leavePresentation = () => {
      fullscreenRequestedRef.current = false;
      window.sessionStorage.removeItem(PRESENTATION_STORAGE_KEY);
      setPresentationMode(false);
    };
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && (fullscreenRequestedRef.current || presentationMode)) leavePresentation();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && presentationMode && !document.fullscreenElement) leavePresentation();
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [presentationMode]);

  useEffect(() => {
    if (!supabase) return;
    const scheduleReload = () => {
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(() => void loadData(true), 280);
    };
    const channel = supabase
      .channel("management-dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "management_indicator_values" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "management_dashboard_signals" }, scheduleReload)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setLiveStatus("live");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setLiveStatus("manual");
      });
    return () => {
      if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [loadData, supabase]);

  const areaValues = useMemo(() => values.filter((item) => item.area === area), [area, values]);

  function latestMetric(metricKey: string) {
    return [...areaValues]
      .filter((item) => item.metric_key === metricKey && item.dimension_key === "total")
      .sort((a, b) => b.reference_month.localeCompare(a.reference_month))[0] || null;
  }

  function metricValue(metricKey: string) {
    return latestMetric(metricKey)?.value ?? null;
  }

  function metricHelper(metricKey: string, fallback = "aguardando primeira carga") {
    const metric = latestMetric(metricKey);
    return metric ? `competência ${competenceFormatter.format(monthDate(metric.reference_month))}` : fallback;
  }

  function seriesFor(metricKey: string) {
    return months.map((month) => areaValues.find((item) => item.metric_key === metricKey && item.dimension_key === "total" && item.reference_month === month.key)?.value ?? null);
  }

  function latestBreakdown(metricKey: string) {
    const rows = areaValues.filter((item) => item.metric_key === metricKey && item.dimension_key !== "total");
    const latestMonth = rows.map((item) => item.reference_month).sort().at(-1);
    if (!latestMonth) return [];
    return rows
      .filter((item) => item.reference_month === latestMonth)
      .map((item) => ({ label: item.dimension_label || item.dimension_key, value: item.value }))
      .sort((a, b) => b.value - a.value);
  }

  if (!currentArea || !allowedAreas.has(area)) {
    return <section className="management-setup-error"><h1>Visão não encontrada</h1><p>Escolha uma das áreas disponíveis no painel de indicadores.</p><Link className="button button-primary" href="/indicadores/empresa">Abrir Empresa</Link></section>;
  }

  const CurrentIcon = currentArea.icon;
  const lastSyncLabel = lastSync ? lastSync.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
  const presentationStyle = presentationMode ? ({
    "--management-presentation-scale": presentationScale,
    "--management-content-scale": presentationContentScale,
  } as CSSProperties) : undefined;

  async function togglePresentation() {
    if (presentationMode) {
      fullscreenRequestedRef.current = false;
      window.sessionStorage.removeItem(PRESENTATION_STORAGE_KEY);
      setPresentationMode(false);
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen();
        } catch {
          // O modo de apresentação local ainda é encerrado se o navegador recusar a API.
        }
      }
      return;
    }

    window.sessionStorage.setItem(PRESENTATION_STORAGE_KEY, "true");
    setPresentationMode(true);
    fullscreenRequestedRef.current = true;
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      fullscreenRequestedRef.current = false;
      // Mantém o palco 16:8 ativo mesmo quando o navegador bloqueia tela cheia.
    }
  }

  return (
    <div className={`management-page${presentationMode ? " management-page-presenting" : ""}`} style={presentationStyle}>
      <div className="management-presentation-content" ref={presentationContentRef}>
      <nav className="management-area-nav" aria-label="Visões do painel gerencial">
        {managementAreas.map((item) => {
          const Icon = item.icon;
          return <Link key={item.slug} href={`/indicadores/${item.slug}`} className={item.slug === area ? "active" : ""}><Icon size={17} /><span>{item.shortLabel}</span></Link>;
        })}
      </nav>

      <header className="management-header">
        <div className="management-title-icon"><CurrentIcon size={24} /></div>
        <div className="management-title-copy">
          <span>{currentArea.eyebrow}</span>
          <h1>{currentArea.label}</h1>
          <p>{currentArea.description}</p>
        </div>
        <div className="management-sync">
          <span className={`live-indicator live-${liveStatus}`}><i />{liveStatus === "live" ? "Atualização em tempo real" : liveStatus === "connecting" ? "Conectando à base" : "Atualização manual"}</span>
          <small>Última leitura {lastSyncLabel}</small>
          <div className="management-sync-actions">
            <Button variant="secondary" onClick={() => void loadData(true)} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "spin" : ""} /> Atualizar</Button>
            <Button className="management-fullscreen-button" variant="secondary" onClick={() => void togglePresentation()} aria-pressed={presentationMode} title={presentationMode ? "Sair da apresentação" : "Apresentar em tela cheia na proporção 16:8"}>
              {presentationMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              {presentationMode ? "Sair" : "Tela cheia"}<span>16:8</span>
            </Button>
          </div>
        </div>
      </header>

      {error ? (
        <section className="management-setup-error">
          <div><Sparkles size={22} /></div>
          <h2>Conecte a base de indicadores</h2>
          <p>{error}</p>
          <small>Depois de executar a migration, esta tela passa a consumir os dados automaticamente.</small>
          <Button onClick={() => void loadData()}><RefreshCw size={16} /> Tentar novamente</Button>
        </section>
      ) : loading ? (
        <section className="management-loading"><RefreshCw size={22} className="spin" /><span>Montando a visão gerencial…</span></section>
      ) : (
        <>
          {area === "empresa" ? <CompanyView metricValue={metricValue} metricHelper={metricHelper} seriesFor={seriesFor} months={months} revenueBreakdown={latestBreakdown("receita_plano_contas")} expenseBreakdown={latestBreakdown("despesa_plano_contas")} /> : null}
          {area === "juridico-vendas-cobranca" ? <LegalSalesView metricValue={metricValue} metricHelper={metricHelper} seriesFor={seriesFor} months={months} /> : null}
          {area === "rh-marketing-clientes" ? <PeopleClientsView metricValue={metricValue} metricHelper={metricHelper} seriesFor={seriesFor} months={months} rentals={rentalSnapshot} /> : null}
          {area === "novos-negocios" ? <NewBusinessView stages={businessStages} /> : null}
          {area === "obras-engenharia" ? <EngineeringView constructions={constructions} /> : null}
        </>
      )}
      </div>
    </div>
  );
}

type MetricViewProps = {
  metricValue: (key: string) => number | null;
  metricHelper: (key: string, fallback?: string) => string;
  seriesFor: (key: string) => Array<number | null>;
  months: Array<{ key: string; label: string }>;
};

function CompanyView({ metricValue, metricHelper, seriesFor, months, revenueBreakdown, expenseBreakdown }: MetricViewProps & { revenueBreakdown: Array<{ label: string; value: number }>; expenseBreakdown: Array<{ label: string; value: number }> }) {
  const revenue = metricValue("receita_consolidada");
  const expense = metricValue("despesa_consolidada");
  const reportedResult = metricValue("resultado_gerencial");
  const result = reportedResult ?? (revenue !== null && expense !== null ? revenue - expense : null);
  const derivedResultSeries = months.map((_, index) => {
    const reported = seriesFor("resultado_gerencial")[index];
    const monthRevenue = seriesFor("receita_consolidada")[index];
    const monthExpense = seriesFor("despesa_consolidada")[index];
    return reported ?? (monthRevenue !== null && monthExpense !== null ? monthRevenue - monthExpense : null);
  });
  return (
    <div className="management-view-stack">
      <section className="management-kpi-grid">
        <KpiCard label="Receita consolidada" value={revenue === null ? "—" : currency(revenue, true)} helper={metricHelper("receita_consolidada")} icon={<BadgeDollarSign size={17} />} />
        <KpiCard label="Despesas consolidadas" value={expense === null ? "—" : currency(expense, true)} helper={metricHelper("despesa_consolidada")} icon={<WalletCards size={17} />} />
        <KpiCard label="Resultado gerencial" value={result === null ? "—" : currency(result, true)} helper={reportedResult === null && result !== null ? "calculado por receita menos despesas" : metricHelper("resultado_gerencial")} tone={result !== null && result >= 0 ? "success" : result === null ? "default" : "warning"} icon={<BarChart3 size={17} />} />
        <KpiCard label="Valor em caixa" value={metricValue("valor_caixa") === null ? "—" : currency(metricValue("valor_caixa") || 0, true)} helper={metricHelper("valor_caixa")} icon={<Landmark size={17} />} />
      </section>
      <section className="management-two-columns">
        <article className="management-panel management-panel-wide"><div className="management-panel-head"><div><span>Evolução mensal</span><h2>Receitas e despesas</h2></div></div><GroupedBarChart labels={months.map((month) => month.label)} series={[{ label: "Receitas", color: "#405343", values: seriesFor("receita_consolidada") }, { label: "Despesas", color: "#b3875b", values: seriesFor("despesa_consolidada") }]} /></article>
        <article className="management-panel"><div className="management-panel-head"><div><span>Resultado e liquidez</span><h2>Resultado gerencial e caixa</h2></div></div><TrendChart labels={months.map((month) => month.label)} series={[{ label: "Resultado", color: "#405343", values: derivedResultSeries }, { label: "Caixa", color: "#8aa083", values: seriesFor("valor_caixa") }]} /></article>
      </section>
      <section className="management-two-columns">
        <article className="management-panel"><div className="management-panel-head"><div><span>Composição</span><h2>Receitas por plano de contas</h2></div></div><BreakdownList items={revenueBreakdown} emptyLabel="As contas de receita aparecerão após a primeira carga." /></article>
        <article className="management-panel"><div className="management-panel-head"><div><span>Composição</span><h2>Despesas por plano de contas</h2></div></div><BreakdownList items={expenseBreakdown} emptyLabel="As contas de despesa aparecerão após a primeira carga." /></article>
      </section>
    </div>
  );
}

function LegalSalesView({ metricValue, metricHelper, seriesFor, months }: MetricViewProps) {
  const sales = metricValue("vendas_mes");
  const cancellations = metricValue("distratos_mes");
  const deedMetrics = [
    ["Quitadas", "unidades_quitadas"],
    ["Sem processo", "unidades_sem_processo"],
    ["Autorizadas", "unidades_autorizadas_escrituracao"],
    ["Em escrituração", "unidades_escrituracao_sem_registro"],
    ["Registradas", "unidades_registradas"],
  ] as const;
  return (
    <div className="management-view-stack">
      <section className="management-kpi-grid">
        <KpiCard label="Eficiência da cobrança" value={displayNumber(metricValue("eficiencia_cobranca"), "%")} helper={metricHelper("eficiencia_cobranca")} tone="success" icon={<Gauge size={17} />} />
        <KpiCard label="Inadimplência total" value={metricValue("inadimplencia_total") === null ? "—" : currency(metricValue("inadimplencia_total") || 0, true)} helper={metricHelper("inadimplencia_total")} icon={<HandCoins size={17} />} />
        <KpiCard label="Unidades disponíveis" value={displayNumber(metricValue("unidades_disponiveis"))} helper={metricHelper("unidades_disponiveis")} icon={<Building2 size={17} />} />
        <KpiCard label="Vendas no mês" value={displayNumber(sales)} helper={cancellations === null ? metricHelper("vendas_mes") : `${displayNumber(cancellations)} distrato(s) no mês`} icon={<ShoppingCart size={17} />} />
      </section>
      <section className="management-two-columns">
        <article className="management-panel"><div className="management-panel-head"><div><span>Cobrança</span><h2>Eficiência mês a mês</h2></div></div><TrendChart labels={months.map((month) => month.label)} series={[{ label: "Eficiência (%)", color: "#405343", values: seriesFor("eficiencia_cobranca") }]} /></article>
        <article className="management-panel"><div className="management-panel-head"><div><span>Comercial</span><h2>Vendas, estoque e distratos</h2></div></div><GroupedBarChart labels={months.map((month) => month.label)} series={[{ label: "Disponíveis", color: "#9aab95", values: seriesFor("unidades_disponiveis") }, { label: "Vendas", color: "#405343", values: seriesFor("vendas_mes") }, { label: "Distratos", color: "#b96c62", values: seriesFor("distratos_mes") }]} /></article>
      </section>
      <section className="management-panel">
        <div className="management-panel-head"><div><span>Pós-vendas e jurídico</span><h2>Tração das unidades quitadas</h2><p>O foco é reduzir as unidades sem processo e aumentar as autorizações para escrituração.</p></div></div>
        <div className="management-stage-kpis">{deedMetrics.map(([label, key]) => <article key={key}><span>{label}</span><strong>{displayNumber(metricValue(key))}</strong><small>{metricHelper(key)}</small></article>)}</div>
        <GroupedBarChart labels={months.map((month) => month.label)} series={[{ label: "Sem processo", color: "#b96c62", values: seriesFor("unidades_sem_processo") }, { label: "Autorizadas", color: "#405343", values: seriesFor("unidades_autorizadas_escrituracao") }]} />
      </section>
    </div>
  );
}

function PeopleClientsView({ metricValue, metricHelper, seriesFor, months, rentals }: MetricViewProps & { rentals: ManagementRentalSnapshot | null }) {
  const availability = seriesFor("imoveis_disponiveis");
  if (rentals) availability[availability.length - 1] = rentals.available_properties;
  return (
    <div className="management-view-stack">
      <section className="management-kpi-grid">
        <KpiCard label="Saldo da conta de aluguéis" value={metricValue("saldo_conta_alugueis") === null ? "—" : currency(metricValue("saldo_conta_alugueis") || 0, true)} helper={metricHelper("saldo_conta_alugueis")} icon={<Landmark size={17} />} />
        <KpiCard label="Imóveis disponíveis" value={rentals ? String(rentals.available_properties) : "—"} helper={rentals ? `${rentals.total_properties} imóveis na carteira` : "aguardando base de aluguéis"} icon={<Building2 size={17} />} />
        <KpiCard label="Recebido no mês" value={metricValue("receita_alugueis_mes") === null ? "—" : currency(metricValue("receita_alugueis_mes") || 0, true)} helper={metricHelper("receita_alugueis_mes")} tone="success" icon={<BadgeDollarSign size={17} />} />
        <KpiCard label="Gasto no mês" value={metricValue("despesa_alugueis_mes") === null ? "—" : currency(metricValue("despesa_alugueis_mes") || 0, true)} helper={metricHelper("despesa_alugueis_mes")} icon={<WalletCards size={17} />} />
      </section>
      <section className="management-two-columns">
        <article className="management-panel"><div className="management-panel-head"><div><span>Aluguéis</span><h2>Imóveis disponíveis para locação</h2></div>{rentals ? <StatusPill tone="info">{rentals.rented_properties} alugados</StatusPill> : null}</div><TrendChart labels={months.map((month) => month.label)} series={[{ label: "Disponíveis", color: "#405343", values: availability }]} /></article>
        <article className="management-panel"><div className="management-panel-head"><div><span>Experiência</span><h2>NPS dos clientes</h2></div></div><TrendChart labels={months.map((month) => month.label)} series={[{ label: "NPS", color: "#405343", values: seriesFor("nps_clientes") }]} /></article>
      </section>
      <section className="management-two-columns management-score-row">
        <article className="management-score-card"><div><UsersRound size={21} /><span>Pesquisa de clima</span></div><strong>{displayNumber(metricValue("pesquisa_clima"))}<small>/10</small></strong><p>{metricHelper("pesquisa_clima", "duas medições por ano")}</p></article>
        <article className="management-panel"><div className="management-panel-head"><div><span>Clima organizacional</span><h2>Evolução das pesquisas</h2></div></div><TrendChart labels={months.map((month) => month.label)} series={[{ label: "Nota de clima", color: "#8a6f55", values: seriesFor("pesquisa_clima") }]} /></article>
      </section>
    </div>
  );
}

function NewBusinessView({ stages }: { stages: ManagementBusinessStageSnapshot[] }) {
  const orderedStages = BUSINESS_STAGES.map((definition) => ({
    ...definition,
    snapshot: stages.find((item) => item.stage === definition.key) || { stage: definition.key, area_count: 0, potential_vgv: 0, average_days: 0 },
  }));
  const totalAreas = orderedStages.reduce((sum, item) => sum + item.snapshot.area_count, 0);
  const totalVgv = orderedStages.reduce((sum, item) => sum + item.snapshot.potential_vgv, 0);
  const inWorks = orderedStages.find((item) => item.key === "obra")?.snapshot.area_count || 0;
  const weightedDays = totalAreas ? orderedStages.reduce((sum, item) => sum + item.snapshot.average_days * item.snapshot.area_count, 0) / totalAreas : 0;
  const maxVgv = Math.max(...orderedStages.map((item) => item.snapshot.potential_vgv), 1);
  return (
    <div className="management-view-stack">
      <section className="management-kpi-grid">
        <KpiCard label="Áreas no pipeline" value={String(totalAreas)} helper="negócios ativos no funil" icon={<BriefcaseBusiness size={17} />} />
        <KpiCard label="VGV potencial" value={currency(totalVgv, true)} helper="soma de todo o pipeline" icon={<CircleDollarSign size={17} />} />
        <KpiCard label="Conversão até obra" value={`${totalAreas ? (inWorks / totalAreas * 100).toFixed(0) : 0}%`} helper={`${inWorks} área(s) em obra`} tone="success" icon={<TrendingUp size={17} />} />
        <KpiCard label="Tempo médio por fase" value={`${weightedDays.toFixed(0)} dias`} helper="média ponderada do funil" icon={<Clock3 size={17} />} />
      </section>
      <section className="management-panel management-funnel-panel">
        <div className="management-panel-head"><div><span>Pipeline em tempo real</span><h2>Áreas versus VGV por etapa</h2><p>Os valores abaixo refletem diretamente o funil de Novos Negócios.</p></div><Link className="button button-secondary" href="/novos-negocios">Abrir operação <ArrowUpRight size={16} /></Link></div>
        <div className="management-funnel-list">
          {orderedStages.map((item, index) => (
            <article key={item.key}>
              <span className="management-funnel-number">{String(index + 1).padStart(2, "0")}</span>
              <div className="management-funnel-copy"><strong>{item.shortLabel}</strong><small>{item.snapshot.average_days.toFixed(0)} dias em média</small></div>
              <div className="management-funnel-bar"><span style={{ width: `${Math.max(item.snapshot.potential_vgv ? 5 : 0, item.snapshot.potential_vgv / maxVgv * 100)}%` }} /></div>
              <div className="management-funnel-values"><strong>{item.snapshot.area_count}</strong><span>área(s)</span></div>
              <div className="management-funnel-values management-funnel-vgv"><strong>{currency(item.snapshot.potential_vgv, true)}</strong><span>VGV</span></div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function EngineeringView({ constructions }: { constructions: ManagementConstructionSnapshot[] }) {
  const totalBudget = constructions.reduce((sum, item) => sum + item.planned_budget, 0);
  const totalRealized = constructions.reduce((sum, item) => sum + item.realized_total, 0);
  const physical = constructions.length ? constructions.reduce((sum, item) => sum + item.physical_progress, 0) / constructions.length : 0;
  const financial = totalBudget ? totalRealized / totalBudget * 100 : 0;
  return (
    <div className="management-view-stack">
      <section className="management-kpi-grid">
        <KpiCard label="Obras em andamento" value={String(constructions.length)} helper="portfólio em execução" icon={<HardHat size={17} />} />
        <KpiCard label="Orçamento previsto" value={currency(totalBudget, true)} helper="total das obras em andamento" icon={<CircleDollarSign size={17} />} />
        <KpiCard label="Evolução física média" value={`${physical.toFixed(0)}%`} helper="média simples do portfólio" tone="success" icon={<Gauge size={17} />} />
        <KpiCard label="Evolução financeira" value={`${financial.toFixed(0)}%`} helper={`${currency(totalRealized, true)} realizado`} icon={<WalletCards size={17} />} />
      </section>
      <section className="management-panel">
        <div className="management-panel-head"><div><span>Resumo operacional</span><h2>Obras em andamento</h2><p>Comparação entre orçamento, realizado e avanços físico e financeiro por obra.</p></div><Link className="button button-secondary" href="/obras">Abrir operação <ArrowUpRight size={16} /></Link></div>
        {constructions.length ? (
          <div className="management-work-list">
            {constructions.map((item) => (
              <article key={item.id}>
                <div className="management-work-title"><div><HardHat size={18} /></div><span><strong>{item.name}</strong><small>{currency(item.realized_total, true)} realizado de {currency(item.planned_budget, true)}</small></span></div>
                <div className="management-work-progress"><ProgressBar label="Evolução física" value={item.physical_progress} /><ProgressBar label="Evolução financeira" value={item.financial_progress} /></div>
                <div className="management-work-budget"><span>Orçamento</span><strong>{currency(item.planned_budget, true)}</strong></div>
              </article>
            ))}
          </div>
        ) : <div className="management-empty-panel management-empty-large"><HardHat size={23} /><strong>Nenhuma obra em andamento</strong><span>As obras com status “Em andamento” aparecerão aqui automaticamente.</span></div>}
      </section>
    </div>
  );
}
