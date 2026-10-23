/* The VM runs the actual server modules with network/storage dependencies replaced. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as policy from "../lib/accountability/policy.ts";

const id = "11111111-1111-4111-8111-111111111111";
const token = "22222222-2222-4222-8222-222222222222";
const providerId = "33333333-3333-4333-8333-333333333333";
const enterpriseId = "44444444-4444-4444-8444-444444444444";
const old = new Date(Date.now() - 20 * 60000).toISOString();
const snapshot = {
  from: "test@example.test",
  ...policy.monthlyEmail("Nome legível", "setembro de 2026"),
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
function base(extra: any = {}) {
  return {
    id,
    enterprise_id: enterpriseId,
    year: 2026,
    month: 9,
    historical_sent: true,
    status: "processing",
    updated_at: old,
    processing_started_at: old,
    processing_token: token,
    provider_attempted_at: null,
    provider_id: null,
    email_snapshot: null,
    pdf_path: "original.pdf",
    excel_path: "original.xlsx",
    ...extra,
  };
}
function database(row: any = base()) {
  const rows = row ? [row] : [];
  const writes: any[] = [];
  let fail: ((data: any) => { commit?: boolean } | null) | undefined;
  let tick = 0;
  const service = {
    from(table: string) {
      assert.equal(table, "accountability_dispatches");
      const filters: ((r: any) => boolean)[] = [];
      let values: any,
        insert = false,
        single = false;
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => {
          filters.push((r) => r[k] === v);
          return q;
        },
        is: (k: string, v: any) => {
          filters.push((r) => (r[k] ?? null) === v);
          return q;
        },
        gt: (k: string, v: string) => {
          filters.push((r) => r[k] != null && Date.parse(r[k]) > Date.parse(v));
          return q;
        },
        single: () => {
          single = true;
          return q;
        },
        maybeSingle: () => {
          single = true;
          return q;
        },
        update: (v: any) => {
          values = v;
          return q;
        },
        insert: (v: any) => {
          insert = true;
          values = v;
          return q;
        },
        then(resolve: any) {
          if (insert && rows.length)
            return Promise.resolve(
              resolve({ data: null, error: { code: "23505" } }),
            );
          if (insert) rows.push(base({ ...values, id }));
          const selected = rows.filter((r) => filters.every((f) => f(r)));
          const failure = values && fail?.(values);
          if (values && (!failure || failure.commit))
            for (const r of selected) {
              writes.push(structuredClone(values));
              Object.assign(r, values, {
                updated_at: new Date(Date.now() + ++tick).toISOString(),
              });
            }
          return Promise.resolve(
            resolve({
              data: failure
                ? null
                : structuredClone(single ? (selected[0] ?? null) : selected),
              error: failure ? { message: "DB unavailable" } : null,
            }),
          );
        },
      };
      return q;
    },
  };
  return {
    service,
    rows,
    writes,
    failUpdate(fn: typeof fail) {
      fail = fn;
    },
  };
}
function moduleCode(file: string, deps: any, globals: any = {}) {
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports: any = {};
  runInNewContext(output, {
    exports,
    require: (key: string) => {
      if (!(key in deps)) throw new Error(`Unmocked import ${key}`);
      return deps[key];
    },
    console,
    Date,
    Error,
    Buffer,
    crypto: globalThis.crypto,
    AbortSignal,
    URL,
    Request,
    Response,
    fetch: () => {
      throw new Error("Real network is forbidden in tests");
    },
    process: {
      env: {
        RESEND_API_KEY: "fake",
        RESEND_FROM_EMAIL: snapshot.from,
        NEXT_PUBLIC_SUPABASE_URL: "https://db.example.test",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "fake-anon",
        SUPABASE_SERVICE_ROLE_KEY: "fake-service",
      },
    },
    ...globals,
  });
  return exports;
}
const dispatch = moduleCode("lib/accountability/dispatch.ts", {
  "./policy": policy,
});
function sender(
  fetcher: any,
  artifacts: any = async () => ({
    pdf: Buffer.from("pdf"),
    excel: Buffer.from("xlsx"),
    reference: "setembro de 2026",
  }),
) {
  return moduleCode(
    "lib/accountability/send.ts",
    {
      "./artifacts": { accountabilityArtifacts: artifacts },
      "./policy": policy,
      "./dispatch": dispatch,
    },
    { fetch: fetcher },
  ).sendAccountabilityDispatch;
}
const send = (fn: any, db: any, t = token, authorize = async () => true) =>
  fn(
    db.service,
    id,
    t,
    { name: "Nome legível", qlik_value: "28|03" },
    2026,
    9,
    authorize,
  );
function accepted(extra: any = {}) {
  return {
    id: providerId,
    created_at: new Date().toISOString(),
    ...snapshot,
    to: [snapshot.to],
    tags: [
      { name: "dispatch_id", value: id },
      { name: "attempt_id", value: token },
    ],
    ...extra,
  };
}

test("only one concurrent claimant wins; existing history and artifact paths survive", async () => {
  const db = database(base({ status: "historical", processing_token: null }));
  const outcomes = await Promise.allSettled(
    [1, 2].map(() =>
      dispatch.claimDispatch(db.service, enterpriseId, 2026, 9, "user"),
    ),
  );
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  assert.equal(db.rows[0].historical_sent, true);
  assert.equal(db.rows[0].pdf_path, "original.pdf");
});
test("a fresh processing job cannot be recovered or claimed again", async () => {
  const db = database(
    base({ processing_started_at: new Date().toISOString() }),
  );
  await assert.rejects(
    dispatch.recoverDispatch(db.service, id),
    /ainda pode estar ativo/,
  );
  await assert.rejects(
    dispatch.claimDispatch(db.service, enterpriseId, 2026, 9, "user"),
    /incerto/,
  );
  assert.equal(db.writes.length, 0);
});
test("crash before send can be released, then token fencing blocks the old worker", async () => {
  const db = database();
  const result = await dispatch.recoverDispatch(db.service, id, () =>
    assert.fail("must not call provider"),
  );
  assert.equal(result.status, "failed");
  const next = await dispatch.claimDispatch(
    db.service,
    enterpriseId,
    2026,
    9,
    "user",
  );
  assert.notEqual(next.token, token);
  await send(
    sender(() => assert.fail("old worker sent")),
    db,
  );
  assert.equal(db.rows[0].processing_token, next.token);
  assert.equal(db.rows[0].provider_attempted_at, null);
});
test("legacy interrupted/failed jobs have no phase proof and cannot be resent", async () => {
  for (const status of ["processing", "failed"]) {
    const db = database(
      base({ status, processing_token: null, processing_started_at: null }),
    );
    const result = await dispatch.recoverDispatch(db.service, id, () =>
      assert.fail("no correlation exists"),
    );
    assert.equal(result.status, "uncertain");
    await assert.rejects(
      dispatch.claimDispatch(db.service, enterpriseId, 2026, 9, "user"),
      /incerto/,
    );
  }
});
test("empty provider results never permit retry, even after the 24h idempotency window", async () => {
  const db = database(
    base({
      status: "uncertain",
      provider_attempted_at: "2026-01-01T00:00:00Z",
      email_snapshot: snapshot,
    }),
  );
  let calls = 0;
  const result = await dispatch.recoverDispatch(
    db.service,
    id,
    async (_url: string, opts: any) => {
      calls++;
      assert.equal(opts.method, "GET");
      return json({ data: [], has_more: false });
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.status, "uncertain");
  await assert.rejects(
    dispatch.claimDispatch(db.service, enterpriseId, 2026, 9, "user"),
  );
});
test("positive provider evidence reconciles a lost ID through paginated reads, without sending", async () => {
  const db = database(
    base({
      status: "uncertain",
      provider_attempted_at: old,
      email_snapshot: snapshot,
    }),
  );
  let calls = 0;
  const response = accepted();
  const result = await dispatch.recoverDispatch(
    db.service,
    id,
    async (url: string, opts: any) => {
      assert.equal(opts.method, "GET");
      calls++;
      if (url.includes(`/emails/${providerId}`)) return json(response);
      if (url.includes("?after="))
        return json({
          data: [
            { id: providerId, subject: snapshot.subject, to: [snapshot.to] },
          ],
          has_more: false,
        });
      return json({
        data: [{ id: enterpriseId, subject: "Other" }],
        has_more: true,
      });
    },
  );
  assert.equal(calls, 3);
  assert.equal(result.status, "sent_beta");
  assert.equal(db.rows[0].provider_id, providerId);
  assert.equal(db.rows[0].sent_at, response.created_at);
  assert.match(result.message, /não confirma entrega/);
});
test("same subject/recipient from a different dispatch or attempt is not proof", async () => {
  for (const tags of [
    [],
    [
      { name: "dispatch_id", value: id },
      { name: "attempt_id", value: enterpriseId },
    ],
  ]) {
    const db = database(
      base({
        status: "uncertain",
        provider_attempted_at: old,
        email_snapshot: snapshot,
      }),
    );
    const result = await dispatch.recoverDispatch(
      db.service,
      id,
      async (url: string) =>
        json(
          url.endsWith(`/emails/${providerId}`)
            ? accepted({ tags })
            : { data: [accepted()], has_more: false },
        ),
    );
    assert.equal(result.status, "uncertain");
  }
});
test("known provider ID is read and matched; 403/404/500 are not evidence of non-send", async () => {
  for (const status of [403, 404, 500]) {
    const db = database(
      base({
        status: "uncertain",
        provider_id: providerId,
        provider_attempted_at: old,
      }),
    );
    const result = await dispatch.recoverDispatch(db.service, id, async () =>
      json({ error: "unavailable" }, status),
    );
    assert.equal(result.status, "uncertain");
    assert.equal(db.rows[0].provider_id, providerId);
  }
  const db = database(base({ status: "uncertain", provider_id: providerId }));
  assert.equal(
    (
      await dispatch.recoverDispatch(db.service, id, async () =>
        json(accepted()),
      )
    ).status,
    "sent_beta",
  );
});
test("reconciliation does not overwrite a concurrent change", async () => {
  const db = database(base({ status: "uncertain", provider_id: providerId }));
  await assert.rejects(
    dispatch.recoverDispatch(db.service, id, async () => {
      db.rows[0].updated_at = new Date().toISOString();
      return json(accepted());
    }),
    /mudou/,
  );
  assert.equal(db.rows[0].status, "uncertain");
});
test("send uses display name for email and technical code only for export; marker precedes fetch", async () => {
  const db = database(
    base({ processing_started_at: new Date().toISOString() }),
  );
  let exported = "";
  const fn = sender(
    async (_url: string, opts: any) => {
      assert.ok(db.rows[0].provider_attempted_at);
      const body = JSON.parse(opts.body);
      assert.match(body.subject, /Nome legível/);
      assert.doesNotMatch(body.subject + body.text, /28\|03/);
      assert.equal(body.to, policy.BETA_RECIPIENT);
      assert.equal(body.tags[1].value, token);
      assert.equal(
        body.attachments[0].content,
        Buffer.from("original pdf").toString("base64"),
      );
      return json({ id: providerId });
    },
    async (_db: any, _id: string, value: string) => {
      exported = value;
      return {
        pdf: Buffer.from("original pdf"),
        excel: Buffer.from("original xlsx"),
        reference: "setembro de 2026",
      };
    },
  );
  assert.equal((await send(fn, db)).sent, true);
  assert.equal(exported, "28|03");
  assert.equal(db.rows[0].status, "sent_beta");
});
test("timeout, non-2xx and malformed provider acceptance stay uncertain", async () => {
  for (const response of [
    async () => {
      throw new Error("timeout");
    },
    async () => json({}, 500),
    async () => json({}),
    async () => json({ id: "invalid" }),
    async () => new Response("invalid"),
  ]) {
    const db = database(
      base({ processing_started_at: new Date().toISOString() }),
    );
    assert.equal((await send(sender(response), db)).sent, false);
    assert.equal(db.rows[0].status, "uncertain");
    assert.ok(db.rows[0].provider_attempted_at);
    await assert.rejects(
      dispatch.claimDispatch(db.service, enterpriseId, 2026, 9, "user"),
    );
  }
});
test("failure to persist acceptance preserves provider ID for later GET reconciliation", async () => {
  const db = database(
    base({ processing_started_at: new Date().toISOString() }),
  );
  db.failUpdate((v) => (v.status === "sent_beta" ? {} : null));
  await send(
    sender(async () => json({ id: providerId })),
    db,
  );
  assert.equal(db.rows[0].status, "uncertain");
  assert.equal(db.rows[0].provider_id, providerId);
  db.failUpdate(undefined);
  assert.equal(
    (
      await dispatch.recoverDispatch(db.service, id, async () =>
        json(accepted()),
      )
    ).status,
    "sent_beta",
  );
});
test("commit whose response is lost must not be downgraded by the catch path", async () => {
  const db = database(
    base({ processing_started_at: new Date().toISOString() }),
  );
  db.failUpdate((v) => (v.status === "sent_beta" ? { commit: true } : null));
  await send(
    sender(async () => json({ id: providerId })),
    db,
  );
  assert.equal(db.rows[0].status, "sent_beta");
});
test("permission revocation and artifact failure do not attempt a send", async () => {
  for (const artifactFails of [true, false]) {
    const db = database(
      base({ processing_started_at: new Date().toISOString() }),
    );
    const fn = sender(
      () => assert.fail("provider call forbidden"),
      artifactFails
        ? async () => {
            throw new Error("artifact unavailable");
          }
        : undefined,
    );
    await send(fn, db, token, async () => false);
    assert.equal(db.rows[0].status, "failed");
    assert.equal(db.rows[0].provider_attempted_at, null);
    assert.equal(dispatch.safeToRetry(db.rows[0]), true);
  }
});
test("failed durable attempt registration never calls provider", async () => {
  const db = database(
    base({ processing_started_at: new Date().toISOString() }),
  );
  db.failUpdate((v) => (v.provider_attempted_at ? {} : null));
  await send(
    sender(() => assert.fail("unregistered send")),
    db,
  );
  assert.equal(db.rows[0].status, "uncertain");
});

function routeHarness(authorized = true) {
  const db = database(base({ status: "uncertain", processing_token: null }));
  let sent = 0;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user" } } }) },
    rpc: async () => ({ data: authorized }),
  };
  const route = moduleCode("app/api/accountability/route.ts", {
    "@supabase/supabase-js": {
      createClient: (_url: string, key: string) =>
        key === "fake-service" ? db.service : client,
    },
    "next/server": {
      NextResponse: {
        json: (body: unknown, init: any = {}) => json(body, init.status || 200),
      },
      after: () => {
        sent++;
      },
    },
    zod: { z },
    "@/lib/accountability/policy": policy,
    "@/lib/accountability/book": { exportConfigured: () => false },
    "@/lib/accountability/send": {
      sendAccountabilityDispatch: () => {
        sent++;
      },
    },
    "@/lib/accountability/dispatch": dispatch,
  });
  return { route, db, sent: () => sent };
}
test("recovery endpoint requires department permission and never schedules generation", async () => {
  for (const authorized of [false, true]) {
    const h = routeHarness(authorized);
    const response = await h.route.POST(
      new Request("https://tlu.example.test/api/accountability", {
        method: "POST",
        headers: { Authorization: "Bearer fake" },
        body: JSON.stringify({ action: "recover", dispatchId: id }),
      }),
    );
    assert.equal(response.status, authorized ? 200 : 403);
    assert.equal(h.sent(), 0);
    if (!authorized) assert.equal(h.db.writes.length, 0);
  }
});
test("browser cannot supply provider evidence, identity, recipient or arbitrary status", async () => {
  for (const extra of [
    { providerId },
    { status: "sent_beta" },
    { recipient: "other@example.test" },
  ]) {
    const h = routeHarness();
    const response = await h.route.POST(
      new Request("https://tlu.example.test/api/accountability", {
        method: "POST",
        headers: { Authorization: "Bearer fake" },
        body: JSON.stringify({ action: "recover", dispatchId: id, ...extra }),
      }),
    );
    assert.equal(response.status, 400);
    assert.equal(h.sent(), 0);
    assert.equal(h.db.writes.length, 0);
  }
});

test("artifact worker cannot replace stored paths after losing its processing token", async () => {
  const db = database(base());
  const removed: string[][] = [];
  Object.assign(db.service, {
    storage: {
      from: () => ({
        upload: async () => {
          db.rows[0].processing_token = enterpriseId;
          return { error: null };
        },
        remove: async (paths: string[]) => {
          removed.push(paths);
          return {};
        },
      }),
    },
  });
  db.rows[0].pdf_path = null;
  db.rows[0].excel_path = null;
  const artifacts = moduleCode("lib/accountability/artifacts.ts", {
    "node:crypto": {
      createHash: () => ({ update: () => ({ digest: () => "hash" }) }),
    },
    "./book": {
      createAccountabilityBook: async () => ({
        pdf: Buffer.from("pdf"),
        excel: Buffer.from("xlsx"),
      }),
    },
  });
  await assert.rejects(
    artifacts.accountabilityArtifacts(db.service, id, "28|03", 2026, 9, token),
    /registrar/,
  );
  assert.equal(db.rows[0].pdf_path, null);
  assert.equal(removed.length, 1);
  assert.ok(removed[0].every((p) => p.startsWith(id + "/")));
});
test("uncertain artifact metadata commit preserves uploaded bytes rather than deleting referenced files", async () => {
  const db = database(base({ pdf_path: null, excel_path: null }));
  db.failUpdate((v) => (v.pdf_path ? { commit: true } : null));
  Object.assign(db.service, {
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () =>
          assert.fail("uncertain write must not delete artifacts"),
      }),
    },
  });
  const artifacts = moduleCode("lib/accountability/artifacts.ts", {
    "node:crypto": {
      createHash: () => ({ update: () => ({ digest: () => "hash" }) }),
    },
    "./book": {
      createAccountabilityBook: async () => ({
        pdf: Buffer.from("pdf"),
        excel: Buffer.from("xlsx"),
      }),
    },
  });
  await assert.rejects(
    artifacts.accountabilityArtifacts(db.service, id, "28|03", 2026, 9, token),
  );
  assert.match(db.rows[0].pdf_path, /book\.pdf$/);
});
