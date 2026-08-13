import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser, type ElementHandle, type Frame, type Page } from "puppeteer-core";
import type { QlikTableSnapshot } from "@/lib/qlik-delinquency";
import { extractQlikAppId, isQlikAppWebSocketUrl } from "@/lib/qlik-engine";
import { isQlikAccountGatewayAction } from "@/lib/qlik-login";

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

async function firstQlikAccountGateway(scope: Page | Frame) {
  for (const button of await scope.$$("button, input[type='submit'], [role='button']")) {
    const label = await button.evaluate((element) => (
      element.textContent || (element as HTMLInputElement).value || ""
    ));
    if (isQlikAccountGatewayAction(label)) return button;
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
    const gateway = await firstQlikAccountGateway(frame);
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

function safeSocketLocation(value: string) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "indisponível";
  }
}

type QlikSocketObservation = {
  url: string;
  status?: number;
  statusText?: string;
  error?: string;
};

async function observeNativeQlikSocket(page: Page, appId: string) {
  const client = await page.createCDPSession();
  await client.send("Network.enable");
  const observations = new Map<string, QlikSocketObservation>();
  let resolveAuthenticatedUrl: (url: string) => void = () => undefined;
  const authenticatedUrl = new Promise<string>((resolve) => {
    resolveAuthenticatedUrl = resolve;
  });
  let resolved = false;

  client.on("Network.webSocketCreated", ({ requestId, url }) => {
    observations.set(requestId, { url });
  });
  client.on("Network.webSocketHandshakeResponseReceived", ({ requestId, response }) => {
    const observation = observations.get(requestId);
    if (!observation) return;
    observation.status = response.status;
    observation.statusText = response.statusText;
    if (!resolved && response.status === 101 && isQlikAppWebSocketUrl(observation.url, appId)) {
      resolved = true;
      resolveAuthenticatedUrl(observation.url);
    }
  });
  client.on("Network.webSocketFrameError", ({ requestId, errorMessage }) => {
    const observation = observations.get(requestId);
    if (observation) observation.error = errorMessage;
  });

  const summary = () => JSON.stringify(Array.from(observations.values()).slice(-8).map((observation) => ({
    ...observation,
    url: safeSocketLocation(observation.url),
  })));
  const waitForAuthenticatedUrl = (timeout = 90_000) => new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Qlik Engine: a página não abriu uma conexão nativa autenticada. WebSockets observados: ${summary()}`));
    }, timeout);
    authenticatedUrl.then((url) => {
      clearTimeout(timer);
      resolve(url);
    });
  });

  return {
    summary,
    waitForAuthenticatedUrl,
    stop: () => client.detach().catch(() => undefined),
  };
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

async function readQlikEngineSnapshot(
  page: Page,
  socketUrl: string,
  appId: string,
  objectId: string,
  filters: QlikCloudTableOptions["filters"],
): Promise<QlikTableSnapshot> {
  return page.evaluate(async ({ socketUrl, appId, objectId, filters }) => {
    type RpcError = { code?: number; message?: string; parameter?: string };
    type RpcResult = Record<string, unknown>;
    type PendingCall = {
      resolve: (result: RpcResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    };
    type HyperCubeCell = { qText?: string; qNum?: number };
    type HyperCubeLayout = {
      qDimensionInfo?: Array<{ qFallbackTitle?: string }>;
      qMeasureInfo?: Array<{ qFallbackTitle?: string }>;
      qSize?: { qcx?: number; qcy?: number };
    };

    const socket = new WebSocket(socketUrl);
    const pending = new Map<number, PendingCall>();
    let requestId = 0;

    const closeWithError = (message: string) => {
      for (const call of pending.values()) {
        clearTimeout(call.timer);
        call.reject(new Error(message));
      }
      pending.clear();
    };

    socket.onmessage = (event) => {
      let response: { id?: number; result?: RpcResult; error?: RpcError };
      try {
        response = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (typeof response.id !== "number") return;
      const call = pending.get(response.id);
      if (!call) return;
      clearTimeout(call.timer);
      pending.delete(response.id);
      if (response.error) {
        call.reject(new Error(`Qlik Engine: ${response.error.message || "falha JSON-RPC"}${response.error.code ? ` (${response.error.code})` : ""}.`));
        return;
      }
      call.resolve(response.result || {});
    };
    socket.onclose = (event) => closeWithError(`Qlik Engine: conexão encerrada (${event.code}${event.reason ? ` - ${event.reason}` : ""}).`);

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Qlik Engine: tempo esgotado ao abrir o WebSocket.")), 30_000);
      socket.onopen = () => {
        window.clearTimeout(timer);
        resolve();
      };
      socket.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error("Qlik Engine: não foi possível abrir o WebSocket autenticado."));
      };
    });

    const call = (handle: number, method: string, params: RpcResult = {}) => new Promise<RpcResult>((resolve, reject) => {
      const id = ++requestId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Qlik Engine: tempo esgotado em ${method}.`));
      }, 45_000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, handle, method, params }));
    });

    try {
      const opened = await call(-1, "OpenDoc", { qDocName: appId });
      const docHandle = (opened.qReturn as { qHandle?: number } | undefined)?.qHandle;
      if (typeof docHandle !== "number") throw new Error("Qlik Engine: o aplicativo foi aberto sem um identificador de sessão.");

      await call(docHandle, "ClearAll", { qLockedAlso: true, qStateName: "$" });
      for (const filter of filters) {
        const fieldResult = await call(docHandle, "GetField", { qFieldName: filter.field, qStateName: "$" });
        const fieldHandle = (fieldResult.qReturn as { qHandle?: number } | undefined)?.qHandle;
        if (typeof fieldHandle !== "number") throw new Error(`Qlik Engine: campo “${filter.field}” não encontrado.`);
        const selected = await call(fieldHandle, "SelectValues", {
          qFieldValues: [{ qText: filter.value }],
          qToggleMode: false,
          qSoftLock: true,
        });
        if (selected.qReturn !== true) throw new Error(`Qlik Engine: não foi possível aplicar “${filter.field} = ${filter.value}”.`);
      }

      const objectResult = await call(docHandle, "GetObject", { qId: objectId });
      const objectHandle = (objectResult.qReturn as { qHandle?: number } | undefined)?.qHandle;
      if (typeof objectHandle !== "number") throw new Error(`Qlik Engine: objeto “${objectId}” não encontrado.`);
      const layoutResult = await call(objectHandle, "GetLayout");
      const layout = (layoutResult.qLayout as { qHyperCube?: HyperCubeLayout } | undefined)?.qHyperCube;
      if (!layout?.qSize) throw new Error(`Qlik Engine: o objeto “${objectId}” não contém uma tabela.`);

      const headers = [
        ...(layout.qDimensionInfo || []).map((item) => item.qFallbackTitle || ""),
        ...(layout.qMeasureInfo || []).map((item) => item.qFallbackTitle || ""),
      ];
      const columnCount = layout.qSize.qcx || headers.length;
      const rowCount = layout.qSize.qcy || 0;
      if (!columnCount) throw new Error(`Qlik Engine: a tabela “${objectId}” não contém colunas.`);
      const rows: string[][] = [];
      const pageHeight = Math.max(1, Math.min(1_000, Math.floor(10_000 / columnCount)));
      for (let top = 0; top < rowCount; top += pageHeight) {
        const dataResult = await call(objectHandle, "GetHyperCubeData", {
          qPath: "/qHyperCubeDef",
          qPages: [{
            qTop: top,
            qLeft: 0,
            qHeight: Math.min(pageHeight, rowCount - top),
            qWidth: columnCount,
          }],
        });
        const pages = dataResult.qDataPages as Array<{ qMatrix?: HyperCubeCell[][] }> | undefined;
        for (const matrixRow of pages?.[0]?.qMatrix || []) {
          rows.push(matrixRow.map((cell) => cell.qText ?? (Number.isFinite(cell.qNum) ? String(cell.qNum) : "")));
        }
      }
      return {
        headers,
        rows,
        selections: Object.fromEntries(filters.map((filter) => [filter.field, filter.value])),
      };
    } finally {
      socket.close(1000, "completed");
    }
  }, {
    socketUrl,
    appId,
    objectId,
    filters: filters.map((filter) => ({ ...filter })),
  });
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
  let socketObserver: Awaited<ReturnType<typeof observeNativeQlikSocket>> | null = null;
  try {
    const page = await browser.newPage();
    const appId = extractQlikAppId(options.sheetUrl);
    socketObserver = await observeNativeQlikSocket(page, appId);
    page.setDefaultTimeout(45_000);
    await page.emulateTimezone("America/Sao_Paulo");
    await page.goto(options.sheetUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await authenticateIfNeeded(page, options);
    await page.waitForFunction(() => !window.location.hostname.startsWith("login.") && /\/sense\/app\//i.test(window.location.pathname), {
      timeout: 120_000,
    });
    const socketUrl = await socketObserver.waitForAuthenticatedUrl();
    try {
      return await readQlikEngineSnapshot(page, socketUrl, appId, options.objectId, options.filters);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message} WebSockets observados: ${socketObserver.summary()}`);
    }
  } finally {
    if (socketObserver) await socketObserver.stop();
    await browser.close();
  }
}
