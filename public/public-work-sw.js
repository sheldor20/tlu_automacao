/* global self, indexedDB */

const CACHE_VERSION = "public-work-v2";
const DOCUMENT_CACHE = `${CACHE_VERSION}-documents`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const DATABASE_NAME = "terra-lotus-public-work";
const DATABASE_VERSION = 1;
const SNAPSHOT_STORE = "snapshots";
const SUBMISSION_STORE = "submissions";
const SYNC_TAG = "public-work-updates";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Falha no armazenamento offline."));
  });
}

function transactionFinished(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("Operação offline cancelada."));
    transaction.onerror = () => reject(transaction.error || new Error("Falha na fila offline."));
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
        database.createObjectStore(SNAPSHOT_STORE, { keyPath: "token" });
      }
      if (!database.objectStoreNames.contains(SUBMISSION_STORE)) {
        const submissions = database.createObjectStore(SUBMISSION_STORE, { keyPath: "id" });
        submissions.createIndex("token", "token", { unique: false });
        submissions.createIndex("created_at", "created_at", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Falha ao abrir a fila offline."));
  });
}

async function listSubmissions() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SUBMISSION_STORE, "readonly");
    const records = await requestResult(transaction.objectStore(SUBMISSION_STORE).getAll());
    return records.sort((left, right) => left.created_at.localeCompare(right.created_at));
  } finally {
    database.close();
  }
}

async function putSubmission(submission) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SUBMISSION_STORE, "readwrite");
    transaction.objectStore(SUBMISSION_STORE).put(submission);
    await transactionFinished(transaction);
  } finally {
    database.close();
  }
}

async function removeSubmission(id) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SUBMISSION_STORE, "readwrite");
    transaction.objectStore(SUBMISSION_STORE).delete(id);
    await transactionFinished(transaction);
  } finally {
    database.close();
  }
}

function submissionBody(submission) {
  const body = new FormData();
  body.set("client_submission_id", submission.id);
  body.set("micro_stage_id", submission.micro_stage_id);
  body.set("progress_percent", String(submission.progress_percent));
  body.set("note", submission.note);
  body.set("supplies", JSON.stringify(submission.supplies));
  body.set("base_updated_at", submission.base_updated_at);
  if (submission.map_layer_id && submission.map_base_updated_at && submission.map_paths?.length) {
    body.set("map_layer_id", submission.map_layer_id);
    body.set("map_base_updated_at", submission.map_base_updated_at);
    body.set("map_paths", JSON.stringify(submission.map_paths));
  }
  body.set("photo", submission.photo, submission.photo_name);
  return body;
}

function retryableStatus(status) {
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  clients.forEach((client) => client.postMessage(message));
}

async function synchronizeSubmissions() {
  const submissions = await listSubmissions();
  const latestMicroUpdate = new Map();
  const latestLayerUpdate = new Map();
  let synchronized = 0;
  for (const queued of submissions) {
    if (queued.requires_review) continue;
    const submission = {
      ...queued,
      ...(latestMicroUpdate.has(queued.micro_stage_id) ? { base_updated_at: latestMicroUpdate.get(queued.micro_stage_id) } : {}),
      ...(queued.map_layer_id && latestLayerUpdate.has(queued.map_layer_id) ? { map_base_updated_at: latestLayerUpdate.get(queued.map_layer_id) } : {}),
    };
    if (submission !== queued) await putSubmission(submission);
    let response;
    try {
      response = await fetch(`/api/public/obras/${submission.token}`, { method: "POST", body: submissionBody(submission) });
    } catch {
      await putSubmission({ ...submission, attempts: submission.attempts + 1, last_error: "Sem conexão com o servidor." });
      throw new Error("A conexão ainda está indisponível.");
    }
    const result = await response.json().catch(() => ({}));
    if (response.ok) {
      await removeSubmission(submission.id);
      synchronized += 1;
      if (result.micro_stage_updated_at) latestMicroUpdate.set(submission.micro_stage_id, result.micro_stage_updated_at);
      if (submission.map_layer_id && result.map_layer_updated_at) latestLayerUpdate.set(submission.map_layer_id, result.map_layer_updated_at);
      continue;
    }
    const updated = {
      ...submission,
      attempts: submission.attempts + 1,
      last_error: result.error || "Não foi possível sincronizar a atualização.",
      requires_review: !retryableStatus(response.status),
    };
    await putSubmission(updated);
    if (retryableStatus(response.status)) throw new Error(updated.last_error);
  }
  await notifyClients({ type: "PUBLIC_WORK_SYNC_COMPLETE", synchronized });
}

async function cachePublicWork(url) {
  const response = await fetch(url, { cache: "reload" });
  if (response.ok) {
    const cache = await caches.open(DOCUMENT_CACHE);
    await cache.put(url, response.clone());
  }
}

async function cachePublicWorkAssets(urls) {
  const cache = await caches.open(ASSET_CACHE);
  await Promise.allSettled(urls.map(async (url) => {
    const response = await fetch(url, { cache: "reload" });
    if (response.ok) await cache.put(url, response.clone());
  }));
}

async function clearPublicWorkCache(token) {
  const cache = await caches.open(DOCUMENT_CACHE);
  const keys = await cache.keys();
  await Promise.all(keys.filter((request) => new URL(request.url).pathname.includes(`/obra-publica/${token}`)).map((request) => cache.delete(request)));
}

async function networkFirst(request) {
  const cache = await caches.open(DOCUMENT_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) return cached;
    return new Response("Abra este link uma vez com internet para ativar o acesso offline.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(ASSET_CACHE).then((cache) => cache.addAll(["/logo-terra-lotus.png"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("public-work-") && ![DOCUMENT_CACHE, ASSET_CACHE].includes(key)).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (/^\/api\/public\/obras\/[a-f0-9]{48}\/plans\/[0-9a-f-]+$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.pathname.startsWith("/api/public/obras/")) return;
  if (url.pathname.startsWith("/obra-publica/") && request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/_next/image") || url.pathname === "/logo-terra-lotus.png" || url.pathname.endsWith("/manifest.webmanifest")) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "CACHE_PUBLIC_WORK" && typeof event.data.url === "string") {
    const assets = Array.isArray(event.data.assets) ? event.data.assets.filter((url) => typeof url === "string") : [];
    event.waitUntil(Promise.all([
      cachePublicWork(event.data.url),
      cachePublicWorkAssets(assets),
    ]).then(() => notifyClients({ type: "PUBLIC_WORK_CACHE_READY" })));
  }
  if (event.data?.type === "CLEAR_PUBLIC_WORK_CACHE" && typeof event.data.token === "string") {
    event.waitUntil(clearPublicWorkCache(event.data.token));
  }
  if (event.data?.type === "SYNC_PUBLIC_WORK_NOW") {
    event.waitUntil(synchronizeSubmissions());
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(synchronizeSubmissions());
});
