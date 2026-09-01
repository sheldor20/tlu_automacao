"use client";

import { GroupedBarChart, TrendChart } from "@/components/management-charts";
import { Button, KpiCard, ProgressBar, StatusPill } from "@/components/ui";
import { BUSINESS_STAGES, MANAGEMENT_AREAS } from "@/lib/constants";
import { currency } from "@/lib/format";
import { sumMetricSeries } from "@/lib/management-metrics";
import { monthsThroughLastClosed, previousClosedMonth } from "@/lib/management-period";
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
  Camera,
  CircleDollarSign,
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
    description: "Imóveis disponíveis, clima organizacional, audiência e experiência dos clientes.",
    icon: UsersRound,
  },
  {
    slug: "financas-compras",
    label: "Finanças e Compras",
    shortLabel: "Finanças e Compras",
    eyebrow: "Controle financeiro",
    description: "Aluguéis, custo evitado e qualidade do processo de compras acompanhados mês a mês.",
    icon: WalletCards,
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

const validAreas = new Set(managementAreas.map((area) => area.slug));
const monthFormatter = new Intl.DateTimeFormat("pt-BR", { month: "short" });
const competenceFormatter = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric" });
const referenceDateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

function monthDate(key: string) {
  return new Date(`${key.slice(0, 10)}T12:00:00`);
}

function buildCurrentYearMonths(year: number) {
  const currentMonth = new Date().getMonth();
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(year, index, 1, 12);
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`,
      label: monthFormatter.format(date).replace(".", ""),
      isCurrent: index === currentMonth,
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
    <details className="management-breakdown-collapsible">
      <summary><span>Ver composição completa</span><strong>{items.length} conta(s)</strong></summary>
      <div className="management-breakdown-list">
        {items.map((item) => (
          <div key={item.label}>
            <div><span>{item.label}</span><strong>{currency(item.value, true)}</strong></div>
            <div className="management-breakdown-track"><span style={{ width: `${Math.max(2, item.value / maximum * 100)}%` }} /></div>
          </div>
        ))}
      </div>
    </details>
  );
}

export function ManagementDashboard({ area }: { area: ManagementAreaSlug }) {
  const supabase = getSupabase();
  const [values, setValues] = useState<ManagementIndicatorValue[]>([]);
  const [businessStages, setBusinessStages] = useState<ManagementBusinessStageSnapshot[]>([]);
  const [constructions, setConstructions] = useState<ManagementConstructionSnapshot[]>([]);
  const [rentalSnapshot, setRentalSnapshot] = useState<ManagementRentalSnapshot | null>(null);
  const [authorizedAreas, setAuthorizedAreas] = useState<ManagementAreaSlug[] | null>(null);
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
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const months = useMemo(() => buildCurrentYearMonths(currentYear), [currentYear]);

  const loadData = useCallback(async (background = false) => {
    if (!supabase) return;
    if (background) setRefreshing(true);
    else setLoading(true);
    setError("");

    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setError("Sua sessão expirou. Entre novamente.");
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const [profileResult, accessResult] = await Promise.all([
      supabase.from("profiles").select("is_admin").eq("user_id", authData.user.id).single(),
      supabase.from("profile_indicator_areas").select("area").eq("user_id", authData.user.id),
    ]);
    if (profileResult.error || accessResult.error) {
      setError(friendlyError(profileResult.error || accessResult.error));
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const permittedAreas = profileResult.data?.is_admin
      ? MANAGEMENT_AREAS.map((item) => item.slug)
      : (accessResult.data || []).map((item) => item.area as ManagementAreaSlug);
    setAuthorizedAreas(permittedAreas);
    if (!permittedAreas.includes(area)) {
      setError("Esta visão de Indicadores não está liberada para o seu usuário.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const [valueResult, businessResult, constructionResult, rentalResult] = await Promise.all([
      supabase
        .from("management_indicator_values")
        .select("*")
        .eq("area", area)
        .gte("reference_month", ["empresa", "financas-compras", "juridico-vendas-cobranca"].includes(area) ? `${currentYear - 1}-12-01` : `${currentYear}-01-01`)
        .lt("reference_month", `${currentYear + 1}-01-01`)
        .order("reference_month", { ascending: true }),
      area === "novos-negocios" ? supabase.rpc("management_business_funnel_snapshot") : Promise.resolve({ data: [], error: null }),
      area === "obras-engenharia" ? supabase.rpc("management_construction_snapshot") : Promise.resolve({ data: [], error: null }),
      area === "rh-marketing-clientes" ? supabase.rpc("management_rental_snapshot") : Promise.resolve({ data: [], error: null }),
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
  }, [area, currentYear, supabase]);

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

  function metricValueForMonth(metricKey: string, referenceMonth: string) {
    return areaValues.find((item) => item.metric_key === metricKey && item.dimension_key === "total" && item.reference_month === referenceMonth)?.value ?? null;
  }

  function metricHelper(metricKey: string, fallback = "aguardando primeira carga") {
    const metric = latestMetric(metricKey);
    const referenceDate = (metric?.metadata?.selections as Record<string, unknown> | undefined)?.reference_date;
    if (metric && typeof referenceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
      return `posição em ${referenceDateFormatter.format(new Date(`${referenceDate}T12:00:00`))}`;
    }
    return metric ? `competência ${competenceFormatter.format(monthDate(metric.reference_month))}` : fallback;
  }

  function metricHelperForMonth(metricKey: string, referenceMonth: string, fallback = "aguardando primeira carga") {
    const metric = areaValues.find((item) => (
      item.metric_key === metricKey
      && item.dimension_key === "total"
      && item.reference_month === referenceMonth
    ));
    const referenceDate = (metric?.metadata?.selections as Record<string, unknown> | undefined)?.reference_date;
    if (metric && typeof referenceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
      return `posição em ${referenceDateFormatter.format(new Date(`${referenceDate}T12:00:00`))}`;
    }
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

  if (!currentArea || !validAreas.has(area)) {
    return <section className="management-setup-error"><h1>Visão não encontrada</h1><p>Escolha uma das áreas disponíveis no painel de indicadores.</p><Link className="button button-primary" href="/indicadores/empresa">Abrir Empresa</Link></section>;
  }

  if (!loading && authorizedAreas && !authorizedAreas.includes(area)) {
    const firstArea = authorizedAreas[0];
    return <section className="management-setup-error"><h1>Visão sem acesso</h1><p>Solicite esta visão ao administrador ou abra uma das áreas já liberadas.</p>{firstArea ? <Link className="button button-primary" href={`/indicadores/${firstArea}`}>Abrir visão autorizada</Link> : <Link className="button button-primary" href="/hoje">Voltar para Hoje</Link>}</section>;
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
        {managementAreas.filter((item) => authorizedAreas?.includes(item.slug)).map((item) => {
          const Icon = item.icon;
          return <Link key={item.slug} href={`/indicadores/${item.slug}`} className={item.slug === area ? "active" : ""}><Icon size={17} /><span>{item.shortLabel}</span></Link>;
        })}
      </nav>

      <header className="management-header">
        <div className="management-title-icon"><CurrentIcon size={24} /></div>
        <div className="management-title-copy">
          <span>{currentArea.eyebrow} · Ano {currentYear}</span>
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
          {area === "empresa" ? <CompanyView metricValue={metricValue} metricValueForMonth={metricValueForMonth} metricHelper={metricHelper} seriesFor={seriesFor} months={months} revenueBreakdown={latestBreakdown("receita_plano_contas")} expenseBreakdown={latestBreakdown("despesa_plano_contas")} /> : null}
          {area === "juridico-vendas-cobranca" ? <LegalSalesView metricValue={metricValue} metricValueForMonth={metricValueForMonth} metricHelper={metricHelper} metricHelperForMonth={metricHelperForMonth} seriesFor={seriesFor} months={months} /> : null}
          {area === "rh-marketing-clientes" ? <PeopleClientsView metricValue={metricValue} metricValueForMonth={metricValueForMonth} metricHelper={metricHelper} seriesFor={seriesFor} months={months} rentals={rentalSnapshot} /> : null}
          {area === "financas-compras" ? <FinancePurchasingView metricValue={metricValue} metricValueForMonth={metricValueForMonth} metricHelper={metricHelper} seriesFor={seriesFor} months={months} /> : null}
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
  metricValueForMonth: (key: string, referenceMonth: string) => number | null;
  metricHelper: (key: string, fallback?: string) => string;
  seriesFor: (key: string) => Array<number | null>;
  months: Array<{ key: string; label: string; isCurrent: boolean }>;
};

function CompanyView({ metricValue, metricValueForMonth, metricHelper, seriesFor, months, revenueBreakdown, expenseBreakdown }: MetricViewProps & { revenueBreakdown: Array<{ label: string; value: number }>; expenseBreakdown: Array<{ label: string; value: number }> }) {
  const revenueSeries = seriesFor("receita_consolidada");
  const expenseSeries = seriesFor("despesa_consolidada");
  const sumSeries = (series: Array<number | null>) => {
    const values = series.filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  const revenue = sumSeries(revenueSeries);
  const expense = sumSeries(expenseSeries);
  const reportedResult = metricValue("resultado_gerencial");
  const latestRevenue = metricValue("receita_consolidada");
  const latestExpense = metricValue("despesa_consolidada");
  const result = reportedResult ?? (latestRevenue !== null && latestExpense !== null ? latestRevenue - latestExpense : null);
  const previousMonth = previousClosedMonth(months, Number(months[0]?.key.slice(0, 4) || new Date().getFullYear()));
  const previousRevenue = previousMonth ? metricValueForMonth("receita_consolidada", previousMonth.key) : null;
  const previousExpense = previousMonth ? metricValueForMonth("despesa_consolidada", previousMonth.key) : null;
  const previousResult = previousMonth ? metricValueForMonth("resultado_gerencial", previousMonth.key) ?? (previousRevenue !== null && previousExpense !== null ? previousRevenue - previousExpense : null) : null;
  const closedMonths = monthsThroughLastClosed(months);
  const chartMonths = closedMonths.length ? closedMonths : [previousMonth];
  const chartRevenue = chartMonths.map((month) => metricValueForMonth("receita_consolidada", month.key));
  const chartExpenses = chartMonths.map((month) => metricValueForMonth("despesa_consolidada", month.key));
  const chartResult = chartMonths.map((month, index) => {
    const reported = metricValueForMonth("resultado_gerencial", month.key);
    const revenueValue = chartRevenue[index];
    const expenseValue = chartExpenses[index];
    return reported ?? (revenueValue !== null && expenseValue !== null ? revenueValue - expenseValue : null);
  });
  const chartCash = chartMonths.map((month) => metricValueForMonth("valor_caixa", month.key));
  const cash = metricValue("valor_caixa");
  const availableCash = metricValue("caixa_disponivel");
  const rentalCash = cash !== null && availableCash !== null ? cash - availableCash : null;
  return (
    <div className="management-view-stack">
      <section className="management-kpi-grid">
        <KpiCard label="Receita consolidada" value={revenue === null ? "—" : currency(revenue, true)} helper="acumulado no ano vigente" icon={<BadgeDollarSign size={17} />} />
        <KpiCard label="Despesas consolidadas" value={expense === null ? "—" : currency(expense, true)} helper="acumulado no ano vigente" icon={<WalletCards size={17} />} />
        <KpiCard label="Resultado gerencial" value={result === null ? "—" : currency(result, true)} helper={reportedResult === null && result !== null ? "calculado por receita menos despesas" : metricHelper("resultado_gerencial")} tone={result !== null && result >= 0 ? "success" : result === null ? "default" : "warning"} icon={<BarChart3 size={17} />} />
        <KpiCard
          label="Valor total em caixa"
          value={cash === null ? "—" : currency(cash)}
          helper={cash === null || rentalCash === null || availableCash === null
            ? "aguardando o saldo da conta de aluguéis para calcular o disponível"
            : <span className="management-cash-helper">
                <span>Disponível para uso: <strong>{currency(availableCash)}</strong></span>
                <span>{currency(cash)} total − {currency(rentalCash)} aluguéis · {metricHelper("valor_caixa")}</span>
              </span>}
          icon={<Landmark size={17} />}
          className="management-kpi-full-money management-cash-total-card"
        />
      </section>
      <section className="management-closed-month-summary">
        <div><span>Fechamento · {previousMonth?.label || "mês anterior"}</span><strong>Resultado do mês anterior</strong></div>
        <article><span>Receita</span><strong>{previousRevenue === null ? "—" : currency(previousRevenue)}</strong></article>
        <article><span>Despesa</span><strong>{previousExpense === null ? "—" : currency(previousExpense)}</strong></article>
        <article className={previousResult !== null && previousResult < 0 ? "negative" : "positive"}><span>Resultado</span><strong>{previousResult === null ? "—" : currency(previousResult)}</strong></article>
      </section>
      <section className="management-two-columns">
        <article className="management-panel management-panel-wide"><div className="management-panel-head"><div><span>Histórico até {previousMonth.label}</span><h2>Receitas e despesas</h2><p>Todos os meses até o último fechamento.</p></div></div><GroupedBarChart labels={chartMonths.map((month) => month.label)} series={[{ label: "Receitas", color: "#405343", values: chartRevenue }, { label: "Despesas", color: "#b3875b", values: chartExpenses }]} /></article>
        <article className="management-panel"><div className="management-panel-head"><div><span>Histórico até {previousMonth.label}</span><h2>Resultado gerencial e caixa</h2><p>Todos os meses até o último fechamento.</p></div></div><TrendChart labels={chartMonths.map((month) => month.label)} series={[{ label: "Resultado", color: "#405343", values: chartResult }, { label: "Caixa", color: "#8aa083", values: chartCash }]} /></article>
      </section>
      <section className="management-two-columns">
        <article className="management-panel"><div className="management-panel-head"><div><span>Composição</span><h2>Receitas por plano de contas</h2></div></div><BreakdownList items={revenueBreakdown} emptyLabel="As contas de receita aparecerão após a primeira carga." /></article>
        <article className="management-panel"><div className="management-panel-head"><div><span>Composição</span><h2>Despesas por plano de contas</h2></div></div><BreakdownList items={expenseBreakdown} emptyLabel="As contas de despesa aparecerão após a primeira carga." /></article>
      </section>
    </div>
  );
}

function LegalSalesView({ metricValue, metricValueForMonth, metricHelper, metricHelperForMonth, months }: MetricViewProps & {
  metricHelperForMonth: (key: string, referenceMonth: string, fallback?: string) => string;
}) {
  const closedMonth = previousClosedMonth(months, Number(months[0]?.key.slice(0, 4) || new Date().getFullYear()));
  const closedMonthIndex = months.findIndex((month) => month.key === closedMonth.key);
  const chartMonths = closedMonthIndex >= 0 ? months.slice(0, closedMonthIndex + 1) : [closedMonth];
  const closedValue = (key: string) => metricValueForMonth(key, closedMonth.key);
  const closedHelper = (key: string) => metricHelperForMonth(key, closedMonth.key, `aguardando fechamento de ${closedMonth.label}`);
  const closedSeries = (key: string) => chartMonths.map((month) => metricValueForMonth(key, month.key));
  const sales = closedValue("vendas_mes");
  const cancellations = closedValue("distratos_mes");
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
        <KpiCard label="Unidades disponíveis" value={displayNumber(closedValue("unidades_disponiveis"))} helper={closedHelper("unidades_disponiveis")} icon={<Building2 size={17} />} />
        <KpiCard label="Vendas no mês" value={displayNumber(sales)} helper={cancellations === null ? closedHelper("vendas_mes") : `${displayNumber(cancellations)} distrato(s) · fechamento ${closedMonth.label}`} icon={<ShoppingCart size={17} />} />
      </section>
      <section className="management-two-columns">
        <article className="management-panel"><div className="management-panel-head"><div><span>Cobrança</span><h2>Eficiência mês a mês</h2></div></div><TrendChart labels={chartMonths.map((month) => month.label)} series={[{ label: "Eficiência (%)", color: "#405343", values: closedSeries("eficiencia_cobranca") }]} /></article>
        <article className="management-panel"><div className="management-panel-head"><div><span>Comercial</span><h2>Vendas, estoque e distratos</h2><p>Histórico até o último mês fechado · {closedMonth.label}.</p></div></div><GroupedBarChart labels={chartMonths.map((month) => month.label)} series={[{ label: "Disponíveis", color: "#9aab95", values: closedSeries("unidades_disponiveis") }, { label: "Vendas", color: "#405343", values: closedSeries("vendas_mes") }, { label: "Distratos", color: "#b96c62", values: closedSeries("distratos_mes") }]} /></article>
      </section>
      <section className="management-panel">
        <div className="management-panel-head"><div><span>Pós-vendas e jurídico</span><h2>Tração das unidades quitadas</h2><p>Posições no último dia útil disponível de cada mês, até o fechamento de {closedMonth.label}.</p></div></div>
        <div className="management-stage-kpis">{deedMetrics.map(([label, key]) => <article key={key}><span>{label}</span><strong>{displayNumber(closedValue(key))}</strong><small>{closedHelper(key)}</small></article>)}</div>
        <GroupedBarChart labels={chartMonths.map((month) => month.label)} series={[{ label: "Sem processo", color: "#b96c62", values: closedSeries("unidades_sem_processo") }, { label: "Autorizadas", color: "#405343", values: closedSeries("unidades_autorizadas_escrituracao") }]} />
      </section>
    </div>
  );
}

function PeopleClientsView({ metricValue, metricValueForMonth, metricHelper, months, rentals }: MetricViewProps & { rentals: ManagementRentalSnapshot | null }) {
  const chartMonths = monthsThroughLastClosed(months);
  const closedSeries = (key: string) => chartMonths.map((month) => metricValueForMonth(key, month.key));
  return (
    <div className="management-view-stack management-people-view">
      <section className="management-kpi-grid management-people-kpis">
        <KpiCard label="Imóveis desocupados" value={rentals ? String(rentals.available_properties) : "—"} helper={rentals ? `${rentals.total_properties} imóveis na carteira` : "aguardando base de aluguéis"} icon={<Building2 size={17} />} />
        <KpiCard label="Pesquisa de clima" value={metricValue("pesquisa_clima") === null ? "—" : `${displayNumber(metricValue("pesquisa_clima"))}/10`} helper={metricHelper("pesquisa_clima", "duas medições por ano")} icon={<UsersRound size={17} />} />
        <KpiCard label="Seguidores no Instagram" value={displayNumber(metricValue("instagram_seguidores"))} helper={metricHelper("instagram_seguidores", "aguardando integração do Instagram")} tone="success" icon={<Camera size={17} />} />
      </section>
      <section className="management-two-columns">
        <article className="management-panel"><div className="management-panel-head"><div><span>Aluguéis</span><h2>Imóveis disponíveis para locação</h2><p>Histórico até o último mês fechado.</p></div>{rentals ? <StatusPill tone="info">{rentals.rented_properties} alugados</StatusPill> : null}</div><TrendChart labels={chartMonths.map((month) => month.label)} series={[{ label: "Disponíveis", color: "#405343", values: closedSeries("imoveis_disponiveis") }]} /></article>
        <article className="management-panel"><div className="management-panel-head"><div><span>Experiência</span><h2>NPS médio dos clientes</h2><p>Média mensal da pergunta de recomendação, escala 0–5, até o último mês fechado.</p></div></div><TrendChart labels={chartMonths.map((month) => month.label)} series={[{ label: "Média NPS (0–5)", color: "#405343", values: closedSeries("nps_clientes") }]} fixedRange={{ min: 0, max: 5 }} /></article>
      </section>
    </div>
  );
}

function FinancePurchasingView({ metricValueForMonth, months }: MetricViewProps) {
  const chartMonths = monthsThroughLastClosed(months);
  const closedSeries = (key: string) => chartMonths.map((month) => metricValueForMonth(key, month.key));
  const rentalRevenue = closedSeries("receita_alugueis_mes");
  const rentalExpense = closedSeries("despesa_alugueis_mes");
  const avoidedCostSeries = closedSeries("custo_evitado_total");
  const avoidedCostTotal = sumMetricSeries(avoidedCostSeries);
  const rentalResult = chartMonths.map((_, index) => {
    const revenue = rentalRevenue[index];
    const expense = rentalExpense[index];
    return revenue !== null && expense !== null ? revenue - expense : null;
  });
  const closedMonth = previousClosedMonth(months, Number(months[0]?.key.slice(0, 4) || new Date().getFullYear()));
  const closedValue = (key: string) => closedMonth ? metricValueForMonth(key, closedMonth.key) : null;
  const closedHelper = closedMonth ? `mês fechado · ${closedMonth.label}` : "mês anterior fechado";
  return (
    <div className="management-view-stack management-finance-view">
      <section className="management-kpi-grid">
        <KpiCard label="Saldo da conta de aluguéis" value={closedValue("saldo_conta_alugueis") === null ? "—" : currency(closedValue("saldo_conta_alugueis") || 0, true)} helper={closedHelper} icon={<Landmark size={17} />} />
        <KpiCard label="Recebido no mês (Aluguel)" value={closedValue("receita_alugueis_mes") === null ? "—" : currency(closedValue("receita_alugueis_mes") || 0, true)} helper={closedHelper} tone="success" icon={<BadgeDollarSign size={17} />} />
        <KpiCard label="Gasto no mês (Aluguel)" value={closedValue("despesa_alugueis_mes") === null ? "—" : currency(closedValue("despesa_alugueis_mes") || 0, true)} helper={closedHelper} icon={<WalletCards size={17} />} />
        <KpiCard label="Custo evitado total" value={avoidedCostTotal === null ? "—" : currency(avoidedCostTotal)} helper="soma de todo o valor evitado no ano vigente" tone="success" icon={<HandCoins size={17} />} className="management-kpi-full-money" />
      </section>
      <section className="management-three-columns">
        <article className="management-panel"><div className="management-panel-head"><div><span>Economia gerada</span><h2>Custo evitado mês a mês</h2><p>Valor apurado até o último mês fechado.</p></div></div><TrendChart labels={chartMonths.map((month) => month.label)} series={[{ label: "Custo evitado", color: "#405343", values: avoidedCostSeries }]} /></article>
        <article className="management-panel"><div className="management-panel-head"><div><span>Resultado dos aluguéis</span><h2>Recebido menos gasto</h2><p>Resultado líquido mensal até o último mês fechado.</p></div></div><TrendChart labels={chartMonths.map((month) => month.label)} series={[{ label: "Resultado", color: "#6f876e", values: rentalResult }]} /></article>
        <article className="management-panel"><div className="management-panel-head"><div><span>Conformidade de compras</span><h2>Compras sem orçamento</h2><p>Total de compras e compras sem orçamento até o último mês fechado.</p></div></div><GroupedBarChart labels={chartMonths.map((month) => month.label)} series={[{ label: "Total de compras", color: "#8da087", values: closedSeries("compras_total") }, { label: "Sem orçamento", color: "#b96c62", values: closedSeries("compras_sem_orcamento") }]} /></article>
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
  const maxVgv = Math.max(...orderedStages.map((item) => item.snapshot.potential_vgv), 1);
  return (
    <div className="management-view-stack">
      <section className="management-kpi-grid management-kpi-grid-two">
        <KpiCard label="Áreas no pipeline" value={String(totalAreas)} helper="negócios ativos no funil" icon={<BriefcaseBusiness size={17} />} />
        <KpiCard label="VGV potencial" value={currency(totalVgv, true)} helper="soma de todo o pipeline" icon={<CircleDollarSign size={17} />} />
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
                <div className="management-work-title"><div><HardHat size={18} /></div><span><strong>{item.name}</strong><small>Acompanhamento físico e financeiro</small></span></div>
                <div className="management-work-progress"><ProgressBar label="Evolução física" value={item.physical_progress} /><ProgressBar label="Evolução financeira" value={item.financial_progress} /></div>
                <div className="management-work-budget">
                  <div className={item.realized_total > item.planned_budget ? "is-over-budget" : ""}><span>Orçamento</span><strong>{currency(item.planned_budget, true)}</strong></div>
                  <div><span>Realizado</span><strong>{currency(item.realized_total, true)}</strong></div>
                </div>
              </article>
            ))}
          </div>
        ) : <div className="management-empty-panel management-empty-large"><HardHat size={23} /><strong>Nenhuma obra em andamento</strong><span>As obras com status “Em andamento” aparecerão aqui automaticamente.</span></div>}
      </section>
    </div>
  );
}
