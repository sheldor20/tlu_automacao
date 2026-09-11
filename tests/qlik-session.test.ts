import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/qlik-cloud.ts", import.meta.url), "utf8");
const sessionSource = ts.transpileModule(source.slice(source.indexOf("export async function createQlikCloudMetricSession"))
  .replaceAll("export async", "async"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(fail = false) {
  const counts = { launched: 0, closed: 0, pages: 0, pagesClosed: 0 };
  const browser = {
    close: async () => { counts.closed++; },
    newPage: async () => {
      counts.pages++;
      return { setDefaultTimeout() {}, emulateTimezone: async () => {}, goto: async () => {}, waitForFunction: async () => {}, close: async () => { counts.pagesClosed++; } };
    },
  };
  const api = runInNewContext(`${sessionSource}\n({createQlikCloudMetricSession,scrapeQlikCloudMetrics})`, {
    launchBrowser: async () => { counts.launched++; return browser; },
    extractQlikAppId: () => "app",
    observeNativeQlikSocket: async () => ({ waitForAuthenticatedUrl: async () => "wss://test", summary: () => "test", stop: async () => {} }),
    authenticateIfNeeded: async () => {},
    readQlikEngineMetrics: async () => { if (fail) throw new Error("read failed"); return [{ value: 3340 }]; },
  });
  const options = { username: "test", password: "test", apps: [{ entryUrl: "https://test", metrics: [] }], year: 2026, throughMonth: 8 };
  return { counts, api, options };
}

test("lotes compartilham autenticação mas fecham cada página", async () => {
  const { counts, api, options } = harness();
  const session = await api.createQlikCloudMetricSession();
  await session.scrape(options);
  await session.scrape(options);
  assert.deepEqual(counts, { launched: 1, closed: 0, pages: 2, pagesClosed: 2 });
  await session.close();
  assert.equal(counts.closed, 1);
});

test("falha na leitura fecha a página e deixa a sessão sob controle da rota", async () => {
  const { counts, api, options } = harness(true);
  const session = await api.createQlikCloudMetricSession();
  await assert.rejects(session.scrape(options), /read failed/);
  assert.equal(counts.pagesClosed, 1);
  assert.equal(counts.closed, 0);
  await session.close();
  assert.equal(counts.closed, 1);
});

test("chamada independente continua fechando o próprio navegador", async () => {
  const { counts, api, options } = harness();
  await api.scrapeQlikCloudMetrics(options);
  assert.equal(counts.closed, 1);
});

test("inicialização concorrente extrai Chromium somente uma vez", async () => {
  let unpacked = 0;
  const launchSource = ts.transpileModule(source.slice(source.indexOf("let chromiumPathPromise"), source.indexOf("export async function diagnoseQlikBrowser")), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const launch = runInNewContext(`${launchSource}\nlaunchBrowser`, {
    process: { env: {} },
    chromium: { args: [], executablePath: async () => { unpacked++; await Promise.resolve(); return "/tmp/chromium"; } },
    puppeteer: { defaultArgs: async () => [], launch: async () => ({}) },
  });
  await Promise.all([launch(), launch()]);
  assert.equal(unpacked, 1);
});
