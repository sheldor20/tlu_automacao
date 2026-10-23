import type { DepartmentSlug, ManagementAreaSlug } from "./types.ts";
import { BUSINESS_PORTFOLIO_SECTIONS } from "./constants.ts";

export type NavigationLink = {
  kind: "link";
  href: string;
  label: string;
  icon: string;
  department?: DepartmentSlug;
  activeHref?: string;
  exact?: boolean;
};

export type NavigationGroup = {
  kind: "group";
  id: string;
  label: string;
  icon: string;
  activeHref?: string;
  links: NavigationLink[];
};

export type NavigationEntry = NavigationLink | NavigationGroup | { kind: "separator"; id: string };

const groups: NavigationGroup[] = [
  {
    kind: "group", id: "finance", label: "Financeiro", icon: "finance",
    links: [
      { kind: "link", department: "financeiro", href: "/financeiro/caixa-projetado", label: "Caixa projetado", icon: "indicators" },
      { kind: "link", department: "prestacao-contas", href: "/prestacao-contas", label: "Prestação de contas", icon: "notebook" },
      { kind: "link", department: "alugueis", href: "/alugueis", label: "Aluguéis", icon: "rentals" },
    ],
  },
  {
    kind: "group", id: "legal", label: "Jurídico", icon: "legal",
    links: [
      { kind: "link", department: "distratos", href: "/distratos", label: "Distratos", icon: "terminations" },
      { kind: "link", department: "cobranca", href: "/cobranca", label: "Cobrança", icon: "collections" },
    ],
  },
  {
    kind: "group", id: "management", label: "Gestão", icon: "management",
    links: [
      { kind: "link", department: "projetos", href: "/projetos", label: "Projetos", icon: "projects" },
      { kind: "link", department: "governanca", href: "/governanca", label: "Governança", icon: "governance" },
      { kind: "link", department: "processos", href: "/processos", label: "Processos", icon: "processes" },
      { kind: "link", department: "pauta-ra", href: "/pauta-ra", label: "Reuniões", icon: "notebook" },
      // This personal module already appears for every active internal profile.
      { kind: "link", href: "/acordo-performance", label: "Acordo de performance", icon: "performance" },
    ],
  },
];

const clientsGroup: NavigationGroup = {
  kind: "group", id: "clients", label: "Clientes", icon: "clients", activeHref: "/clientes",
  links: [
    { kind: "link", href: "/clientes", label: "Carteira de clientes", icon: "clients", exact: true },
    { kind: "link", href: "/clientes/clube-tlu", label: "Clube TLU", icon: "club" },
  ],
};

const businessGroup: NavigationGroup = {
  kind: "group", id: "new-business", label: "Novos negócios", icon: "business", activeHref: "/novos-negocios",
  links: [
    { kind: "link", ...BUSINESS_PORTFOLIO_SECTIONS[0], icon: "prospecting" },
    { kind: "link", ...BUSINESS_PORTFOLIO_SECTIONS[1], icon: "pipeline" },
    { kind: "link", department: "obras", href: "/obras", label: "Obras", icon: "construction" },
    { kind: "link", ...BUSINESS_PORTFOLIO_SECTIONS[2], icon: "land" },
    { kind: "link", href: "/novos-negocios/performance-de-empreendimentos", label: "Performance de empreendimentos", icon: "indicators" },
  ],
};

export function isNavigationPathActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isNavigationLinkActive(pathname: string, link: NavigationLink): boolean {
  const href = link.activeHref || link.href;
  return link.exact ? pathname === href : isNavigationPathActive(pathname, href);
}

// Presentation only: route guards and module permissions remain in AppShell/pages.
export function getMainNavigation({ departments, indicatorAreas, isAdmin }: {
  departments: readonly DepartmentSlug[];
  indicatorAreas: readonly ManagementAreaSlug[];
  isAdmin: boolean;
}): NavigationEntry[] {
  const entries: NavigationEntry[] = [
    { kind: "link", href: "/mensagens", label: "Mensagens", icon: "messages" },
  ];
  if (departments.includes("indicadores") && indicatorAreas.length > 0) {
    entries.push({ kind: "link", href: `/indicadores/${indicatorAreas[0]}`, activeHref: "/indicadores", label: "Indicadores", icon: "indicators" });
  }
  entries.push(
    { kind: "link", href: "/hoje", label: "Hoje", icon: "today" },
    { kind: "separator", id: "departments" },
  );
  for (const group of groups) {
    const links = group.links.filter(link => !link.department || departments.includes(link.department));
    if (links.length > 0) entries.push({ ...group, links });
  }
  if (departments.includes("clientes")) {
    entries.push(clientsGroup);
  }
  // Preserve every earlier menu item omitted from the requested reordering.
  entries.push({ kind: "link", href: "/pagamentos", label: "Solicitações", icon: "finance" });
  if (departments.includes("novos-negocios")) {
    entries.push({ ...businessGroup, links: businessGroup.links.filter(link => !link.department || departments.includes(link.department)) });
  } else if (departments.includes("obras")) {
    entries.push({ kind: "link", department: "obras", href: "/obras", label: "Obras", icon: "construction" });
  }
  entries.push({ kind: "separator", id: "account" });
  if (isAdmin) entries.push({ kind: "link", href: "/administracao", label: "Administração", icon: "admin" });
  entries.push({ kind: "link", href: "/perfil", label: "Meu perfil", icon: "profile" });
  return entries;
}
