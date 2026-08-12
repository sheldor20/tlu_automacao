import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser, type ElementHandle, type Frame, type Page } from "puppeteer-core";
import type { QlikTableSnapshot } from "@/lib/qlik-delinquency";

type QlikCloudCredentials = {
  username: string;
  password: string;
};

type QlikCloudTableOptions = QlikCloudCredentials & {
  sheetUrl: string;
  objectId: string;
  filters: ReadonlyArray<{ field: string; value: string }>;
};

const QLIK_READY_SELECTOR = "[data-testid='top-bar-root'], #qv-stage-container";
const USERNAME_SELECTORS = [
  "input[autocomplete='username']",
  "input[type='email']",
  "input[name='email']",
  "input[name='username']",
  "input[name='login']",
  "input[name='user']",
  "input[name='identifier']",
  "input[id*='email' i]",
  "input[id*='username' i]",
  "input[placeholder*='email' i]",
  "input[placeholder*='usuário' i]",
  "input[placeholder*='usuario' i]",
  "input[placeholder*='username' i]",
];
const PASSWORD_SELECTORS = ["input[type='password']", "input[autocomplete='current-password']"];
const LOGIN_GATEWAY_LABELS = [
  "Qlik Account",
  "Log in with Qlik",
  "Sign in with Qlik",
  "Continue with Qlik",
  "Entrar com Qlik",
  "Continuar com Qlik",
  "Email",
  "Log in",
  "Sign in",
  "Entrar",
];

async function firstVisible(scope: Page | Frame, selectors: string[]): Promise<ElementHandle<Element> | null> {
  for (const selector of selectors) {
    const elements = await scope.$$(selector);
    for (const element of elements) {
      if (await element.isVisible().catch(() => false)) return element;
    }
  }
  return null;
}

async function firstButtonWithText(scope: Page | Frame, labels: string[]) {
  const normalizedLabels = labels.map((label) => label.toLocaleLowerCase("pt-BR"));
  for (const button of await scope.$$("button, input[type='submit'], [role='button']")) {
    const label = await button.evaluate((element) => (
      element.textContent || (element as HTMLInputElement).value || ""
    ).trim().toLocaleLowerCase("pt-BR"));
    if (normalizedLabels.some((expected) => label === expected || label.includes(expected))) return button;
  }
  return null;
}

async function fillField(field: ElementHandle<Element>, value: string) {
  await field.click({ count: 3 });
  await field.type(value);
}

async function submitVisibleForm(page: Page, frame: Frame) {
  const submit = await firstVisible(frame, [
    "button[type='submit']",
    "input[type='submit']",
  ]) || await firstButtonWithText(frame, ["Continuar", "Continue", "Entrar", "Log in", "Sign in"]);
  if (!submit) throw new Error("Qlik: botão para continuar a autenticação não encontrado.");
  const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
  await submit.click();
  await Promise.race([
    navigation,
    new Promise((resolve) => setTimeout(resolve, 1_500)),
  ]);
}

type AuthenticationSurface = {
  frame: Frame;
  kind: "ready" | "username" | "password" | "gateway";
  element?: ElementHandle<Element>;
};

type AuthenticationSurfaceKind = AuthenticationSurface["kind"];

async function detectAuthenticationSurface(page: Page): Promise<AuthenticationSurface | null> {
  for (const frame of page.frames()) {
    const ready = await firstVisible(frame, [QLIK_READY_SELECTOR]);
    if (ready) return { frame, kind: "ready", element: ready };
    const username = await firstVisible(frame, USERNAME_SELECTORS);
    if (username) return { frame, kind: "username", element: username };
    const password = await firstVisible(frame, PASSWORD_SELECTORS);
    if (password) return { frame, kind: "password", element: password };
    const gateway = await firstButtonWithText(frame, LOGIN_GATEWAY_LABELS);
    if (gateway) return { frame, kind: "gateway", element: gateway };
  }
  return null;
}

async function waitForAuthenticationSurface(
  page: Page,
  timeout = 60_000,
  acceptedKinds?: ReadonlyArray<AuthenticationSurfaceKind>,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const surface = await detectAuthenticationSurface(page);
    if (surface && (!acceptedKinds || acceptedKinds.includes(surface.kind))) return surface;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

function safeLocation(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "indisponível";
  }
}

