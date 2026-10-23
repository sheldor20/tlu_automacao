import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { getMainNavigation, isNavigationLinkActive, isNavigationPathActive, searchNavigation, navigationLinks, type NavigationEntry, type NavigationLink } from "../lib/app-navigation.ts";
import { DEPARTMENTS, MANAGEMENT_AREAS } from "../lib/constants.ts";

const departments = DEPARTMENTS.map(department => department.slug);
const indicatorAreas = MANAGEMENT_AREAS.map(area => area.slug);
const linksOf = navigationLinks;
const groupsOf = (entries: NavigationEntry[]): import("../lib/app-navigation.ts").NavigationGroup[] => entries.flatMap(entry => entry.kind === "group" ? [entry, ...groupsOf(entry.links)] : []);

test("compõe a ordem solicitada e mapeia somente rotas existentes", () => {
  const entries = getMainNavigation({ departments, indicatorAreas, isAdmin: true });
  assert.deepEqual(entries.map(entry => entry.kind === "separator" ? "---" : entry.label), [
    "Hoje", "Indicadores", "Mensagens", "---", "Departamentos", "Gestão", "Solicitações", "---", "Administração", "Meu perfil",
  ]);
  const departmentGroup = entries.find(entry => entry.kind === "group" && entry.id === "departments");
  assert.ok(departmentGroup?.kind === "group");
  assert.deepEqual(departmentGroup.links.map(entry => entry.label), ["Aluguéis", "Cobrança", "Engenharia", "Financeiro", "Jurídico", "Novos negócios", "Pós-vendas"]);
  assert.deepEqual(groupsOf(entries).filter(group => group.id !== "departments").map(group => group.links.map(link => link.label)), [
    ["Obras"],
    ["Caixa projetado", "Prestação de contas"],
    ["Distratos administrativos", "Distratos judiciais", "Relatório de Ações"],
    ["Esteira de negócios", "Landing Bank", "Performance de empreendimentos", "Prospecção"],
    ["Carteira de clientes", "Clube TLU", "IPTUs Particulares"],
    ["Acordo de performance", "Governança", "Pendências", "Processos", "Projetos", "Reuniões"],
  ]);
  for (const link of linksOf(entries)) {
    const route = link.href.startsWith("/indicadores/") ? "/indicadores/[area]" : link.href;
    assert.ok(existsSync(new URL(`../app/(app)${route}/page.tsx`, import.meta.url)), link.href);
  }
});

test("checklist original: todos os destinos mantêm a visibilidade em 8.192 combinações de departamentos", () => {
  // Inventory from the sidebar before PR #157 (b58722c), including every submenu.
  // Each original link has exactly the same permission; groups only change its position.
  const permissionByHref = {
    "/financeiro/caixa-projetado": "financeiro", "/prestacao-contas": "prestacao-contas", "/alugueis": "alugueis",
    "/distratos/relatorio-de-acoes": "distratos", "/distratos": "distratos", "/distratos/judiciais": "distratos", "/cobranca": "cobranca", "/projetos": "projetos", "/governanca": "governanca",
    "/processos": "processos", "/pauta-ra": "pauta-ra", "/clientes": "clientes", "/clientes/clube-tlu": "clientes", "/clientes/iptus-particulares": "clientes",
    "/novos-negocios/prospeccao": "novos-negocios", "/novos-negocios/esteira-de-negocios": "novos-negocios",
    "/novos-negocios/landing-bank": "novos-negocios", "/novos-negocios/performance-de-empreendimentos": "novos-negocios", "/obras": "obras",
  } as const;
  for (let mask = 0; mask < 2 ** departments.length; mask++) {
    const assigned = departments.filter((_, index) => mask & (1 << index));
    const entries = getMainNavigation({ departments: assigned, indicatorAreas, isAdmin: false });
    const checkOrder = (items: NavigationEntry[]) => {
      let previous: string | undefined;
      for (const item of items) {
        if (item.kind === "separator") { previous = undefined; continue; }
        if (previous) assert.ok(previous.localeCompare(item.label, "pt-BR", { sensitivity: "base", numeric: true }) <= 0, `${previous} antes de ${item.label}`);
        previous = item.label;
        if (item.kind === "group") checkOrder(item.links);
      }
    };
    checkOrder(entries);
    const hrefs = linksOf(entries).map(link => link.href);
    for (const [href, permission] of Object.entries(permissionByHref)) {
      assert.equal(hrefs.includes(href), assigned.includes(permission), `${assigned}: ${href}`);
    }
    const originalTargets = ["/mensagens", "/hoje", "/pagamentos", "/pendencias", "/acordo-performance", "/perfil",
      ...Object.entries(permissionByHref).filter(([, permission]) => assigned.includes(permission)).map(([href]) => href),
      ...(assigned.includes("indicadores") ? ["/indicadores/empresa"] : [])];
    assert.deepEqual([...hrefs].sort(), originalTargets.sort(), `original/final: ${assigned}`);
    assert.equal(new Set(hrefs).size, hrefs.length, "nenhum destino duplicado");
    assert.equal(hrefs.includes("/indicadores/empresa"), assigned.includes("indicadores"));
    assert.ok(!hrefs.includes("/administracao"));
    for (const href of ["/mensagens", "/hoje", "/acordo-performance", "/perfil"]) assert.ok(hrefs.includes(href));
    for (const entry of entries) if (entry.kind === "group") assert.ok(entry.links.length > 0);
  }
});

