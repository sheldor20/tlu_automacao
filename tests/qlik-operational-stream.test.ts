import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("Qlik stream combines source pages without losing, duplicating or reordering rows", async () => {
  const source = readFileSync(
    new URL("../lib/qlik-operational.ts", import.meta.url),
    "utf8",
  );
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const browserWindow: Record<string, unknown> = {};
  class Socket {
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onclose?: () => void;
    constructor() {
      queueMicrotask(() => this.onopen?.());
    }
    send(raw: string) {
      const request = JSON.parse(raw);
      let result: unknown = {};
      if (
        ["OpenDoc", "GetVariableByName", "CreateSessionObject"].includes(
          request.method,
        )
      )
        result = { qReturn: { qHandle: 1 } };
      else if (request.method === "GetLayout")
        result = {
          qLayout: {
            qHyperCube: {
              qSize: { qcx: 13, qcy: 5000 },
              qDimensionInfo: Array.from({ length: 12 }, (_, i) => ({
                qFallbackTitle: "field" + i,
              })),
              qMeasureInfo: [{ qFallbackTitle: "amount" }],
              qGrandTotalRow: [{ qNum: 5000 }],
            },
          },
        };
      else if (request.method === "GetHyperCubeData") {
        const page = request.params.qPages[0];
        assert.ok(page.qWidth * page.qHeight <= 10000);
        result = {
          qDataPages: [
            {
              qMatrix: Array.from({ length: page.qHeight }, (_, i) =>
                Array.from({ length: 13 }, () => ({
                  qText: String(page.qTop + i),
                  qNum: page.qTop + i,
                })),
              ),
            },
          ],
        };
      }
      queueMicrotask(() =>
        this.onmessage?.({ data: JSON.stringify({ id: request.id, result }) }),
      );
    }
    close() {
      this.onclose?.();
    }
  }
  const exports: Record<string, unknown> = {};
  const page = {
    exposeFunction: async (name: string, callback: unknown) => {
      browserWindow[name] = callback;
    },
    evaluate: async (callback: (args: unknown) => unknown, args: unknown) =>
      callback(args),
  };
  runInNewContext(javascript, {
    exports,
    require: (name: string) => {
      assert.equal(name, "./qlik-cloud");
      return {
        withQlikOperationalPage: async (
          _: unknown,
          callback: (...args: unknown[]) => unknown,
        ) => callback(page, "wss://fixture", "app"),
      };
    },
    WebSocket: Socket,
    window: browserWindow,
    setTimeout,
    clearTimeout,
  });
  const read = exports.readOperationalQlik as (
    specs: unknown[],
    inspect: boolean,
    onPage: (cube: { rows: Array<Array<{ number: number }>> }) => Promise<void>,
  ) => Promise<unknown>;
  const sizes: number[] = [],
    ids: number[] = [];
  await read(
    [
      {
        key: "received",
        fields: Array.from({ length: 12 }, (_, i) => "field" + i),
        measureId: "measure",
      },
    ],
    false,
    async (cube) => {
      sizes.push(cube.rows.length);
      ids.push(...cube.rows.map((r) => r[0].number));
    },
  );
  assert.deepEqual(sizes, [3076, 1924]);
  assert.deepEqual(
    ids,
    Array.from({ length: 5000 }, (_, i) => i),
  );
});