async function loginSurfaceSummary(page: Page) {
  const frames = await Promise.all(page.frames().map(async (frame) => {
    const surface = await frame.evaluate(() => ({
      inputs: Array.from(document.querySelectorAll<HTMLInputElement>("input")).slice(0, 12).map((input) => ({
        type: input.type || "text",
        name: input.name || null,
        id: input.id || null,
        autocomplete: input.autocomplete || null,
        placeholder: input.placeholder?.slice(0, 80) || null,
      })),
      buttons: Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], input[type='submit']"))
        .slice(0, 12)
        .map((button) => (button.textContent || (button as HTMLInputElement).value || "").trim().slice(0, 80))
        .filter(Boolean),
    })).catch(() => ({ inputs: [], buttons: [] }));
    return { url: safeLocation(frame.url()), ...surface };
  }));
  return {
    url: safeLocation(page.url()),
    title: (await page.title().catch(() => "indisponível")).slice(0, 120),
    frames,
  };
}

async function loginSurfaceSummaryText(page: Page) {
  return JSON.stringify(await loginSurfaceSummary(page)).slice(0, 1_200);
}

async function authenticateIfNeeded(page: Page, credentials: QlikCloudCredentials) {
  let surface = await waitForAuthenticationSurface(page);
  if (!surface) {
    throw new Error(`Qlik: a tela de autenticação não carregou em 60 segundos. Superfície: ${await loginSurfaceSummaryText(page)}`);
  }
  if (surface.kind === "ready") return;

  if (surface.kind === "gateway") {
    await surface.element!.click();
    surface = await waitForAuthenticationSurface(page, 45_000, ["ready", "username", "password"]);
    if (!surface) {
      throw new Error(`Qlik: a opção de login foi aberta, mas o formulário não apareceu. Superfície: ${await loginSurfaceSummaryText(page)}`);
    }
    if (surface.kind === "ready") return;
  }

  if (surface.kind === "username") {
    await fillField(surface.element!, credentials.username);
  }

  let password = await firstVisible(surface.frame, PASSWORD_SELECTORS);
  if (!password) {
    await submitVisibleForm(page, surface.frame);
    surface = await waitForAuthenticationSurface(page, 45_000, ["ready", "password"]);
    if (surface?.kind === "ready") return;
    password = surface ? await firstVisible(surface.frame, PASSWORD_SELECTORS) : null;
  }
  if (!password || !surface) {
    throw new Error(`Qlik: campo de senha não encontrado. O provedor pode exigir MFA ou SSO. Superfície: ${await loginSurfaceSummaryText(page)}`);
  }
  await fillField(password, credentials.password);
  await submitVisibleForm(page, surface.frame);
}

async function applySelections(page: Page, filters: QlikCloudTableOptions["filters"]) {
  await page.waitForFunction(() => typeof (window as Window & { require?: unknown }).require === "function", {
    timeout: 120_000,
  });
  await page.evaluate(async (filters) => {
    type QlikApp = {
      clearAll: () => Promise<unknown>;
      field: (name: string) => { selectValues: (values: string[], toggle?: boolean, softLock?: boolean) => Promise<unknown> };
    };
    type QlikApi = { currApp: () => QlikApp };
    const qlik = await new Promise<QlikApi>((resolve, reject) => {
      const loader = (window as unknown as {
        require: (dependencies: string[], ready: (api: QlikApi) => void, failed?: (error: unknown) => void) => void;
      }).require;
      loader(["js/qlik"], resolve, reject);
    });
    const app = qlik.currApp();
    await app.clearAll();
    for (const filter of filters) {
      await app.field(filter.field).selectValues([filter.value], false, true);
    }
  }, filters.map((filter) => ({ ...filter })));
}

