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

export type QlikCloudMetricDefinition = {
  metricKey: string;
  sheetId: string;
  objectId?: string;
  targetLabel: string;
  aliases?: ReadonlyArray<string>;
  mode: "monthly" | "snapshot" | "breakdown";
  periodStrategy?: "filters" | "series" | "date-field" | "date-through-month" | "date-last-day" | "date-last-business-day";
  dateField?: string;
  dateFieldCandidates?: ReadonlyArray<string>;
  exactDateField?: boolean;
  filters?: ReadonlyArray<QlikCloudMetricFilter>;
};

export type QlikCloudMetricFilter = {
  label: string;
  fieldCandidates: ReadonlyArray<string>;
  values?: ReadonlyArray<string>;
  contains?: ReadonlyArray<string>;
};

export type QlikCloudMetricApp = {
  entryUrl: string;
  metrics: ReadonlyArray<QlikCloudMetricDefinition>;
};

type QlikCloudMetricOptions = QlikCloudCredentials & {
  apps: ReadonlyArray<QlikCloudMetricApp>;
  year: number;
  throughMonth: number;
  yearFieldCandidates?: ReadonlyArray<string>;
  monthFieldCandidates?: ReadonlyArray<string>;
};

export type QlikMetricSnapshot = {
  metricKey: string;
  mode: QlikCloudMetricDefinition["mode"];
  referenceMonth: string;
  value: number;
  appId: string;
  sheetId: string;
  objectId: string;
  objectTitle: string;
  targetLabel: string;
  selections: Record<string, string>;
  dimensionKey?: string;
  dimensionLabel?: string;
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

async function readQlikEngineMetrics(
  page: Page,
  socketUrl: string,
  appId: string,
  metrics: ReadonlyArray<QlikCloudMetricDefinition>,
  year: number,
  throughMonth: number,
  yearFieldCandidates: ReadonlyArray<string>,
  monthFieldCandidates: ReadonlyArray<string>,
): Promise<QlikMetricSnapshot[]> {
  return page.evaluate(async ({
    socketUrl,
    appId,
    metrics,
    year,
    throughMonth,
    yearFieldCandidates,
    monthFieldCandidates,
  }) => {
    type RpcError = { code?: number; message?: string };
    type RpcResult = Record<string, unknown>;
    type PendingCall = {
      resolve: (result: RpcResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    };
    type ObjectInfo = { qId?: string; qType?: string };
    type HyperCubeCell = { qText?: string; qNum?: number; qIsNumeric?: boolean };
    type ObjectCandidate = {
      id: string;
      type: string;
      labels: string[];
      dimensionCount: number;
      measureCount: number;
      columnCount: number;
      rowCount: number;
    };
    type FieldValue = { text: string; number?: number };

    const normalize = (value: string) => value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .toLowerCase();
    const monthAliases: Record<number, string[]> = {
      1: ["1", "01", "jan", "janeiro"],
      2: ["2", "02", "fev", "fevereiro"],
      3: ["3", "03", "mar", "marco"],
      4: ["4", "04", "abr", "abril"],
      5: ["5", "05", "mai", "maio"],
      6: ["6", "06", "jun", "junho"],
      7: ["7", "07", "jul", "julho"],
      8: ["8", "08", "ago", "agosto"],
      9: ["9", "09", "set", "setembro"],
      10: ["10", "out", "outubro"],
      11: ["11", "nov", "novembro"],
      12: ["12", "dez", "dezembro"],
    };

    const socket = new WebSocket(socketUrl);
    const pending = new Map<number, PendingCall>();
    let requestId = 0;

    const closeWithError = (message: string) => {
      for (const pendingCall of pending.values()) {
        clearTimeout(pendingCall.timer);
        pendingCall.reject(new Error(message));
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
      const pendingCall = pending.get(response.id);
      if (!pendingCall) return;
      clearTimeout(pendingCall.timer);
      pending.delete(response.id);
      if (response.error) {
        pendingCall.reject(new Error(`Qlik Engine: ${response.error.message || "falha JSON-RPC"}${response.error.code ? ` (${response.error.code})` : ""}.`));
        return;
      }
      pendingCall.resolve(response.result || {});
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

    const handleFrom = (result: RpcResult) => (
      (result.qReturn as { qHandle?: number } | undefined)?.qHandle
    );

    const labelsFromLayout = (layout: unknown) => {
      const labels: string[] = [];
      const visited = new Set<unknown>();
      const visit = (value: unknown, key = "", depth = 0) => {
        if (depth > 7 || value === null || value === undefined) return;
        if (typeof value === "string") {
          if (/(title|label|subtitle|description|fallback)/i.test(key) && value.trim()) labels.push(value.trim());
          return;
        }
        if (typeof value !== "object" || visited.has(value)) return;
        visited.add(value);
        if (Array.isArray(value)) {
          value.slice(0, 100).forEach((item) => visit(item, key, depth + 1));
          return;
        }
        Object.entries(value as Record<string, unknown>).forEach(([childKey, child]) => visit(child, childKey, depth + 1));
      };
      visit(layout);
      return [...new Set(labels)];
    };

    const scoreLabel = (actual: string, expected: string) => {
      const actualNormalized = normalize(actual);
      const expectedNormalized = normalize(expected);
      if (!actualNormalized || !expectedNormalized) return 0;
      if (actualNormalized === expectedNormalized) return 1_000;
      if (actualNormalized.startsWith(expectedNormalized) || expectedNormalized.startsWith(actualNormalized)) return 800;
      if (actualNormalized.includes(expectedNormalized) || expectedNormalized.includes(actualNormalized)) return 700;
      const tokens = expectedNormalized.split(" ").filter((token) => token.length > 2);
      return tokens.length && tokens.every((token) => actualNormalized.includes(token)) ? 500 + tokens.length : 0;
    };

    const parseLocalizedNumber = (value: string) => {
      const cleaned = value.trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".").replace(/[^-\d.]/g, "");
      const parsed = Number(cleaned);
      return cleaned && Number.isFinite(parsed) ? parsed : null;
    };

    try {
      const opened = await call(-1, "OpenDoc", { qDocName: appId });
      const docHandle = handleFrom(opened);
      if (typeof docHandle !== "number") throw new Error("Qlik Engine: o aplicativo foi aberto sem um identificador de sessão.");

      const sheetCache = new Map<string, ObjectCandidate[]>();
      const candidateObjects = async (sheetId: string) => {
        const cached = sheetCache.get(sheetId);
        if (cached) return cached;
        const sheetResult = await call(docHandle, "GetObject", { qId: sheetId });
        const sheetHandle = handleFrom(sheetResult);
        if (typeof sheetHandle !== "number") throw new Error(`Qlik Engine: planilha “${sheetId}” não encontrada.`);

        const queue: ObjectInfo[] = [];
        const knownIds = new Set<string>([sheetId]);
        const candidates: ObjectCandidate[] = [];
        const addInfos = (result: RpcResult) => {
          const infos = (result.qInfos as ObjectInfo[] | undefined) || [];
          for (const info of infos) {
            if (info.qId && !knownIds.has(info.qId)) {
              knownIds.add(info.qId);
              queue.push(info);
            }
          }
        };
        addInfos(await call(sheetHandle, "GetChildInfos"));

        while (queue.length) {
          const info = queue.shift()!;
          try {
            const objectResult = await call(docHandle, "GetObject", { qId: info.qId! });
            const objectHandle = handleFrom(objectResult);
            if (typeof objectHandle !== "number") continue;
            const layoutResult = await call(objectHandle, "GetLayout");
            const layout = layoutResult.qLayout as {
              qHyperCube?: {
                qDimensionInfo?: unknown[];
                qMeasureInfo?: unknown[];
                qSize?: { qcx?: number; qcy?: number };
              };
            } | undefined;
            const labels = labelsFromLayout(layout);
            candidates.push({
              id: info.qId!,
              type: info.qType || "unknown",
              labels,
              dimensionCount: layout?.qHyperCube?.qDimensionInfo?.length || 0,
              measureCount: layout?.qHyperCube?.qMeasureInfo?.length || 0,
              columnCount: layout?.qHyperCube?.qSize?.qcx || 0,
              rowCount: layout?.qHyperCube?.qSize?.qcy || 0,
            });
            try {
              addInfos(await call(objectHandle, "GetChildInfos"));
            } catch {
              // Visualizações sem filhos podem rejeitar GetChildInfos; elas continuam válidas.
            }
          } catch {
            // Objetos auxiliares sem permissão de leitura não impedem a busca dos KPIs.
          }
        }
        if (!candidates.length) throw new Error(`Qlik Engine: a planilha “${sheetId}” não retornou visualizações filhas.`);
        sheetCache.set(sheetId, candidates);
        return candidates;
      };

      const resolvedMetrics = new Map<string, ObjectCandidate>();
      for (const metric of metrics) {
        const candidates = await candidateObjects(metric.sheetId);
        if (metric.objectId) {
          const pinned = candidates.find((candidate) => candidate.id === metric.objectId);
          if (!pinned) {
            throw new Error(
              `Qlik Engine: o objeto fixado “${metric.objectId}” para “${metric.targetLabel}” não existe na planilha ${metric.sheetId}. `
              + `IDs disponíveis: ${candidates.slice(0, 120).map((candidate) => candidate.id).join(" | ") || "nenhum"}.`,
            );
          }
          resolvedMetrics.set(metric.metricKey, pinned);
          continue;
        }
        const expectedLabels = [metric.targetLabel, ...(metric.aliases || [])];
        const ranked = candidates.map((candidate) => ({
          candidate,
          labelScore: Math.max(0, ...candidate.labels.flatMap((label) => expectedLabels.map((expected) => scoreLabel(label, expected)))),
          structureScore: metric.periodStrategy === "series" || metric.mode === "breakdown"
            ? (candidate.dimensionCount > 0 && candidate.measureCount > 0 ? 450 : 0)
              + (candidate.rowCount > 1 ? 250 : 0)
              + (candidate.measureCount === 1 ? 150 : 0)
              - (/kpi|gauge/i.test(candidate.type) ? 400 : 0)
            : (/kpi|gauge/i.test(candidate.type) ? 400 : 0)
              + (candidate.dimensionCount === 0 && candidate.measureCount > 0 ? 300 : 0)
              + (candidate.measureCount === 1 ? 150 : 0)
              + (candidate.columnCount === 1 ? 100 : 0)
              + (candidate.rowCount === 1 ? 50 : 0),
        })).filter((item) => item.labelScore > 0).map((item) => ({
          ...item,
          score: item.labelScore * 10 + item.structureScore,
        })).sort((a, b) => b.score - a.score);
        if (!ranked.length) {
          const available = candidates.slice(0, 40).map((candidate) => (
            `${candidate.id} [tipo=${candidate.type}; dimensões=${candidate.dimensionCount}; medidas=${candidate.measureCount}; `
            + `tamanho=${candidate.columnCount}x${candidate.rowCount}; rótulos=${candidate.labels.slice(0, 4).join(" / ") || "nenhum"}]`
          ));
          throw new Error(`Qlik Engine: indicador “${metric.targetLabel}” não encontrado na planilha ${metric.sheetId}. Objetos disponíveis: ${available.join(" | ") || "nenhum"}.`);
        }
        if (ranked.length > 1 && ranked[0].score === ranked[1].score) {
          const details = ranked.slice(0, 5).map(({ candidate, labelScore, structureScore }) => (
            `${candidate.id} [tipo=${candidate.type}; dimensões=${candidate.dimensionCount}; medidas=${candidate.measureCount}; `
            + `tamanho=${candidate.columnCount}x${candidate.rowCount}; texto=${labelScore}; estrutura=${structureScore}; `
            + `rótulos=${candidate.labels.slice(0, 4).join(" / ") || "nenhum"}]`
          )).join(" | ");
          throw new Error(`Qlik Engine: indicador “${metric.targetLabel}” continua ambíguo após priorizar KPIs de valor único. Candidatos: ${details}.`);
        }
        resolvedMetrics.set(metric.metricKey, ranked[0].candidate);
      }

      const fieldListResult = await call(docHandle, "CreateSessionObject", {
        qProp: {
          qInfo: { qType: "terra-lotus-field-list" },
          qFieldListDef: {
            qShowSystem: false,
            qShowHidden: false,
            qShowSemantic: true,
            qShowSrcTables: true,
          },
        },
      });
      const fieldListHandle = handleFrom(fieldListResult);
      if (typeof fieldListHandle !== "number") throw new Error("Qlik Engine: não foi possível criar a lista de campos.");
      const fieldListLayout = await call(fieldListHandle, "GetLayout");
      const fieldNames = ((fieldListLayout.qLayout as {
        qFieldList?: { qItems?: Array<{ qName?: string }> };
      } | undefined)?.qFieldList?.qItems || []).map((item) => item.qName || "").filter(Boolean);

      const findFields = (candidates: string[]) => {
        const exact = candidates.map(normalize);
        const exactMatches = fieldNames.filter((field) => exact.includes(normalize(field)));
        const partialMatches = fieldNames.filter((field) => {
            const normalizedField = ` ${normalize(field)} `;
            return exact.some((candidate) => normalizedField.includes(` ${candidate} `));
          });
        return [...new Set([...exactMatches, ...partialMatches])];
      };

      const findField = (candidates: string[], kind: string) => {
        const found = findFields(candidates)[0];
        if (!found) {
          throw new Error(
            `Qlik Engine: campo de ${kind} não encontrado. Candidatos: ${candidates.join(", ")}. `
            + `Campos disponíveis no aplicativo: ${fieldNames.slice(0, 160).join(" | ") || "nenhum"}.`,
          );
        }
        return found;
      };

      const findExactField = (candidates: string[], kind: string) => {
        const normalizedCandidates = new Set(candidates.map(normalize));
        const found = fieldNames.find((field) => normalizedCandidates.has(normalize(field)));
        if (!found) {
          const availableDateFields = fieldNames.filter((field) => /data|posi|compet|refer/i.test(normalize(field)));
          throw new Error(
            `Qlik Engine: campo exato de ${kind} não encontrado. Candidatos: ${candidates.join(", ")}. `
            + `Campos de data/posição disponíveis: ${availableDateFields.slice(0, 160).join(" | ") || "nenhum"}.`,
          );
        }
        return found;
      };

      const needsMonthlyFilters = metrics.some((metric) => (
        metric.mode === "monthly" && (!metric.periodStrategy || metric.periodStrategy === "filters")
      ));
      const yearField = needsMonthlyFilters ? findField([...yearFieldCandidates], "ano") : "";
      const monthField = needsMonthlyFilters ? findField([...monthFieldCandidates], "mês") : "";

      const fieldValuesCache = new Map<string, FieldValue[]>();
      const fieldValues = async (fieldName: string): Promise<FieldValue[]> => {
        const cached = fieldValuesCache.get(fieldName);
        if (cached) return cached;
        const result = await call(docHandle, "CreateSessionObject", {
          qProp: {
            qInfo: { qType: "terra-lotus-field-values" },
            qListObjectDef: {
              qStateName: "$",
              qDef: { qFieldDefs: [fieldName] },
              qInitialDataFetch: [{ qTop: 0, qLeft: 0, qHeight: 500, qWidth: 1 }],
            },
          },
        });
        const handle = handleFrom(result);
        if (typeof handle !== "number") throw new Error(`Qlik Engine: não foi possível ler os valores de “${fieldName}”.`);
        const layoutResult = await call(handle, "GetLayout");
        const listObject = (layoutResult.qLayout as {
          qListObject?: {
            qDataPages?: Array<{ qMatrix?: HyperCubeCell[][] }>;
            qSize?: { qcy?: number };
          };
        } | undefined)?.qListObject;
        let matrix = listObject?.qDataPages?.[0]?.qMatrix || [];
        const rowCount = listObject?.qSize?.qcy || matrix.length;
        for (let top = matrix.length; top < rowCount; top += 5_000) {
          const dataResult = await call(handle, "GetListObjectData", {
            qPath: "/qListObjectDef",
            qPages: [{ qTop: top, qLeft: 0, qHeight: Math.min(5_000, rowCount - top), qWidth: 1 }],
          });
          matrix = matrix.concat((dataResult.qDataPages as Array<{ qMatrix?: HyperCubeCell[][] }> | undefined)?.[0]?.qMatrix || []);
        }
        const values = matrix.map((row) => ({
          text: row[0]?.qText || "",
          number: Number.isFinite(row[0]?.qNum) ? row[0]?.qNum : undefined,
        })).filter((value) => value.text);
        fieldValuesCache.set(fieldName, values);
        return values;
      };

      const yearValues = needsMonthlyFilters ? await fieldValues(yearField) : [];
      const monthValues = needsMonthlyFilters ? await fieldValues(monthField) : [];
      const selectedYear = yearValues.find((value) => normalize(value.text) === String(year));
      if (needsMonthlyFilters && !selectedYear) {
        throw new Error(`Qlik Engine: o ano ${year} não existe no campo “${yearField}”.`);
      }

      const selectValues = async (fieldName: string, values: FieldValue[]) => {
        const fieldResult = await call(docHandle, "GetField", { qFieldName: fieldName, qStateName: "$" });
        const fieldHandle = handleFrom(fieldResult);
        if (typeof fieldHandle !== "number") throw new Error(`Qlik Engine: campo “${fieldName}” não encontrado.`);
        const selected = await call(fieldHandle, "SelectValues", {
          qFieldValues: values.map((value) => ({
            qText: value.text,
            ...(typeof value.number === "number" ? { qIsNumeric: true, qNumber: value.number } : {}),
          })),
          qToggleMode: false,
          qSoftLock: true,
        });
        if (selected.qReturn !== true) throw new Error(`Qlik Engine: não foi possível selecionar ${values.length} valor(es) em “${fieldName}”.`);
      };

      const selectValue = (fieldName: string, value: FieldValue) => selectValues(fieldName, [value]);

      const applyMetricFilters = async (metric: QlikCloudMetricDefinition) => {
        const selections: Record<string, string> = {};
        for (const filter of metric.filters || []) {
          const expectedValues = (filter.values || []).map(normalize);
          const expectedFragments = (filter.contains || []).map(normalize);
          const candidateFields = findFields([...filter.fieldCandidates]);
          if (!candidateFields.length) {
            throw new Error(
              `Qlik Engine: nenhum campo compatível foi encontrado para o filtro “${filter.label}”. `
              + `Candidatos: ${filter.fieldCandidates.join(" | ")}. `
              + `Campos disponíveis: ${fieldNames.slice(0, 160).join(" | ") || "nenhum"}.`,
            );
          }

          let selectedField = "";
          let selectedValues: FieldValue[] = [];
          const attempts: string[] = [];
          for (const fieldName of candidateFields) {
            const available = await fieldValues(fieldName);
            const matching = available.filter((value) => {
              const actual = normalize(value.text);
              return expectedValues.includes(actual)
                || expectedFragments.some((fragment) => fragment && actual.includes(fragment));
            });
            if (matching.length) {
              selectedField = fieldName;
              selectedValues = matching;
              break;
            }
            if (attempts.length < 30) {
              attempts.push(`${fieldName}: ${available.slice(0, 12).map((value) => value.text).join(", ") || "sem valores"}`);
            }
          }
          if (!selectedField) {
            throw new Error(
              `Qlik Engine: o filtro “${filter.label}” não encontrou os valores procurados em nenhum campo compatível. `
              + `Procurado: ${[...(filter.values || []), ...(filter.contains || [])].join(" | ") || "nenhum"}. `
              + `Campos testados: ${attempts.join(" || ") || candidateFields.join(" | ")}.`,
            );
          }
          await selectValues(selectedField, selectedValues);
          selections[selectedField] = selectedValues.map((value) => value.text).join(" | ");
        }
        return selections;
      };

      const fieldValueDate = (value: FieldValue) => {
        if (typeof value.number === "number" && value.number >= 20_000 && value.number < 100_000) {
          return new Date(Date.UTC(1899, 11, 30) + Math.floor(value.number) * 86_400_000);
        }
        const brazilian = value.text.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/);
        if (brazilian) return new Date(Date.UTC(Number(brazilian[3]), Number(brazilian[2]) - 1, Number(brazilian[1])));
        const iso = value.text.match(/\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/);
        if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
        return null;
      };

      const readMetric = async (metric: QlikCloudMetricDefinition, referenceMonth: string, selections: Record<string, string>) => {
        const object = resolvedMetrics.get(metric.metricKey)!;
        const objectResult = await call(docHandle, "GetObject", { qId: object.id });
        const objectHandle = handleFrom(objectResult);
        if (typeof objectHandle !== "number") throw new Error(`Qlik Engine: objeto “${object.id}” não encontrado.`);
        const layoutResult = await call(objectHandle, "GetLayout");
        const hyperCube = (layoutResult.qLayout as {
          qHyperCube?: {
            qDimensionInfo?: unknown[];
            qMeasureInfo?: unknown[];
            qSize?: { qcx?: number; qcy?: number };
          };
        } | undefined)?.qHyperCube;
        if (!hyperCube?.qSize?.qcx || !hyperCube.qSize.qcy) {
          throw new Error(`Qlik Engine: “${metric.targetLabel}” não retornou dados para ${referenceMonth}.`);
        }
        const dataResult = await call(objectHandle, "GetHyperCubeData", {
          qPath: "/qHyperCubeDef",
          qPages: [{ qTop: 0, qLeft: 0, qHeight: 1, qWidth: hyperCube.qSize.qcx }],
        });
        const cells = (dataResult.qDataPages as Array<{ qMatrix?: HyperCubeCell[][] }> | undefined)?.[0]?.qMatrix?.[0] || [];
        const dimensionCount = hyperCube.qDimensionInfo?.length || 0;
        const measureCells = cells.slice(dimensionCount).length ? cells.slice(dimensionCount) : cells;
        let value: number | null = null;
        for (const cell of measureCells) {
          if (Number.isFinite(cell.qNum)) {
            value = cell.qNum!;
            break;
          }
          const parsed = parseLocalizedNumber(cell.qText || "");
          if (parsed !== null) {
            value = parsed;
            break;
          }
        }
        if (value === null) throw new Error(`Qlik Engine: “${metric.targetLabel}” retornou um valor não numérico em ${referenceMonth}.`);
        return {
          metricKey: metric.metricKey,
          mode: metric.mode,
          referenceMonth,
          value,
          appId,
          sheetId: metric.sheetId,
          objectId: object.id,
          objectTitle: object.labels[0] || metric.targetLabel,
          targetLabel: metric.targetLabel,
          selections,
        };
      };

      const referenceMonthFromCells = (cells: HyperCubeCell[]) => {
        const texts = cells.map((cell) => cell.qText || "").filter(Boolean);
        const combined = texts.join(" ");
        const normalized = normalize(combined);
        const tokens = normalized.split(" ").filter(Boolean);
        let parsedYear = Number(tokens.find((token) => /^20\d{2}$/.test(token)));
        let parsedMonth = 0;

        for (const [monthNumber, aliases] of Object.entries(monthAliases)) {
          if (aliases.map(normalize).some((alias) => tokens.includes(alias))) {
            parsedMonth = Number(monthNumber);
            break;
          }
        }

        const yearMonth = combined.match(/\b(20\d{2})\s*[./-]\s*(\d{1,2})\b/)
          || combined.match(/\b(20\d{2})\s+(\d{1,2})\b/);
        const monthYear = combined.match(/\b(\d{1,2})\s*[./-]\s*(20\d{2})\b/)
          || combined.match(/\b(\d{1,2})\s+(20\d{2})\b/);
        if (yearMonth) {
          parsedYear = Number(yearMonth[1]);
          parsedMonth = Number(yearMonth[2]);
        } else if (monthYear) {
          parsedYear = Number(monthYear[2]);
          parsedMonth = Number(monthYear[1]);
        }

        const numbers = cells.map((cell) => cell.qNum).filter((value): value is number => Number.isFinite(value));
        const numericYear = numbers.find((value) => Number.isInteger(value) && value >= 2000 && value <= 2100);
        const numericMonth = numbers.find((value) => Number.isInteger(value) && value >= 1 && value <= 12);
        if (!parsedYear && numericYear) parsedYear = numericYear;
        if (!parsedMonth && numericMonth) parsedMonth = numericMonth;

        const yearMonthNumber = numbers.find((value) => Number.isInteger(value) && value >= 200001 && value <= 210012);
        if (yearMonthNumber) {
          parsedYear = Math.floor(yearMonthNumber / 100);
          parsedMonth = yearMonthNumber % 100;
        }

        const qlikDate = numbers.find((value) => value >= 20_000 && value < 100_000);
        if ((!parsedYear || !parsedMonth) && qlikDate) {
          const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(qlikDate) * 86_400_000);
          parsedYear = date.getUTCFullYear();
          parsedMonth = date.getUTCMonth() + 1;
        }

        if (!parsedYear && parsedMonth) parsedYear = year;
        if (parsedYear !== year || parsedMonth < 1 || parsedMonth > throughMonth) return null;
        return `${parsedYear}-${String(parsedMonth).padStart(2, "0")}-01`;
      };

      const readMetricSeries = async (metric: QlikCloudMetricDefinition) => {
        const object = resolvedMetrics.get(metric.metricKey)!;
        const objectResult = await call(docHandle, "GetObject", { qId: object.id });
        const objectHandle = handleFrom(objectResult);
        if (typeof objectHandle !== "number") throw new Error(`Qlik Engine: objeto “${object.id}” não encontrado.`);
        const layoutResult = await call(objectHandle, "GetLayout");
        const hyperCube = (layoutResult.qLayout as {
          qHyperCube?: {
            qDimensionInfo?: unknown[];
            qMeasureInfo?: unknown[];
            qSize?: { qcx?: number; qcy?: number };
          };
        } | undefined)?.qHyperCube;
        const dimensionCount = hyperCube?.qDimensionInfo?.length || 0;
        const columnCount = hyperCube?.qSize?.qcx || 0;
        const rowCount = hyperCube?.qSize?.qcy || 0;
        if (!dimensionCount || !hyperCube?.qMeasureInfo?.length || !columnCount || !rowCount) {
          throw new Error(`Qlik Engine: “${metric.targetLabel}” não contém uma série mensal.`);
        }

        const byMonth = new Map<string, QlikMetricSnapshot>();
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
          const matrix = (dataResult.qDataPages as Array<{ qMatrix?: HyperCubeCell[][] }> | undefined)?.[0]?.qMatrix || [];
          for (const cells of matrix) {
            const referenceMonth = referenceMonthFromCells(cells.slice(0, dimensionCount));
            if (!referenceMonth) continue;
            const measureCells = cells.slice(dimensionCount);
            let value: number | null = null;
            for (const cell of measureCells) {
              if (Number.isFinite(cell.qNum)) {
                value = cell.qNum!;
                break;
              }
              const parsed = parseLocalizedNumber(cell.qText || "");
              if (parsed !== null) {
                value = parsed;
                break;
              }
            }
            if (value === null) throw new Error(`Qlik Engine: “${metric.targetLabel}” retornou valor não numérico em ${referenceMonth}.`);
            if (byMonth.has(referenceMonth)) {
              throw new Error(`Qlik Engine: “${metric.targetLabel}” retornou mais de uma linha para ${referenceMonth}.`);
            }
            byMonth.set(referenceMonth, {
              metricKey: metric.metricKey,
              mode: metric.mode,
              referenceMonth,
              value,
              appId,
              sheetId: metric.sheetId,
              objectId: object.id,
              objectTitle: object.labels[0] || metric.targetLabel,
              targetLabel: metric.targetLabel,
              selections: { série: "mensal do objeto Qlik" },
            });
          }
        }
        return [...byMonth.values()];
      };

      const readMetricBreakdown = async (
        metric: QlikCloudMetricDefinition,
        referenceMonth: string,
        selections: Record<string, string>,
      ) => {
        const object = resolvedMetrics.get(metric.metricKey)!;
        const objectResult = await call(docHandle, "GetObject", { qId: object.id });
        const objectHandle = handleFrom(objectResult);
        if (typeof objectHandle !== "number") throw new Error(`Qlik Engine: objeto “${object.id}” não encontrado.`);
        const layoutResult = await call(objectHandle, "GetLayout");
        const hyperCube = (layoutResult.qLayout as {
          qHyperCube?: {
            qDimensionInfo?: unknown[];
            qMeasureInfo?: unknown[];
            qSize?: { qcx?: number; qcy?: number };
          };
        } | undefined)?.qHyperCube;
        const dimensionCount = hyperCube?.qDimensionInfo?.length || 0;
        const columnCount = hyperCube?.qSize?.qcx || 0;
        const rowCount = hyperCube?.qSize?.qcy || 0;
        if (!dimensionCount || !hyperCube?.qMeasureInfo?.length || !columnCount || !rowCount) {
          throw new Error(`Qlik Engine: “${metric.targetLabel}” não contém uma composição por dimensão.`);
        }

        const totals = new Map<string, { label: string; value: number }>();
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
          const matrix = (dataResult.qDataPages as Array<{ qMatrix?: HyperCubeCell[][] }> | undefined)?.[0]?.qMatrix || [];
          for (const cells of matrix) {
            const label = cells.slice(0, dimensionCount).map((cell) => cell.qText || "").filter(Boolean).join(" · ").trim();
            if (!label || /^[-–]$/.test(label)) continue;
            const measureCell = cells.slice(dimensionCount).find((cell) => Number.isFinite(cell.qNum) || parseLocalizedNumber(cell.qText || "") !== null);
            if (!measureCell) continue;
            const value = Number.isFinite(measureCell.qNum) ? measureCell.qNum! : parseLocalizedNumber(measureCell.qText || "")!;
            const key = normalize(label).replace(/\s+/g, "-") || "sem-identificacao";
            const current = totals.get(key);
            totals.set(key, { label, value: (current?.value || 0) + value });
          }
        }
        if (!totals.size) throw new Error(`Qlik Engine: “${metric.targetLabel}” não retornou itens para ${referenceMonth}.`);
        return [...totals.entries()].map(([dimensionKey, item]) => ({
          metricKey: metric.metricKey,
          mode: metric.mode,
          referenceMonth,
          value: item.value,
          appId,
          sheetId: metric.sheetId,
          objectId: object.id,
          objectTitle: object.labels[0] || metric.targetLabel,
          targetLabel: metric.targetLabel,
          selections,
          dimensionKey,
          dimensionLabel: item.label,
        }));
      };

      const snapshots: QlikMetricSnapshot[] = [];
      const seriesMetrics = metrics.filter((metric) => metric.mode === "monthly" && metric.periodStrategy === "series");
      if (seriesMetrics.length) {
        await call(docHandle, "ClearAll", { qLockedAlso: true, qStateName: "$" });
        for (const metric of seriesMetrics) {
          await call(docHandle, "ClearAll", { qLockedAlso: true, qStateName: "$" });
          await applyMetricFilters(metric);
          snapshots.push(...await readMetricSeries(metric));
        }
      }

      const dateFieldMetrics = metrics.filter((metric) => (
        metric.mode === "monthly" && ["date-field", "date-through-month", "date-last-day", "date-last-business-day"].includes(metric.periodStrategy || "")
      ));
      const dateFields = new Map(dateFieldMetrics.map((metric) => {
        if (!metric.dateField) throw new Error(`Qlik Engine: “${metric.targetLabel}” não definiu o campo de data.`);
        const candidates = [metric.dateField, ...(metric.dateFieldCandidates || [])];
        return [metric.metricKey, metric.exactDateField
          ? findExactField(candidates, `data de ${metric.targetLabel}`)
          : findField(candidates, `data de ${metric.targetLabel}`)];
      }));
      const dateValues = new Map<string, FieldValue[]>();
      for (const fieldName of new Set(dateFields.values())) {
        const values = await fieldValues(fieldName);
        if (!values.length) throw new Error(`Qlik Engine: o campo de data “${fieldName}” não possui valores.`);
        dateValues.set(fieldName, values);
      }

      for (let month = 1; month <= throughMonth; month += 1) {
        for (const metric of dateFieldMetrics) {
          await call(docHandle, "ClearAll", { qLockedAlso: true, qStateName: "$" });
          const selections = await applyMetricFilters(metric);
          const fieldName = dateFields.get(metric.metricKey)!;
          let matchingDates = (dateValues.get(fieldName) || []).filter((value) => {
            const date = fieldValueDate(value);
            if (!date) return false;
            if (metric.periodStrategy === "date-through-month") {
              return date.getTime() < Date.UTC(year, month, 1);
            }
            const belongsToMonth = date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month;
            if (metric.periodStrategy !== "date-last-business-day") return belongsToMonth;
            return belongsToMonth && date.getUTCDay() >= 1 && date.getUTCDay() <= 5;
          });
          if (["date-last-day", "date-last-business-day"].includes(metric.periodStrategy || "") && matchingDates.length) {
            const latestTimestamp = Math.max(...matchingDates.map(fieldValueDate).filter((date): date is Date => Boolean(date)).map((date) => date.getTime()));
            matchingDates = matchingDates.filter((value) => fieldValueDate(value)?.getTime() === latestTimestamp);
          }
          const referenceMonth = `${year}-${String(month).padStart(2, "0")}-01`;
          if (!matchingDates.length) {
            const object = resolvedMetrics.get(metric.metricKey)!;
            snapshots.push({
              metricKey: metric.metricKey,
              mode: metric.mode,
              referenceMonth,
              value: 0,
              appId,
              sheetId: metric.sheetId,
              objectId: object.id,
              objectTitle: object.labels[0] || metric.targetLabel,
              targetLabel: metric.targetLabel,
              selections: { ...selections, [fieldName]: `${referenceMonth} (nenhuma data; resultado 0)` },
            });
            continue;
          }
          await selectValues(fieldName, matchingDates);
          const lastSelectedDate = matchingDates
            .map(fieldValueDate)
            .filter((date): date is Date => Boolean(date))
            .sort((a, b) => b.getTime() - a.getTime())[0]
            ?.toISOString().slice(0, 10);
          snapshots.push(await readMetric(metric, referenceMonth, {
            ...selections,
            [fieldName]: metric.periodStrategy === "date-through-month"
              ? `até o fim de ${referenceMonth} (${matchingDates.length} datas)`
              : metric.periodStrategy === "date-last-day"
                ? `último dia disponível de ${referenceMonth} (${matchingDates.length} valor(es))`
                : metric.periodStrategy === "date-last-business-day"
                  ? `último dia útil disponível de ${referenceMonth} (${matchingDates.length} valor(es))`
                : `${referenceMonth} (${matchingDates.length} datas)`,
            ...(lastSelectedDate ? { reference_date: lastSelectedDate } : {}),
          }));
        }
      }

      const monthlyMetrics = metrics.filter((metric) => (
        metric.mode === "monthly" && (!metric.periodStrategy || metric.periodStrategy === "filters")
      ));
      for (let month = 1; month <= throughMonth && monthlyMetrics.length; month += 1) {
        const aliases = monthAliases[month].map(normalize);
        const selectedMonth = monthValues.find((value) => {
          const tokens = normalize(value.text).split(" ").filter(Boolean);
          return aliases.some((alias) => tokens.includes(alias));
        })
          || monthValues.find((value) => value.number === month);
        if (!selectedMonth) throw new Error(`Qlik Engine: o mês ${month} não existe no campo “${monthField}”.`);
        const referenceMonth = `${year}-${String(month).padStart(2, "0")}-01`;
        for (const metric of monthlyMetrics) {
          await call(docHandle, "ClearAll", { qLockedAlso: true, qStateName: "$" });
          const selections = await applyMetricFilters(metric);
          await selectValue(yearField, selectedYear!);
          await selectValue(monthField, selectedMonth);
          snapshots.push(await readMetric(metric, referenceMonth, {
            ...selections,
            [yearField]: selectedYear!.text,
            [monthField]: selectedMonth.text,
          }));
        }
      }

      const snapshotMetrics = metrics.filter((metric) => metric.mode === "snapshot");
      if (snapshotMetrics.length) {
        const referenceMonth = `${year}-${String(throughMonth).padStart(2, "0")}-01`;
        for (const metric of snapshotMetrics) {
          await call(docHandle, "ClearAll", { qLockedAlso: true, qStateName: "$" });
          const selections = await applyMetricFilters(metric);
          snapshots.push(await readMetric(metric, referenceMonth, selections));
        }
      }

      const breakdownMetrics = metrics.filter((metric) => metric.mode === "breakdown");
      for (const metric of breakdownMetrics) {
        await call(docHandle, "ClearAll", { qLockedAlso: true, qStateName: "$" });
        const selections = await applyMetricFilters(metric);
        const closedMonth = throughMonth > 1 ? throughMonth - 1 : 12;
        const closedYear = throughMonth > 1 ? year : year - 1;
        const referenceMonth = `${closedYear}-${String(closedMonth).padStart(2, "0")}-01`;
        if (!metric.dateField) throw new Error(`Qlik Engine: “${metric.targetLabel}” não definiu o campo de data.`);
        const fieldName = findField([metric.dateField, ...(metric.dateFieldCandidates || [])], `data de ${metric.targetLabel}`);
        const matchingDates = (await fieldValues(fieldName)).filter((value) => {
          const date = fieldValueDate(value);
          return date?.getUTCFullYear() === closedYear && date.getUTCMonth() + 1 === closedMonth;
        });
        if (!matchingDates.length) throw new Error(`Qlik Engine: “${metric.targetLabel}” não encontrou datas no mês fechado ${referenceMonth}.`);
        await selectValues(fieldName, matchingDates);
        const lastSelectedDate = matchingDates
          .map(fieldValueDate)
          .filter((date): date is Date => Boolean(date))
          .sort((a, b) => b.getTime() - a.getTime())[0]
          ?.toISOString().slice(0, 10);
        snapshots.push(...await readMetricBreakdown(metric, referenceMonth, {
          ...selections,
          [fieldName]: `${referenceMonth} (${matchingDates.length} datas)`,
          ...(lastSelectedDate ? { reference_date: lastSelectedDate } : {}),
        }));
      }
      return snapshots;
    } finally {
      socket.close(1000, "completed");
    }
  }, {
    socketUrl,
    appId,
    metrics: metrics.map((metric) => ({
      ...metric,
      aliases: metric.aliases ? [...metric.aliases] : [],
      dateFieldCandidates: metric.dateFieldCandidates ? [...metric.dateFieldCandidates] : [],
      filters: metric.filters?.map((filter) => ({
        ...filter,
        fieldCandidates: [...filter.fieldCandidates],
        values: filter.values ? [...filter.values] : [],
        contains: filter.contains ? [...filter.contains] : [],
      })) || [],
    })),
    year,
    throughMonth,
    yearFieldCandidates: [...yearFieldCandidates],
    monthFieldCandidates: [...monthFieldCandidates],
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

export async function scrapeQlikCloudMetrics(options: QlikCloudMetricOptions): Promise<QlikMetricSnapshot[]> {
  if (!Number.isInteger(options.year) || options.year < 2000 || options.year > 2100) {
    throw new Error(`Qlik: ano inválido para a sincronização: ${options.year}.`);
  }
  if (!Number.isInteger(options.throughMonth) || options.throughMonth < 1 || options.throughMonth > 12) {
    throw new Error(`Qlik: mês final inválido para a sincronização: ${options.throughMonth}.`);
  }
  const browser = await launchBrowser();
  const snapshots: QlikMetricSnapshot[] = [];
  try {
    for (const app of options.apps) {
      const page = await browser.newPage();
      let socketObserver: Awaited<ReturnType<typeof observeNativeQlikSocket>> | null = null;
      try {
        const appId = extractQlikAppId(app.entryUrl);
        socketObserver = await observeNativeQlikSocket(page, appId);
        page.setDefaultTimeout(45_000);
        await page.emulateTimezone("America/Sao_Paulo");
        await page.goto(app.entryUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
        await authenticateIfNeeded(page, options);
        await page.waitForFunction(() => !window.location.hostname.startsWith("login.") && /\/sense\/app\//i.test(window.location.pathname), {
          timeout: 120_000,
        });
        const socketUrl = await socketObserver.waitForAuthenticatedUrl();
        try {
          snapshots.push(...await readQlikEngineMetrics(
            page,
            socketUrl,
            appId,
            app.metrics,
            options.year,
            options.throughMonth,
            options.yearFieldCandidates || ["Ano", "Ano Venda", "Ano da Venda", "Ano Competência", "Ano Competencia", "Year"],
            options.monthFieldCandidates || [
              "Mês", "Mes", "Mês Venda", "Mes Venda", "Mês da Venda", "Mes da Venda", "Month",
              "Mês Ano", "Mes Ano", "Ano Mês", "Ano Mes", "YearMonth", "MonthYear",
              "Competência", "Competencia", "Período", "Periodo",
            ],
          ));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`${message} WebSockets observados: ${socketObserver.summary()}`);
        }
      } finally {
        if (socketObserver) await socketObserver.stop();
        await page.close().catch(() => undefined);
      }
    }
    return snapshots;
  } finally {
    await browser.close();
  }
}
