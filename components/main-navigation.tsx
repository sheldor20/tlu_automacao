"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  CalendarDays, ChartNoAxesCombined, ChevronDown, FileX2, FolderKanban,
  GitBranch, HandCoins, Home, Landmark, Layers, NotebookTabs, Scale,
  ShieldCheck, Target, UserRound, Users, Wallet, type LucideIcon,
} from "lucide-react";
import { getMainNavigation, isNavigationPathActive, type NavigationGroup } from "@/lib/app-navigation";
import type { DepartmentSlug, ManagementAreaSlug } from "@/lib/types";
import { ChatNavigation } from "./chat-navigation";

const icons: Record<string, LucideIcon> = {
  today: CalendarDays, indicators: ChartNoAxesCombined, finance: Wallet,
  notebook: NotebookTabs, rentals: Home, legal: Scale, terminations: FileX2,
  collections: HandCoins, management: Layers, projects: FolderKanban,
  governance: Landmark, processes: GitBranch, performance: Target,
  clients: Users, admin: ShieldCheck, profile: UserRound,
};

function NavigationDisclosure({ group, pathname, collapsed, onExpand, onNavigate }: {
  group: NavigationGroup;
  pathname: string;
  collapsed: boolean;
  onExpand: () => void;
  onNavigate: () => void;
}) {
  const active = group.links.some(link => isNavigationPathActive(pathname, link.href));
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
        const childActive = isNavigationPathActive(pathname, link.href);
        const ChildIcon = icons[link.icon];
        return <Link key={link.href} href={link.href} className={`nav-sublink${childActive ? " active" : ""}`}
          aria-current={childActive ? "page" : undefined} onClick={onNavigate}>
          <ChildIcon size={15} aria-hidden="true" /><span>{link.label}</span>
        </Link>;
      })}
    </div>
  </div>;
}

export function MainNavigation({ pathname, departments, indicatorAreas, isAdmin, todayAlertCount, collapsed, onExpand, onNavigate }: {
  pathname: string;
  departments: DepartmentSlug[];
  indicatorAreas: ManagementAreaSlug[];
  isAdmin: boolean;
  todayAlertCount: number;
  collapsed: boolean;
  onExpand: () => void;
  onNavigate: () => void;
}) {
  return <nav aria-label="Navegação principal">
    {getMainNavigation({ departments, indicatorAreas, isAdmin }).map(entry => {
      if (entry.kind === "separator") return <hr key={entry.id} className="nav-separator" />;
      if (entry.kind === "group") return <NavigationDisclosure key={entry.id} group={entry} pathname={pathname}
        collapsed={collapsed} onExpand={onExpand} onNavigate={onNavigate} />;
      if (entry.href === "/mensagens") return <ChatNavigation key={entry.href} pathname={pathname} onNavigate={onNavigate} />;
      const active = isNavigationPathActive(pathname, entry.activeHref || entry.href);
      const Icon = icons[entry.icon];
      return <Link key={entry.href} href={entry.href} className={`nav-link${active ? " active" : ""}`}
        title={entry.label} aria-label={entry.label} aria-current={active ? "page" : undefined} onClick={onNavigate}>
        <Icon size={19} aria-hidden="true" /><span>{entry.label}</span>
        {entry.href === "/hoje" && todayAlertCount > 0 ? <span className="nav-alert-badge" aria-label={`${todayAlertCount} alertas pendentes`}>{todayAlertCount > 99 ? "99+" : todayAlertCount}</span> : null}
      </Link>;
    })}
  </nav>;
}