async function readSelections(page: Page, filters: QlikCloudTableOptions["filters"]) {
  await page.waitForFunction((filters) => filters.every((filter) => {
    const item = document.querySelector(`[data-tid="current-selections-item"][data-csid="${CSS.escape(filter.field)}"]`);
    return item?.querySelector("[tid='current-selection-item-text']")?.textContent?.trim();
  }), { timeout: 60_000 }, filters);

  return page.evaluate((filters) => Object.fromEntries(filters.map((filter) => {
    const item = document.querySelector(`[data-tid="current-selections-item"][data-csid="${CSS.escape(filter.field)}"]`);
    const value = item?.querySelector("[tid='current-selection-item-text']")?.textContent?.trim() || "";
    return [filter.field, value];
  })), filters);
}

async function readTable(page: Page, objectId: string): Promise<Pick<QlikTableSnapshot, "headers" | "rows">> {
  const objectSelector = `.qv-object-${objectId}`;
  await page.waitForSelector(objectSelector, { visible: true, timeout: 120_000 });
  await page.waitForSelector(`${objectSelector} tr[data-tid='qv-st-row']`, { visible: true, timeout: 60_000 });
  await new Promise((resolve) => setTimeout(resolve, 1_000));

  return page.$eval(objectSelector, (element, id) => {
    const headerElements = Array.from(element.querySelectorAll<HTMLElement>(`th[id^="${CSS.escape(id)}-header-"]`));
    const indexedHeaders = headerElements.map((header) => {
      const match = header.id.match(/-header-(\d+)$/);
      const title = header.querySelector<HTMLElement>(".qv-st-header-cell-title")?.innerText || header.innerText;
      return { index: match ? Number(match[1]) : Number.MAX_SAFE_INTEGER, title: title.trim() };
    }).sort((a, b) => a.index - b.index);

    const rows = Array.from(element.querySelectorAll("tr[data-tid='qv-st-row']")).map((row) => (
      Array.from(row.querySelectorAll<HTMLElement>("td[data-tid='qv-st-cell']")).map((cell) => (
        (cell.querySelector<HTMLElement>(".qv-st-value-overflow")?.innerText || cell.innerText).trim()
      ))
    ));
    return { headers: indexedHeaders.map((header) => header.title), rows };
  }, objectId);
}

async function launchBrowser(): Promise<Browser> {
  chromium.setGraphicsMode = false;
  const executablePath = process.env.CHROME_EXECUTABLE_PATH || await chromium.executablePath();
  if (!executablePath) throw new Error("Chromium: o executável não foi localizado no ambiente do servidor.");
  return puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: [...chromium.args, "--lang=pt-BR"], headless: "shell" }),
    defaultViewport: {
      deviceScaleFactor: 1,
      hasTouch: false,
      height: 1080,
      isLandscape: true,
      isMobile: false,
      width: 1920,
    },
    executablePath,
    headless: "shell",
  });
}

export async function diagnoseQlikBrowser() {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><title>Terra Lotus browser check</title>");
    const title = await page.title();
    if (title !== "Terra Lotus browser check") {
      throw new Error("Chromium: a página de diagnóstico não foi processada corretamente.");
    }
    return {
      browser_version: await browser.version(),
      node_version: process.version,
      platform: process.platform,
      vercel: Boolean(process.env.VERCEL),
    };
  } finally {
    await browser.close();
  }
}

export async function diagnoseQlikLogin(sheetUrl: string) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(45_000);
    await page.emulateTimezone("America/Sao_Paulo");
    await page.goto(sheetUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    const surface = await waitForAuthenticationSurface(page, 30_000);
    return {
      surface_kind: surface?.kind || "unknown",
      surface: await loginSurfaceSummary(page),
    };
  } finally {
    await browser.close();
  }
}

export async function scrapeQlikCloudTable(options: QlikCloudTableOptions): Promise<QlikTableSnapshot> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(45_000);
    await page.emulateTimezone("America/Sao_Paulo");
    await page.goto(options.sheetUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await authenticateIfNeeded(page, options);
    await page.waitForSelector(QLIK_READY_SELECTOR, { visible: true, timeout: 120_000 });
    await applySelections(page, options.filters);
    const selections = await readSelections(page, options.filters);
    const table = await readTable(page, options.objectId);
    return { ...table, selections };
  } finally {
    await browser.close();
  }
}
