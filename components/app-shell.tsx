"use client";

import { getSupabase } from "@/lib/supabase";
import { initials } from "@/lib/format";
import {
  Building2,
  FolderKanban,
  LogOut,
  Menu,
  TrendingUp,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

const links = [
  { href: "/novos-negocios", label: "Novos negócios", icon: TrendingUp },
  { href: "/obras", label: "Obras", icon: Building2 },
  { href: "/projetos", label: "Projetos", icon: FolderKanban },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = getSupabase();
  const [loading, setLoading] = useState(Boolean(supabase));
  const [email, setEmail] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => {
    if (!supabase) {
      return;
    }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (!data.session) {
        router.replace("/login");
      } else {
        setEmail(data.session.user.email || "Usuário");
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
  }, [router, supabase]);

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
          <span className="nav-caption">Departamentos</span>
          {links.map(({ href, label, icon: Icon }) => {
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

        <div className="side-user">
          <div className="user-avatar">{initials(email)}</div>
          <div className="user-meta">
            <strong>Usuário</strong>
            <span>{email}</span>
          </div>
          <button onClick={signOut} aria-label="Sair do sistema" title="Sair">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <nav className="mobile-bottom-nav" aria-label="Departamentos">
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link key={href} href={href} className={active ? "active" : ""}>
              <Icon size={20} />
              <span>{label === "Novos negócios" ? "Negócios" : label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
