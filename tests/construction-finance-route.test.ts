import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as finance from "../lib/construction-finance.ts";
const id = "11111111-1111-4111-8111-111111111111",
  at = "2026-10-22T12:00:00Z";
class PaymentError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown };
function harness({
  role = "writer",
  inherited = false,
  snapshotChanges = false,
}: { role?: string; inherited?: boolean; snapshotChanges?: boolean } = {}) {
  const writes: Array<{ table: string; data: Row; service: boolean }> = [];
  const reads: string[] = [];
  let connectionReads = 0;
  const tables: Record<string, Row[]> = {
    constructions: [
      {
        id,
        name: "Teste",
        source_business_id: inherited ? "business" : null,
        qlik_work_key: "test|001",
        qlik_additional_work_keys: [],
        updated_at: at,
      },
    ],
    qlik_works: [
      { key: "test|001", active: true },
      { key: "test|002", active: true },
      { key: "test|003", active: false },
    ],
    operational_cash_entries: Array.from({ length: 1003 }, (_, i) => ({
      id: `entry-${i}`,
      work_key: "test|001",
      kind: "paid",
      active: true,
      cash_date: "2026-10-01",
      amount: 1,
      source_category: "9.118",
    })),
    operational_imports: [
      { kind: "paid", status: "success" },
      { kind: "payable", status: "success" },
    ],
    data_connections: [
      {
        slug: "qlik-operations",
        active: true,
        settings: { paid: { at }, payable: { at } },
      },
    ],
  };
  const client = (service: boolean) => ({
    from(table: string) {
      reads.push(table);
      const filters: Array<(r: Row) => boolean> = [];
      let update: Row | null = null,
        single = false,
        from = 0,
        to = Infinity;
      const q = {
        select: () => q,
        order: () => q,
        eq: (k: string, v: unknown) => {
          filters.push((r) => r[k] === v);
          return q;
        },
        is: (k: string, v: unknown) => {
          filters.push((r) => r[k] === v);
          return q;
        },
        in: (k: string, v: unknown[]) => {
          filters.push((r) => v.includes(r[k]));
          return q;
        },
        range: (a: number, b: number) => {
          from = a;
          to = b;
          return q;
        },
        limit: (n: number) => {
          to = n - 1;
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
        update: (data: Row) => {
          update = data;
          return q;
        },
        then(resolve: (r: Result) => unknown) {
          const rows = (tables[table] || [])
            .filter((r) => filters.every((f) => f(r)))
            .slice(from, to + 1);
          if (update && rows.length) {
            writes.push({ table, data: update, service });
            Object.assign(rows[0], update);
          }
          if (
            table === "data_connections" &&
            ++connectionReads > 1 &&
            snapshotChanges
          )
            return Promise.resolve(
              resolve({
                data: {
                  settings: {
                    paid: { at: "2026-10-22T13:00:00Z" },
                    payable: { at },
                  },
                },
                error: null,
              }),
            );
          return Promise.resolve(
            resolve({ data: single ? rows[0] || null : rows, error: null }),
          );
        },
      };
      return q;
    },
  });
  const db = client(false),
    service = client(true);
  // Use the production pagination helper with isolated I/O, not a replacement aggregate.
  const operationsSource = readFileSync(
    new URL("../lib/operations-server.ts", import.meta.url),
    "utf8",
  );
  const opExports: Record<string, unknown> = {};
  runInNewContext(
    ts.transpileModule(operationsSource, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText,
    {
      exports: opExports,
      require: (name: string) =>
        name === "./payment-server" ? { PaymentError } : {},
    },
  );
  const exports: Record<string, unknown> = {};
  runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL("../app/api/operations/construction/route.ts", import.meta.url),
        "utf8",
      ),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
        },
      },
    ).outputText,
    {
      exports,
      URL,
      Date,
      require: (name: string) => {
        if (name === "zod") return { z };
        if (name === "@/lib/construction-finance") return finance;
        if (name === "@/lib/payment-server")
          return {
            PaymentError,
            paymentBody: (r: Request) => r.json(),
            paymentJson: (data: unknown) => Response.json(data),
            paymentFailure: (e: Error) =>
              Response.json(
                { error: e.message },
                { status: e instanceof PaymentError ? e.status : 400 },
              ),
          };
        if (name === "@/lib/operations-server")
          return {
            ...opExports,
            operationsAccess: async (
              _r: Request,
              modules: string[],
              write = false,
            ) => {
              assert.equal(modules.join(","), "obras");
              if (role === "outsider" || (write && role === "viewer"))
                throw new PaymentError("forbidden", 403);
              return { db, service, canWrite: role === "writer", actor: { admin: role === "writer" } };
            },
          };
        throw new Error(name);
      },
    },
  );
  const post = (body: unknown) =>
    (exports.POST as (r: Request) => Promise<Response>)(
      new Request("http://local/api/operations/construction", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
  const get = () =>
    (exports.GET as (r: Request) => Promise<Response>)(
      new Request(`http://local/api/operations/construction?id=${id}`),
    );
  return { post, get, writes, reads, tables };
}
const link = (patch: Row = {}) => ({
  action: "link",
  id,
  work_keys: ["test|001", "test|002"],
  confirmed: true,
  expected_updated_at: at,
  ...patch,
});
test("endpoint recusa todos os comandos financeiros antigos sem escrita", async () => {
  const h = harness();
  for (const action of [
    "commitment",
    "estimate",
    "stage_budget",
    "stage_mapping",
    "budget",
    "anything",
  ])
    assert.equal((await h.post({ action, id, amount: 999 })).status, 405);
  assert.equal(h.writes.length, 0);
});
test("endpoint aplica vínculo explícito atomicamente via cliente do usuário e rejeita ambiguidades/inativos/conflitos", async () => {
  const h = harness();
  for (const patch of [
    { work_keys: ["001"] },
    { work_keys: ["test|001", "test|001"] },
    { confirmed: false },
  ])
    assert.equal((await h.post(link(patch))).status, 400);
  assert.equal((await h.post(link({ work_keys: ["test|003"] }))).status, 422);
  assert.equal(
    (await h.post(link({ expected_updated_at: "2026-01-01T00:00:00Z" })))
      .status,
    409,
  );
  assert.equal(h.writes.length, 0);
  assert.equal((await h.post(link())).status, 200);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].table, "constructions");
  assert.equal(h.writes[0].service, false);
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes[0].data)), {
    qlik_work_key: "test|001",
    qlik_additional_work_keys: ["test|002"],
  });
});
test("endpoint respeita acesso de viewer, nega outro módulo e preserva vínculo herdado", async () => {
  for (const role of ["viewer", "outsider"])
    assert.equal((await harness({ role }).post(link())).status, 403);
  assert.equal((await harness({ role: "outsider" }).get()).status, 403);
  const h = harness({ inherited: true });
  assert.equal((await h.post(link({ work_keys: ["test|002"] }))).status, 409);
  assert.equal(h.writes.length, 0);
});
test("leitura pagina todas as linhas, usa publicação da fonte e não mistura legados", async () => {
  const h = harness();
  h.tables.construction_commitments = [{ construction_id: id, amount: 999999 }];
  const response = await h.get();
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.monthly.paid, 1003);
  assert.equal(data.monthly.payable, null);
  assert.equal(data.sources.paid.at, at);
  assert.equal(data.commitments.length, 1);
  assert.equal(
    h.reads.filter((s) => s === "operational_cash_entries").length,
    2,
  );
  assert.equal(h.writes.length, 0);
});
test("sem vínculo não consulta movimentos; mudança de publicação durante paginação exige recarga", async () => {
  const h = harness();
  h.tables.constructions[0].qlik_work_key = null;
  const data = await (await h.get()).json();
  assert.equal(data.monthly.paid, null);
  assert.equal(h.reads.includes("operational_cash_entries"), false);
  assert.equal((await harness({ snapshotChanges: true }).get()).status, 409);
});
