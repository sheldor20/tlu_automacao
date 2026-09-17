import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyDigestEmail, dailyDigestOrigin, type DailyDigest } from "../lib/daily-digest.ts";
import { dispatchDailyDigests, handleDailyDigestCron } from "../lib/daily-digest-server.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

const empty: DailyDigest = { name: "Ana", date: "2026-09-21", today_count: 0, overdue_count: 0, payment_count: 0, event_count: 0, today: [], overdue: [], payments: [] };
const task = { id: "task-1", title: '<img src=x onerror="alert(1)">', due_date: "2026-09-21", project_name: "Projeto & Companhia", href: "/projetos#quadro-tarefas" };

test("email vazio convida a começar, é individual e contém link para o sistema", () => {
  const email = buildDailyDigestEmail(empty, "ana@example.test", "Terra <app@example.test>", "https://app.example.test");
  assert.equal(email.subject, "Comece a usar o Terra Lótus Space");
  assert.deepEqual(email.to, ["ana@example.test"]);
  assert.match(email.html, /Começar a usar/);
  assert.match(email.text, /https:\/\/app.example.test\/hoje/);
  assert.doesNotMatch(email.html, /Tarefas vencidas/);
});
test("email inclui três seções, contagens completas, datas e HTML escapado", () => {
  const email = buildDailyDigestEmail({ ...empty, name: "Ana <teste>", today_count: 12, overdue_count: 1, payment_count: 1, event_count: 2,
    today: [task], overdue: [{ ...task, due_date: "2026-09-18" }], payments: [{ request_id: "payment-1", protocol: 10, title: "Pagamento", kind: "information_requested", status: "awaiting_information", event_count: 2 }] },
  "ana@example.test", "app@example.test", "https://app.example.test");
  assert.match(email.html, /Tarefas de hoje \(12\)/);
  assert.match(email.html, /Tarefas vencidas \(1\)/);
  assert.match(email.html, /Mais 11 no sistema/);
  assert.match(email.html, /18\/09\/2026/);
  assert.match(email.html, /Solicitações de pagamento com movimentação \(1\)/);
  assert.match(email.text, /\/pagamentos\/payment-1/);
  assert.match(email.html, /Ana &lt;teste&gt;/);
  assert.doesNotMatch(email.html, /<img/);
});
test("links usam somente a origem pública configurada, nunca o host recebido", () => {
  assert.equal(dailyDigestOrigin({ APP_URL: "https://app.example.test/path", PAYMENT_APP_URL: "https://other.test" }), "https://app.example.test");
  assert.equal(dailyDigestOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "production.example.test" }), "https://production.example.test");
  assert.throws(() => dailyDigestOrigin({ APP_URL: "http://app.example.test" }));
  assert.throws(() => dailyDigestOrigin({ APP_URL: "https://user:pass@app.example.test" }));
  assert.throws(() => dailyDigestOrigin({}));
});

function fakeQueue() {
  const jobs = [1, 2].map(id => ({ id: String(id), lease_id: `lease-${id}`, recipient: `${id}@example.test`, attempts: 1, content: null as DailyDigest | null, email_payload: null as ReturnType<typeof buildDailyDigestEmail> | null, status: "pending", provider_id: null as string | null }));
  let authorized = true;
  const db = {
    rpc: async (name: string) => {
      if (name === "claim_daily_digest") {
        const job = jobs.find(j => j.status === "pending");
        if (job) job.status = "sending";
        return { data: job ? [{ ...job }] : [], error: null };
      }
      return { data: name === "daily_digest_content" ? empty : authorized, error: null };
    },
    from: () => ({ update: (values: Record<string, unknown>) => {
      const filters: Record<string, string> = {};
      const query = { eq: (key: string, value: string) => { filters[key] = value; return query; }, select: async () => {
        const job = jobs.find(j => j.id === filters.id && j.lease_id === filters.lease_id && j.status === filters.status);
        if (job) Object.assign(job, values);
        return { data: job ? [{ id: job.id }] : [], error: null };
      } };
      return query;
    } }),
  } as unknown as SupabaseClient;
  return { jobs, db, revoke: () => { authorized = false; } };
}

test("falha de um destinatário não interrompe os outros; retry preserva corpo e chave", async () => {
  const queue = fakeQueue();
  const bodies: string[] = [], keys: string[] = [];
  let fail = true;
  const fetcher: typeof fetch = async (_url, init) => {
    bodies.push(String(init?.body));
    keys.push(new Headers(init?.headers).get("Idempotency-Key")!);
    if (fail) { fail = false; throw new Error("timeout"); }
    return Response.json({ id: "provider-id" });
  };
  const options = { db: queue.db, key: "test", from: "from@example.test", origin: "https://app.example.test", fetcher, pause: async () => {} };
  assert.deepEqual(await dispatchDailyDigests(options), { sent: 1, failed: 1, skipped: 0 });
  assert.equal(queue.jobs[0].status, "failed");
  queue.jobs[0].status = "pending";
  assert.deepEqual(await dispatchDailyDigests({ ...options, from: "changed@example.test" }), { sent: 1, failed: 0, skipped: 0 });
  assert.equal(bodies[0], bodies[2]);
  assert.equal(keys[0], keys[2]);
  assert.notEqual(keys[0], keys[1]);
});
test("revogação de acesso impede o envio de conteúdo já preparado", async () => {
  const queue = fakeQueue();
  queue.revoke();
  let calls = 0;
  const result = await dispatchDailyDigests({ db: queue.db, key: "test", from: "from@example.test", origin: "https://app.example.test", pause: async () => {}, fetcher: async () => { calls++; return Response.json({ id: "unexpected" }); } });
  assert.equal(calls, 0);
  assert.equal(result.skipped, 2);
});
test("cron nega segredo ausente ou incorreto e acusa configuração incompleta", async () => {
  const previous = process.env.CRON_SECRET, resend = process.env.RESEND_API_KEY;
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await handleDailyDigestCron(new Request("https://app.test/api/cron/daily-digest", { headers: { authorization: "Bearer undefined" } }), true)).status, 401);
    process.env.CRON_SECRET = "test-secret";
    assert.equal((await handleDailyDigestCron(new Request("https://app.test"), true)).status, 401);
    delete process.env.RESEND_API_KEY;
    assert.equal((await handleDailyDigestCron(new Request("https://app.test", { headers: { authorization: "Bearer test-secret" } }), true)).status, 503);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous;
    if (resend === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = resend;
  }
});
