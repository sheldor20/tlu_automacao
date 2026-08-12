import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser, type ElementHandle, type Page } from "puppeteer-core";
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

async function firstVisible(page: Page, selectors: string[]): Promise<ElementHandle<Element> | null> {
  for (const selector of selectors) {
    const elements = await page.$$(selector);
    for (const element of elements) {
      if (await element.isVisible().catch(() => false)) return element;
    }
  }
  return null;
}

async function firstButtonWithText(page: Page, labels: string[]) {
  const normalizedLabels = labels.map((label) => label.toLocaleLowerCase("pt-BR"));
  for (const button of await page.$$("button, input[type='submit']")) {
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

async function submitVisibleForm(page: Page) {
  const submit = await firstVisible(page, [
    "button[type='submit']",
    "input[type='submit']",
  ]) || await firstButtonWithText(page, ["Continuar", "Continue", "Entrar", "Log in", "Sign in"]);
  if (!submit) throw new Error("Qlik: botão para continuar a autenticação não encontrado.");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined),
    submit.click(),
  ]);
}

async function authenticateIfNeeded(page: Page, credentials: QlikCloudCredentials) {
  const ready = await page.$(QLIK_READY_SELECTOR);
  if (ready && await ready.isVisible().catch(() => false)) return;

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
  await fillField(username, credentials.username);

  let password = await firstVisible(page, ["input[type='password']", "input[autocomplete='current-password']"]);
  if (!password) {
    await submitVisibleForm(page);
    await page.waitForSelector("input[type='password'], input[autocomplete='current-password']", {
      visible: true,
      timeout: 30_000,
    })
      .catch(() => undefined);
    password = await firstVisible(page, ["input[type='password']", "input[autocomplete='current-password']"]);
  }
  if (!password) throw new Error("Qlik: campo de senha não encontrado. O provedor pode exigir MFA ou autenticação interativa.");
  await fillField(password, credentials.password);
  await submitVisibleForm(page);
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

export async function scrapeQlikCloudTable(options: QlikCloudTableOptions): Promise<QlikTableSnapshot> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(45_000);
    await page.emulateTimezone("America/Sao_Paulo");
    await page.setUserAgent("TerraLotus-Indicators/1.0");
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
