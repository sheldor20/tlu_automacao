"use client";

import { MainNavigation } from "./main-navigation";
import { createRefreshScheduler } from "@/lib/refresh-scheduler";
import { getSupabase } from "@/lib/supabase";
import { initials } from "@/lib/format";
import { MANAGEMENT_AREAS } from "@/lib/constants";
import type { DepartmentSlug, ManagementAreaSlug } from "@/lib/types";
import {
  Building2,
  ChartNoAxesCombined,
  FolderKanban,
  GitBranch,
  Home,
  Landmark,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  NotebookTabs,
  TrendingUp,
  Wallet,
  Users,
  HandCoins,
  FileX2,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

// Keep the complete route-access registry, including modules omitted from the main menu.
const departmentLinks: Array<{
  slug: DepartmentSlug;
  href: string;
  label: string;
  icon: typeof TrendingUp;
}> = [
  { slug: "financeiro", href: "/financeiro", label: "Financeiro", icon: Wallet },
  { slug: "clientes", href: "/clientes", label: "Clientes", icon: Users },
  { slug: "distratos", href: "/distratos", label: "Distratos", icon: FileX2 },
  { slug: "cobranca", href: "/cobranca", label: "Cobrança", icon: HandCoins },
  { slug: "novos-negocios", href: "/novos-negocios", label: "Novos negócios", icon: TrendingUp },
  { slug: "obras", href: "/obras", label: "Obras", icon: Building2 },
  { slug: "projetos", href: "/projetos", label: "Projetos", icon: FolderKanban },
  { slug: "governanca", href: "/governanca", label: "Governança", icon: Landmark },
  { slug: "alugueis", href: "/alugueis", label: "Aluguéis", icon: Home },
  { slug: "processos", href: "/processos", label: "Processos", icon: GitBranch },
  { slug: "pauta-ra", href: "/pauta-ra", label: "Reuniões TLU", icon: NotebookTabs },
  { slug: "prestacao-contas", href: "/prestacao-contas", label: "Prestação de contas", icon: NotebookTabs },
  { slug: "indicadores", href: "/indicadores", label: "Indicadores", icon: ChartNoAxesCombined },
];

const adminLink = { href: "/administracao", label: "Administração", icon: ShieldCheck };
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = getSupabase();
  const [loading, setLoading] = useState(Boolean(supabase));
  const [accessError, setAccessError] = useState("");
  const [email, setEmail] = useState("");
  const [avatar, setAvatar] = useState("");
  const [profileRevision, setProfileRevision] = useState(0);
  const [fullName, setFullName] = useState("Usuário");
  const [allowedDepartments, setAllowedDepartments] = useState<DepartmentSlug[]>([]);
  const [allowedIndicatorAreas, setAllowedIndicatorAreas] = useState<ManagementAreaSlug[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [todayAlertCount, setTodayAlertCount] = useState(0);

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
    let active = true;
    const scheduler = createRefreshScheduler(async () => {
      try {
        const { data, error } = await supabase.rpc("current_user_today_alert_count");
        if (active) setTodayAlertCount(error ? 0 : Math.max(0, Number(data) || 0));
      } catch {
        if (active) setTodayAlertCount(0);
      }
    });
    const refreshCount = scheduler.schedule;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshCount();
    };
    refreshCount();
    window.addEventListener("focus", refreshCount);
    window.addEventListener("today-alert-count-changed", refreshCount);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      scheduler.dispose();
      window.removeEventListener("focus", refreshCount);
      window.removeEventListener("today-alert-count-changed", refreshCount);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loading, pathname, supabase]);

  useEffect(() => {
    const refresh = () => setProfileRevision(value => value + 1);
    window.addEventListener("personal-profile-changed", refresh);
    return () => window.removeEventListener("personal-profile-changed", refresh);
  }, []);

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
        const { data: access, error } = await supabase.rpc("current_user_app_access");
        if (!active) return;
        if (error || !access?.profile) {
          setAccessError("Não foi possível carregar as permissões. Tente atualizar a página.");
          setLoading(false);
          return;
        }
        const profileResult = { data: access.profile as { full_name: string | null; email: string | null; active: boolean; is_admin: boolean } };
        setAccessError("");
        if (!profileResult.data.active) {
          // External club profiles intentionally have no internal access.
          // Support auth links that fall back to the existing site/login route.
          try {
            const club = await fetch("/api/club?me=1", {
              headers: { Authorization: `Bearer ${data.session.access_token}` },
              cache: "no-store",
            });
            if (!active) return;
            if (club.ok) {
              router.replace("/clube-tlu");
              return;
            }
          } catch { /* Keep the existing deny-by-default internal access behavior. */ }
          await supabase.auth.signOut();
          router.replace("/login");
          return;
        }

        const administrator = Boolean(profileResult.data.is_admin);
        const assigned = administrator
          ? departmentLinks.map((link) => link.slug)
          : access.departments as DepartmentSlug[];
        const indicatorAreas = administrator
          ? MANAGEMENT_AREAS.map((area) => area.slug)
          : access.indicator_areas as ManagementAreaSlug[];
        const visibleLinks = departmentLinks.filter((link) => assigned.includes(link.slug));

        const avatarPath = user.user_metadata.avatar_path;
        if (typeof avatarPath === "string" && avatarPath.startsWith(`${user.id}/`)) {
          const signed = await supabase.storage.from("profile-avatars").createSignedUrl(avatarPath, 3600);
          if (!active) return;
          setAvatar(signed.data?.signedUrl || "");
        } else setAvatar("");
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
          router.replace(visibleLinks[0]?.href || (administrator ? adminLink.href : "/pagamentos"));
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
  }, [pathname, router, supabase, profileRevision]);

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

  if (accessError) {
    return (
      <div className="config-screen">
        <div className="config-card">
          <div className="brand-mark">TL</div>
          <h1>Permissões indisponíveis</h1>
          <p>{accessError}</p>
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

        <MainNavigation
          pathname={pathname}
          departments={allowedDepartments}
          indicatorAreas={allowedIndicatorAreas}
          isAdmin={isAdmin}
          todayAlertCount={todayAlertCount}
          collapsed={collapsed && !mobileMenu}
          onExpand={() => {
            setCollapsed(false);
            window.localStorage.setItem("terra-lotus-sidebar-collapsed", "false");
          }}
          onNavigate={() => setMobileMenu(false)}
          onSearchReveal={() => {
            setCollapsed(false);
            window.localStorage.setItem("terra-lotus-sidebar-collapsed", "false");
            if (window.matchMedia("(max-width: 780px)").matches) setMobileMenu(true);
          }}
        />
        <div className="side-user">
          <Link href="/perfil" className="user-avatar" aria-label="Editar meu perfil">{avatar ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} /> : initials(fullName)}</Link>
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
