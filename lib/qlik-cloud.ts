import chromium from "@sparticuz/chromium";
import { chromium as playwright, type Browser, type Page } from "playwright-core";
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

async function firstVisible(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) return locator;
  }
  return null;
}

async function submitVisibleForm(page: Page) {
  const submit = await firstVisible(page, [
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('Continuar')",
    "button:has-text('Continue')",
    "button:has-text('Entrar')",
    "button:has-text('Log in')",
    "button:has-text('Sign in')",
  ]);
  if (!submit) throw new Error("Qlik: botão para continuar a autenticação não encontrado.");
  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined),
    submit.click(),
  ]);
}

async function authenticateIfNeeded(page: Page, credentials: QlikCloudCredentials) {
  if (await page.locator(QLIK_READY_SELECTOR).first().isVisible().catch(() => false)) return;

  const username = await firstVisible(page, [
    "input[autocomplete='username']",
    "input[type='email']",
    "input[name='email']",
    "input[name='username']",
    "input[name='identifier']",
    "input[id*='email' i]",
    "input[id*='username' i]",
  ]);
  if (!username) throw new Error("Qlik: campo de usuário não encontrado. Confirme se o acesso usa login e senha sem MFA/SSO interativo.");
  await username.fill(credentials.username);

  let password = await firstVisible(page, ["input[type='password']", "input[autocomplete='current-password']"]);
  if (!password) {
    await submitVisibleForm(page);
    await page.locator("input[type='password'], input[autocomplete='current-password']").first()
      .waitFor({ state: "visible", timeout: 30_000 })
      .catch(() => undefined);
    password = await firstVisible(page, ["input[type='password']", "input[autocomplete='current-password']"]);
  }
  if (!password) throw new Error("Qlik: campo de senha não encontrado. O provedor pode exigir MFA ou autenticação interativa.");
  await password.fill(credentials.password);
  await submitVisibleForm(page);
}

async function applySelections(page: Page, filters: QlikCloudTableOptions["filters"]) {
  await page.waitForFunction(() => typeof (window as Window & { require?: unknown }).require === "function", undefined, {
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
  }), filters, { timeout: 60_000 });

  return page.evaluate((filters) => Object.fromEntries(filters.map((filter) => {
    const item = document.querySelector(`[data-tid="current-selections-item"][data-csid="${CSS.escape(filter.field)}"]`);
    const value = item?.querySelector("[tid='current-selection-item-text']")?.textContent?.trim() || "";
    return [filter.field, value];
  })), filters);
}

async function readTable(page: Page, objectId: string): Promise<Pick<QlikTableSnapshot, "headers" | "rows">> {
  const object = page.locator(`.qv-object-${objectId}`).first();
  await object.waitFor({ state: "visible", timeout: 120_000 });
  await object.locator("tr[data-tid='qv-st-row']").first().waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(1_000);

  return object.evaluate((element, id) => {
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
  return playwright.launch({
    args: chromium.args,
    executablePath,
    headless: true,
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

export async function scrapeQlikCloudTable(options: QlikCloudTableOptions): Promise<QlikTableSnapshot> {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      viewport: { width: 1920, height: 1080 },
      userAgent: "TerraLotus-Indicators/1.0",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    await page.goto(options.sheetUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await authenticateIfNeeded(page, options);
    await page.waitForSelector(QLIK_READY_SELECTOR, { state: "visible", timeout: 120_000 });
    await applySelections(page, options.filters);
    const selections = await readSelections(page, options.filters);
    const table = await readTable(page, options.objectId);
    return { ...table, selections };
  } finally {
    await browser.close();
  }
}
