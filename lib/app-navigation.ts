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
  links: Array<NavigationLink | NavigationGroup>;
};

export type NavigationEntry = NavigationLink | NavigationGroup | { kind: "separator"; id: string };

const groups: NavigationGroup[] = [
  {
    kind: "group", id: "finance", label: "Financeiro", icon: "finance",
    links: [
      { kind: "link", department: "financeiro", href: "/financeiro/caixa-projetado", label: "Caixa projetado", icon: "indicators" },
      { kind: "link", department: "prestacao-contas", href: "/prestacao-contas", label: "Prestação de contas", icon: "notebook" },
    ],
  },
  {
    kind: "group", id: "legal", label: "Jurídico", icon: "legal",
    links: [
      { kind: "link", department: "distratos", href: "/distratos", label: "Distratos administrativos", icon: "terminations", exact: true },
      { kind: "link", department: "distratos", href: "/distratos/judiciais", label: "Distratos judiciais", icon: "legal" },
    ],
  },
  {
    kind: "group", id: "management", label: "Gestão", icon: "management",
    links: [
      { kind: "link", department: "projetos", href: "/projetos", label: "Projetos", icon: "projects" },
      { kind: "link", department: "governanca", href: "/governanca", label: "Governança", icon: "governance" },
      { kind: "link", department: "pauta-ra", href: "/pauta-ra", label: "Reuniões", icon: "notebook" },
      { kind: "link", department: "processos", href: "/processos", label: "Processos", icon: "processes" },
      // This personal module already appears for every active internal profile.
      { kind: "link", href: "/acordo-performance", label: "Acordo de performance", icon: "performance" },
    ],
  },
];

const clientsGroup: NavigationGroup = {
  kind: "group", id: "clients", label: "Pós-vendas", icon: "clients", activeHref: "/clientes",
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

export function navigationLinks(entries: readonly NavigationEntry[]): NavigationLink[] {
  return entries.flatMap(entry => entry.kind === "group" ? navigationLinks(entry.links) : entry.kind === "link" ? [entry] : []);
}

export function searchNavigation(entries: NavigationEntry[], query: string): NavigationLink[] {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const search = (items: NavigationEntry[], parents: string): NavigationLink[] => items.flatMap(entry => {
    if (entry.kind === "separator") return [];
    if (entry.kind === "group") return search(entry.links, `${parents} ${entry.label}`);
    const text = normalize(`${parents} ${entry.label}`);
    return terms.every(term => text.includes(term)) ? [entry] : [];
  });
  return search(entries, "");
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
    { kind: "separator", id: "main-modules" },
  );
  const authorizedGroup = (group: NavigationGroup): NavigationGroup => ({
    ...group, links: group.links.filter(link => link.kind === "group" || !link.department || departments.includes(link.department)),
  });
  const departmentEntries: Array<NavigationLink | NavigationGroup> = groups.slice(0, 2).map(authorizedGroup).filter(group => group.links.length > 0);
  if (departments.includes("alugueis")) departmentEntries.push({ kind: "link", department: "alugueis", href: "/alugueis", label: "Aluguéis", icon: "rentals" });
  if (departments.includes("cobranca")) departmentEntries.push({ kind: "link", department: "cobranca", href: "/cobranca", label: "Cobrança", icon: "collections" });
  if (departments.includes("clientes")) departmentEntries.push(clientsGroup);
  if (departments.includes("novos-negocios")) departmentEntries.push(businessGroup);
  if (departments.includes("obras")) departmentEntries.push({
    kind: "group", id: "engineering", label: "Engenharia", icon: "construction",
    links: [{ kind: "link", department: "obras", href: "/obras", label: "Obras", icon: "construction" }],
  });
  if (departmentEntries.length) entries.push({ kind: "group", id: "departments", label: "Departamentos", icon: "departments", links: departmentEntries });
  entries.push({ kind: "link", href: "/pagamentos", label: "Solicitações", icon: "finance" });
  entries.push(authorizedGroup(groups[2]));
  entries.push({ kind: "separator", id: "account" });
  if (isAdmin) entries.push({ kind: "link", href: "/administracao", label: "Administração", icon: "admin" });
  entries.push({ kind: "link", href: "/perfil", label: "Meu perfil", icon: "profile" });
  return entries;
}