test("Indicadores exige departamento e uma visão liberada, usando a primeira autorizada", () => {
  assert.ok(!linksOf(getMainNavigation({ departments, indicatorAreas: [], isAdmin: false })).some(link => link.href.startsWith("/indicadores")));
  assert.ok(!linksOf(getMainNavigation({ departments: [], indicatorAreas, isAdmin: false })).some(link => link.href.startsWith("/indicadores")));
  for (const area of indicatorAreas) {
    const link = linksOf(getMainNavigation({ departments: ["indicadores"], indicatorAreas: [area], isAdmin: false })).find(link => link.label === "Indicadores");
    assert.equal(link?.href, `/indicadores/${area}`);
  }
});

test("Administração continua exclusiva e o perfil sem departamentos mantém seus módulos pessoais", () => {
  assert.deepEqual(linksOf(getMainNavigation({ departments: [], indicatorAreas: [], isAdmin: false })).map(link => link.href), [
    "/hoje", "/mensagens", "/acordo-performance", "/pendencias", "/pagamentos", "/perfil",
  ]);
  assert.ok(linksOf(getMainNavigation({ departments, indicatorAreas, isAdmin: true })).some(link => link.href === "/administracao"));
});

test("seleção ativa cobre páginas filhas sem confundir prefixos de outras rotas", () => {
  for (const href of linksOf(getMainNavigation({ departments, indicatorAreas, isAdmin: true })).map(link => link.activeHref || link.href)) {
    assert.equal(isNavigationPathActive(href, href), true);
    assert.equal(isNavigationPathActive(`${href}/detalhe`, href), true);
    assert.equal(isNavigationPathActive(`${href}-outro`, href), false);
  }
  assert.equal(isNavigationPathActive("/indicadores/financas-compras", "/indicadores"), true);
  assert.equal(isNavigationPathActive("/clientes/clube-tlu", "/clientes"), true);
});

test("Engenharia agrupa Obras com sua permissão independente de Novos negócios", () => {
  for (const assigned of [[], ["obras"], ["novos-negocios"], ["obras", "novos-negocios"]] as const) {
    const groups = groupsOf(getMainNavigation({ departments: assigned, indicatorAreas: [], isAdmin: false }));
    assert.equal(groups.some(group => group.id === "new-business"), assigned.some(slug => slug === "novos-negocios"));
    assert.equal(groups.some(group => group.id === "engineering"), assigned.some(slug => slug === "obras"));
  }
});

test("Clientes destaca apenas o submenu correto e mantém Clube TLU", () => {
  const entries = getMainNavigation({ departments: ["clientes"], indicatorAreas: [], isAdmin: false });
  const clients = groupsOf(entries).find(entry => entry.kind === "group" && entry.id === "clients");
  assert.ok(clients?.kind === "group");
  for (const path of ["/clientes", "/clientes/clube-tlu", "/clientes/clube-tlu/detalhe", "/clientes/iptus-particulares"]) {
    const selected: NavigationLink[] = navigationLinks(clients.links).filter(link => isNavigationLinkActive(path, link));
    assert.equal(selected.length, 1);
    assert.equal(selected[0].href, path.startsWith("/clientes/clube-tlu") ? "/clientes/clube-tlu" : path);
  }
});

test("páginas auxiliares e entradas dos grupos continuam existentes", () => {
  for (const route of ["/pagamentos/nova", "/pagamentos/contratos/[id]", "/novos-negocios", "/financeiro"]) {
    assert.ok(existsSync(new URL(`../app/(app)${route}/page.tsx`, import.meta.url)), route);
  }
});

test("busca do menu encontra rótulos e grupos sem distinguir acentos ou caixa", () => {
  const entries = getMainNavigation({ departments, indicatorAreas, isAdmin: true });
  assert.deepEqual(searchNavigation(entries, "GOVERNANCA").map(link => link.href), ["/governanca"]);
  assert.deepEqual(searchNavigation(entries, "novos negocios").map(link => link.href), ["/novos-negocios/esteira-de-negocios", "/novos-negocios/landing-bank", "/novos-negocios/performance-de-empreendimentos", "/novos-negocios/prospeccao"]);
  assert.deepEqual(searchNavigation(entries, "clube").map(link => link.href), ["/clientes/clube-tlu"]);
  assert.deepEqual(searchNavigation(entries, "  "), []);
  assert.deepEqual(searchNavigation(entries, "inexistente"), []);
});

test("busca indexa somente módulos autorizados, inclusive filhos de grupos compartilhados", () => {
  const entries = getMainNavigation({ departments: ["prestacao-contas"], indicatorAreas: [], isAdmin: false });
  assert.deepEqual(searchNavigation(entries, "financeiro").map(link => link.href), ["/prestacao-contas"]);
  for (const query of ["caixa", "alugueis", "prospeccao", "administracao", "clube"]) assert.deepEqual(searchNavigation(entries, query), []);
});

test("Jurídico seleciona somente o distrato correspondente e a busca reconhece a hierarquia", () => {
  const entries = getMainNavigation({ departments, indicatorAreas, isAdmin: false });
  const legal = groupsOf(entries).find(group => group.id === "legal");
  assert.ok(legal);
  for (const path of ["/distratos", "/distratos/judiciais", "/distratos/judiciais/detalhe"]) {
    const selected: NavigationLink[] = navigationLinks(legal.links).filter(link => isNavigationLinkActive(path, link));
    assert.deepEqual(selected.map(link => link.href), [path === "/distratos" ? "/distratos" : "/distratos/judiciais"]);
  }
  assert.deepEqual(searchNavigation(entries, "departamentos engenharia").map(link => link.href), ["/obras"]);
  assert.deepEqual(searchNavigation(entries, "pos vendas clube").map(link => link.href), ["/clientes/clube-tlu"]);
});
