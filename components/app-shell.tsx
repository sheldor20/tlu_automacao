"use client";

import { getSupabase } from "@/lib/supabase";
import { initials } from "@/lib/format";
import type { DepartmentSlug } from "@/lib/types";
import {
  Building2,
  CalendarDays,
  FolderKanban,
  Home,
  LogOut,
  Menu,
  ShieldCheck,
  TrendingUp,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

const departmentLinks: Array<{
  slug: DepartmentSlug;
  href: string;
  label: string;
  mobileLabel: string;
  icon: typeof TrendingUp;
}> = [
  { slug: "novos-negocios", href: "/novos-negocios", label: "Novos negócios", mobileLabel: "Negócios", icon: TrendingUp },
  { slug: "obras", href: "/obras", label: "Obras", mobileLabel: "Obras", icon: Building2 },
  { slug: "projetos", href: "/projetos", label: "Projetos", mobileLabel: "Projetos", icon: FolderKanban },
  { slug: "alugueis", href: "/alugueis", label: "Aluguéis", mobileLabel: "Aluguéis", icon: Home },
];

const adminLink = { href: "/administracao", label: "Administração", mobileLabel: "Acessos", icon: ShieldCheck };
const todayLink = { href: "/hoje", label: "Hoje", mobileLabel: "Hoje", icon: CalendarDays };

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = getSupabase();
  const [loading, setLoading] = useState(Boolean(supabase));
  const [accessError, setAccessError] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("Usuário");
  const [allowedDepartments, setAllowedDepartments] = useState<DepartmentSlug[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);

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
        const [profileResult, departmentResult] = await Promise.all([
          supabase
            .from("profiles")
            .select("full_name,email,active,is_admin")
            .eq("user_id", user.id)
            .single(),
          supabase
            .from("profile_departments")
            .select("department_slug")
            .eq("user_id", user.id),
        ]);
        if (!active) return;
        if (profileResult.error || !profileResult.data) {
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
        const visibleLinks = departmentLinks.filter((link) => assigned.includes(link.slug));

        setEmail(profileResult.data.email || user.email || "Usuário");
        setFullName(profileResult.data.full_name || profileResult.data.email?.split("@")[0] || "Usuário");
        setAllowedDepartments(assigned);
        setIsAdmin(administrator);

        const currentDepartment = departmentLinks.find((link) => pathname.startsWith(link.href));
        const blockedDepartment = currentDepartment && !assigned.includes(currentDepartment.slug);
        const blockedAdmin = pathname.startsWith(adminLink.href) && !administrator;
        if (blockedDepartment || blockedAdmin) {
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

  const visibleDepartmentLinks = departmentLinks.filter((link) => allowedDepartments.includes(link.slug));
  const visibleLinks = isAdmin ? [todayLink, ...visibleDepartmentLinks, adminLink] : [todayLink, ...visibleDepartmentLinks];

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

  if (accessError || (visibleDepartmentLinks.length === 0 && !isAdmin)) {
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
    <div className="app-frame">
      <main className="app-main"><div className="app-content">{children}</div></main>

      <button
        className="mobile-menu-button"
        onClick={() => setMobileMenu((value) => !value)}
        aria-label={mobileMenu ? "Fechar menu" : "Abrir menu"}
      >
        {mobileMenu ? <X size={22} /> : <Menu size={22} />}
      </button>

      <aside className={`side-nav ${mobileMenu ? "side-nav-open" : ""}`}>
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
            onClick={() => setMobileMenu(false)}
          >
            <CalendarDays size={19} />
            <span>{todayLink.label}</span>
          </Link>
          <span className="nav-caption nav-caption-spaced">Departamentos</span>
          {visibleDepartmentLinks.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={active ? "nav-link active" : "nav-link"}
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

      <nav
        className="mobile-bottom-nav"
        aria-label="Navegação principal"
        style={{ gridTemplateColumns: `repeat(${visibleLinks.length}, minmax(0, 1fr))` }}
      >
        {visibleLinks.map(({ href, mobileLabel, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link key={href} href={href} className={active ? "active" : ""}>
              <Icon size={20} />
              <span>{mobileLabel}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
