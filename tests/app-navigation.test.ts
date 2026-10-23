import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { getMainNavigation, isNavigationPathActive, type NavigationEntry } from "../lib/app-navigation.ts";
import { DEPARTMENTS, MANAGEMENT_AREAS } from "../lib/constants.ts";

const departments = DEPARTMENTS.map(department => department.slug);
const indicatorAreas = MANAGEMENT_AREAS.map(area => area.slug);
const linksOf = (entries: NavigationEntry[]) => entries.flatMap(entry => entry.kind === "group" ? entry.links : entry.kind === "link" ? [entry] : []);

test("compõe a ordem solicitada e mapeia somente rotas existentes", () => {
  const entries = getMainNavigation({ departments, indicatorAreas, isAdmin: true });
  assert.deepEqual(entries.map(entry => entry.kind === "separator" ? "---" : entry.label), [
    "Mensagens", "Indicadores", "Hoje", "---", "Financeiro", "Jurídico", "Gestão", "Clientes", "---", "Administração", "Meu perfil",
  ]);
  assert.deepEqual(entries.filter(entry => entry.kind === "group").map(group => group.links.map(link => [link.label, link.href])), [
    [["Caixa projetado", "/financeiro/caixa-projetado"], ["Prestação de contas", "/prestacao-contas"], ["Aluguéis", "/alugueis"]],
    [["Distratos", "/distratos"], ["Cobrança", "/cobranca"]],
    [["Projetos", "/projetos"], ["Governança", "/governanca"], ["Processos", "/processos"], ["Reuniões", "/pauta-ra"], ["Acordo de performance", "/acordo-performance"]],
  ]);
  for (const link of linksOf(entries)) {
    const route = link.href.startsWith("/indicadores/") ? "/indicadores/[area]" : link.href;
    assert.ok(existsSync(new URL(`../app/(app)${route}/page.tsx`, import.meta.url)), link.href);
  }
});

test("todas as combinações de departamentos mantêm a visibilidade anterior sem conceder irmãos", () => {
  const permissionByHref = {
    "/financeiro/caixa-projetado": "financeiro", "/prestacao-contas": "prestacao-contas", "/alugueis": "alugueis",
    "/distratos": "distratos", "/cobranca": "cobranca", "/projetos": "projetos", "/governanca": "governanca",
    "/processos": "processos", "/pauta-ra": "pauta-ra", "/clientes": "clientes",
  } as const;
  for (let mask = 0; mask < 2 ** departments.length; mask++) {
    const assigned = departments.filter((_, index) => mask & (1 << index));
    const entries = getMainNavigation({ departments: assigned, indicatorAreas, isAdmin: false });
    const hrefs = linksOf(entries).map(link => link.href);
    for (const [href, permission] of Object.entries(permissionByHref)) {
      assert.equal(hrefs.includes(href), assigned.includes(permission), `${assigned}: ${href}`);
    }
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
    "/mensagens", "/hoje", "/acordo-performance", "/perfil",
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

test("itens retirados do menu preservam páginas e funcionalidades acessíveis por suas rotas", () => {
  const hrefs = linksOf(getMainNavigation({ departments, indicatorAreas, isAdmin: true })).map(link => link.href);
  for (const route of ["/pagamentos", "/pagamentos/nova", "/pagamentos/contratos/[id]", "/novos-negocios", "/novos-negocios/prospeccao", "/novos-negocios/esteira-de-negocios", "/novos-negocios/landing-bank", "/novos-negocios/performance-de-empreendimentos", "/obras", "/clientes/clube-tlu"]) {
    assert.ok(!hrefs.includes(route));
    assert.ok(existsSync(new URL(`../app/(app)${route}/page.tsx`, import.meta.url)), route);
  }
});
