"use client";

import { getSupabase } from "@/lib/supabase";
import { initials } from "@/lib/format";
import { MANAGEMENT_AREAS } from "@/lib/constants";
import type { DepartmentSlug, ManagementAreaSlug } from "@/lib/types";
import {
  Building2,
  ChartNoAxesCombined,
  CalendarDays,
  FolderKanban,
  Home,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  TrendingUp,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

const departmentLinks: Array<{
  slug: DepartmentSlug;
  href: string;
  label: string;
  icon: typeof TrendingUp;
}> = [
  { slug: "novos-negocios", href: "/novos-negocios", label: "Novos negócios", icon: TrendingUp },
  { slug: "obras", href: "/obras", label: "Obras", icon: Building2 },
  { slug: "projetos", href: "/projetos", label: "Projetos", icon: FolderKanban },
  { slug: "alugueis", href: "/alugueis", label: "Aluguéis", icon: Home },
  { slug: "indicadores", href: "/indicadores", label: "Indicadores", icon: ChartNoAxesCombined },
];

const adminLink = { href: "/administracao", label: "Administração", icon: ShieldCheck };
const todayLink = { href: "/hoje", label: "Hoje", icon: CalendarDays };
const indicatorsLink = departmentLinks.find((link) => link.slug === "indicadores")!;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = getSupabase();
  const [loading, setLoading] = useState(Boolean(supabase));
  const [accessError, setAccessError] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("Usuário");
  const [allowedDepartments, setAllowedDepartments] = useState<DepartmentSlug[]>([]);
  const [allowedIndicatorAreas, setAllowedIndicatorAreas] = useState<ManagementAreaSlug[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [todayAlertCount, setTodayAlertCount] = useState(0);

  const loadTodayAlertCount = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("current_user_today_alert_count");
    if (!error) setTodayAlertCount(Math.max(0, Number(data) || 0));
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => setCollapsed(window.localStorage.getItem("terra-lotus-sidebar-collapsed") === "true"), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setMobileMenu(false), 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    const mobileViewport = window.matchMedia("(max-width: 780px)");
    const closeWhenLeavingMobile = (event: MediaQueryListEvent) => {
      if (!event.matches) setMobileMenu(false);
    };
    mobileViewport.addEventListener("change", closeWhenLeavingMobile);
    return () => mobileViewport.removeEventListener("change", closeWhenLeavingMobile);
  }, []);

  useEffect(() => {
    if (!mobileMenu) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenu(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileMenu]);

  useEffect(() => {
    if (!supabase || loading) return;
    const refreshCount = () => void loadTodayAlertCount();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshCount();
    };
    refreshCount();
    window.addEventListener("focus", refreshCount);
    window.addEventListener("today-alert-count-changed", refreshCount);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshCount);
      window.removeEventListener("today-alert-count-changed", refreshCount);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loading, loadTodayAlertCount, pathname, supabase]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("terra-lotus-sidebar-collapsed", String(next));
      return next;
    });
  }

  useEffect(() => {
    if (!supabase) {
      return;
    }
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (!data.session) {
        router.replace("/login");
      } else {
        const user = data.session.user;
        const [profileResult, departmentResult, indicatorAreaResult] = await Promise.all([
          supabase
            .from("profiles")
            .select("full_name,email,active,is_admin")
            .eq("user_id", user.id)
            .single(),
          supabase
            .from("profile_departments")
            .select("department_slug")
            .eq("user_id", user.id),
          supabase
            .from("profile_indicator_areas")
            .select("area")
            .eq("user_id", user.id),
        ]);
        if (!active) return;
        if (profileResult.error || departmentResult.error || indicatorAreaResult.error || !profileResult.data) {
          setAccessError("Não foi possível carregar as permissões. Confirme se a migration mais recente foi executada no Supabase.");
          setLoading(false);
          return;
        }
        if (!profileResult.data.active) {
          await supabase.auth.signOut();
          router.replace("/login");
          return;
        }

        const administrator = Boolean(profileResult.data.is_admin);
        const assigned = administrator
          ? departmentLinks.map((link) => link.slug)
          : (departmentResult.data || []).map((item) => item.department_slug as DepartmentSlug);
        const indicatorAreas = administrator
          ? MANAGEMENT_AREAS.map((area) => area.slug)
          : (indicatorAreaResult.data || []).map((item) => item.area as ManagementAreaSlug);
        const visibleLinks = departmentLinks.filter((link) => assigned.includes(link.slug));

        setEmail(profileResult.data.email || user.email || "Usuário");
        setFullName(profileResult.data.full_name || profileResult.data.email?.split("@")[0] || "Usuário");
        setAllowedDepartments(assigned);
        setAllowedIndicatorAreas(indicatorAreas);
        setIsAdmin(administrator);

        const currentDepartment = departmentLinks.find((link) => pathname.startsWith(link.href));
        const blockedDepartment = currentDepartment && !assigned.includes(currentDepartment.slug);
        const requestedIndicatorArea = pathname.startsWith("/indicadores/")
          ? pathname.split("/")[2] as ManagementAreaSlug
          : null;
        const blockedIndicatorArea = requestedIndicatorArea && !indicatorAreas.includes(requestedIndicatorArea);
        const blockedAdmin = pathname.startsWith(adminLink.href) && !administrator;
        if (blockedIndicatorArea && assigned.includes("indicadores") && indicatorAreas.length) {
          router.replace(`/indicadores/${indicatorAreas[0]}`);
        } else if (blockedDepartment || blockedAdmin) {
          router.replace(visibleLinks[0]?.href || (administrator ? adminLink.href : "/login"));
        }
        setLoading(false);
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace("/login");
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [pathname, router, supabase]);

  const visibleDepartmentLinks = departmentLinks.filter((link) => link.slug !== "indicadores" && allowedDepartments.includes(link.slug));
  const showIndicators = allowedDepartments.includes("indicadores") && allowedIndicatorAreas.length > 0;
  const resolvedIndicatorsLink = { ...indicatorsLink, href: `/indicadores/${allowedIndicatorAreas[0] || "empresa"}` };
  async function signOut() {
    await supabase?.auth.signOut();
    router.replace("/login");
  }

  if (loading) {
    return (
      <div className="full-loader">
        <div className="brand-mark">TL</div>
        <span>Preparando seu ambiente…</span>
      </div>
    );
  }

  if (!supabase) {
    return (
      <div className="config-screen">
        <div className="config-card">
          <div className="brand-mark">TL</div>
          <h1>Conecte o Supabase</h1>
          <p>
            Configure <code>NEXT_PUBLIC_SUPABASE_URL</code> e
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> no Vercel para acessar o sistema.
          </p>
        </div>
      </div>
    );
  }

  if (accessError || (allowedDepartments.length === 0 && !isAdmin)) {
    return (
      <div className="config-screen">
        <div className="config-card">
          <div className="brand-mark">TL</div>
          <h1>{accessError ? "Permissões indisponíveis" : "Acesso pendente"}</h1>
          <p>{accessError || "Seu usuário ainda não recebeu acesso a nenhum departamento. Solicite a liberação ao administrador."}</p>
          <button className="button button-secondary" onClick={signOut}>Sair do sistema</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-frame${collapsed ? " app-frame-collapsed" : ""}`}>
      <main className="app-main"><div className="app-content">{children}</div></main>

      <button
        type="button"
        className="mobile-menu-button"
        onClick={() => setMobileMenu((value) => !value)}
        aria-label={mobileMenu ? "Fechar menu" : "Abrir menu"}
        aria-expanded={mobileMenu}
        aria-controls="main-side-navigation"
      >
        {mobileMenu ? <X size={22} /> : <Menu size={22} />}
        <span>{mobileMenu ? "Fechar" : "Menu"}</span>
      </button>

      {mobileMenu ? <button type="button" className="mobile-menu-backdrop" onClick={() => setMobileMenu(false)} aria-label="Fechar menu de navegação" /> : null}

      <aside id="main-side-navigation" className={`side-nav ${mobileMenu ? "side-nav-open" : ""}`}>
        <button type="button" className="side-collapse-button" onClick={toggleCollapsed} aria-label={collapsed ? "Expandir menu" : "Recolher menu"} title={collapsed ? "Expandir menu" : "Recolher menu"}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
        <div className="side-brand">
          <Image
            src="/logo-terra-lotus.png"
            alt="Terra Lótus Urbanismo"
            width={184}
            height={68}
            priority
          />
          <span>Gestão integrada</span>
        </div>

        <nav aria-label="Departamentos">
          <span className="nav-caption">Operação</span>
          <Link
            href={todayLink.href}
            className={pathname.startsWith(todayLink.href) ? "nav-link active" : "nav-link"}
            title={todayLink.label}
            onClick={() => setMobileMenu(false)}
          >
            <CalendarDays size={19} />
            <span>{todayLink.label}</span>
            {todayAlertCount > 0 ? <span className="nav-alert-badge" aria-label={`${todayAlertCount} alertas pendentes`}>{todayAlertCount > 99 ? "99+" : todayAlertCount}</span> : null}
          </Link>
          {showIndicators ? (
            <Link
              href={resolvedIndicatorsLink.href}
              className={pathname.startsWith("/indicadores") ? "nav-link active" : "nav-link"}
              title="Indicadores"
              onClick={() => setMobileMenu(false)}
            >
              <ChartNoAxesCombined size={19} />
              <span>Indicadores</span>
            </Link>
          ) : null}
          <span className="nav-caption nav-caption-spaced">Departamentos</span>
          {visibleDepartmentLinks.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={active ? "nav-link active" : "nav-link"}
                title={label}
                onClick={() => setMobileMenu(false)}
              >
                <Icon size={19} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        {isAdmin ? (
          <nav className="admin-nav" aria-label="Administração">
            <span className="nav-caption">Sistema</span>
            <Link
              href={adminLink.href}
              className={pathname.startsWith(adminLink.href) ? "nav-link active" : "nav-link"}
              title={adminLink.label}
              onClick={() => setMobileMenu(false)}
            >
              <ShieldCheck size={19} />
              <span>{adminLink.label}</span>
            </Link>
          </nav>
        ) : null}

        <div className="side-user">
          <div className="user-avatar">{initials(fullName)}</div>
          <div className="user-meta">
            <strong>{fullName}</strong>
            <span>{email}</span>
          </div>
          <button onClick={signOut} aria-label="Sair do sistema" title="Sair">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

    </div>
  );
}
