"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Building2, CalendarDays, ChartNoAxesCombined, ChevronDown, Database, FileX2, FolderKanban,
  GitBranch, HandCoins, Home, Landmark, Layers, NotebookTabs, Scale,
  Search, ShieldCheck, Target, Ticket, TrendingUp, UserRound, Users, Wallet, Workflow, type LucideIcon,
} from "lucide-react";
import { getMainNavigation, isNavigationLinkActive, isNavigationPathActive, searchNavigation, navigationLinks, type NavigationGroup } from "@/lib/app-navigation";
import type { DepartmentSlug, ManagementAreaSlug } from "@/lib/types";
import { ChatNavigation } from "./chat-navigation";

const icons: Record<string, LucideIcon> = {
  today: CalendarDays, indicators: ChartNoAxesCombined, finance: Wallet,
  notebook: NotebookTabs, rentals: Home, legal: Scale, terminations: FileX2,
  collections: HandCoins, management: Layers, projects: FolderKanban,
  governance: Landmark, processes: GitBranch, performance: Target,
  clients: Users, admin: ShieldCheck, profile: UserRound,
  club: Ticket, business: TrendingUp, prospecting: Search, pipeline: Workflow,
  construction: Building2, land: Database, departments: Layers,
};

function focusSearchWhenVisible(input: HTMLInputElement | null) {
  let frames = 0;
  const focus = () => {
    if (!input?.isConnected) return;
    // The mobile drawer transitions from visibility:hidden before accepting focus.
    input.focus();
    if (document.activeElement !== input && frames++ < 30) window.requestAnimationFrame(focus);
  };
  window.requestAnimationFrame(focus);
}

function NavigationDisclosure({ group, pathname, collapsed, onExpand, onNavigate }: {
  group: NavigationGroup;
  pathname: string;
  collapsed: boolean;
  onExpand: () => void;
  onNavigate: () => void;
}) {
  const active = Boolean(group.activeHref && isNavigationPathActive(pathname, group.activeHref))
    || navigationLinks(group.links).some(link => isNavigationLinkActive(pathname, link));
  const [preference, setPreference] = useState({ pathname, open: active });
  const open = !collapsed && (preference.pathname === pathname ? preference.open : active);
  const button = useRef<HTMLButtonElement>(null);
  const Icon = icons[group.icon];
  const submenuId = `${group.id}-submenu`;

  return <div className="nav-group">
    <button
      ref={button}
      type="button"
      className={`nav-link nav-parent${active ? " active" : ""}`}
      title={group.label}
      aria-label={group.label}
      aria-expanded={open}
      aria-controls={submenuId}
      onClick={() => {
        if (collapsed) onExpand();
        setPreference({ pathname, open: !open });
      }}
    >
      <Icon size={19} aria-hidden="true" /><span>{group.label}</span>
      <ChevronDown className={`nav-parent-chevron${open ? " open" : ""}`} size={15} aria-hidden="true" />
    </button>
    <div id={submenuId} className="nav-submenu" hidden={!open} onKeyDown={event => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setPreference({ pathname, open: false });
        button.current?.focus();
      }
    }}>
      {group.links.map(link => {
        if (link.kind === "group") return <NavigationDisclosure key={link.id} group={link} pathname={pathname}
          collapsed={collapsed} onExpand={onExpand} onNavigate={onNavigate} />;
        const childActive = isNavigationLinkActive(pathname, link);
        const ChildIcon = icons[link.icon];
        return <Link key={link.href} href={link.href} className={`nav-sublink${childActive ? " active" : ""}`}
          aria-current={childActive ? "page" : undefined} onClick={onNavigate}>
          <ChildIcon size={15} aria-hidden="true" /><span>{link.label}</span>
        </Link>;
      })}
    </div>
  </div>;
}

export function MainNavigation({ pathname, departments, indicatorAreas, isAdmin, todayAlertCount, collapsed, onExpand, onNavigate, onSearchReveal }: {
  pathname: string;
  departments: DepartmentSlug[];
  indicatorAreas: ManagementAreaSlug[];
  isAdmin: boolean;
  todayAlertCount: number;
  collapsed: boolean;
  onExpand: () => void;
  onNavigate: () => void;
  onSearchReveal: () => void;
}) {
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const entries = getMainNavigation({ departments, indicatorAreas, isAdmin });
  const searching = Boolean(query.trim());
  const visibleEntries = searching ? searchNavigation(entries, query) : entries;
  const navigate = () => { setQuery(""); onNavigate(); };

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onSearchReveal();
        focusSearchWhenVisible(searchInput.current);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [onSearchReveal]);

  return <>
    <div className="nav-search" role="search" aria-label="Busca de módulos">
      <button type="button" className="nav-search-toggle" aria-label="Buscar no menu" title="Buscar no menu (Ctrl/Cmd+K)"
        aria-keyshortcuts="Control+K Meta+K" onClick={() => {
          onSearchReveal();
          focusSearchWhenVisible(searchInput.current);
        }}><Search size={19} aria-hidden="true" /></button>
      <label className="nav-search-field">
        <Search size={17} aria-hidden="true" />
        <input ref={searchInput} type="search" aria-label="Buscar no menu" placeholder="Buscar no menu…" value={query}
          aria-keyshortcuts="Control+K Meta+K" onChange={event => setQuery(event.target.value)}
          onKeyDown={event => { if (event.key === "Escape" && query) { event.stopPropagation(); setQuery(""); } }} />
        <kbd aria-hidden="true">⌘/Ctrl K</kbd>
      </label>
    </div>
    <nav aria-label="Navegação principal">
    {searching ? <span className="nav-search-status" role="status">{visibleEntries.length ? `${visibleEntries.length} resultado(s)` : "Nenhum módulo encontrado"}</span> : null}
    {visibleEntries.map(entry => {
      if (entry.kind === "separator") return <hr key={entry.id} className="nav-separator" />;
      if (entry.kind === "group") return <NavigationDisclosure key={entry.id} group={entry} pathname={pathname}
        collapsed={collapsed} onExpand={onExpand} onNavigate={navigate} />;
      if (entry.href === "/mensagens") return <ChatNavigation key={entry.href} pathname={pathname} onNavigate={navigate} />;
      const active = isNavigationLinkActive(pathname, entry);
      const Icon = icons[entry.icon];
      return <Link key={entry.href} href={entry.href} className={`nav-link${active ? " active" : ""}`}
        title={entry.label} aria-label={entry.label} aria-current={active ? "page" : undefined} onClick={navigate}>
        <Icon size={19} aria-hidden="true" /><span>{entry.label}</span>
        {entry.href === "/hoje" && todayAlertCount > 0 ? <span className="nav-alert-badge" aria-label={`${todayAlertCount} alertas pendentes`}>{todayAlertCount > 99 ? "99+" : todayAlertCount}</span> : null}
      </Link>;
    })}
  </nav></>;
}
