import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { QLIK_SHEETS } from "../lib/accountability/policy.ts";

function harness(
  options: {
    duplicatePeriod?: boolean;
    reportError?: boolean;
    foreignDownload?: boolean;
    reload?: boolean;
  } = {},
) {
  const calls: { method: string; params: any }[] = [],
    reports: any[] = [];
  let objectCount = 10,
    revisionCalls = 0,
    expanded = false;
  const objects = new Map<number, string>();
  class Socket {
    onopen: () => void = () => {};
    onerror: () => void = () => {};
    onmessage: (e: { data: string }) => void = () => {};
    constructor() {
      setTimeout(() => this.onopen(), 0);
    }
    close() {}
    send(text: string) {
      const request = JSON.parse(text);
      const { method, params, handle } = request;
      calls.push({ method, params });
      let result: any;
      if (method === "OpenDoc") result = { qReturn: { qHandle: 1 } };
      else if (method === "GetAppLayout")
        result = {
          qLayout: {
            qLastReloadTime:
              options.reload && revisionCalls++
                ? "changed"
                : "2026-10-22T12:00:00Z",
          },
        };
      else if (method === "CreateSessionObject") {
        const h = params.qProp.qListObjectDef.qLibraryId ? 3 : 2;
        result = { qReturn: { qHandle: h } };
      } else if (method === "GetObject") {
        objects.set(++objectCount, params.qId);
        result = { qReturn: { qHandle: objectCount } };
      } else if (method === "GetLayout") {
        if (handle === 2 || handle === 3) {
          const cells =
            handle === 2
              ? [{ qText: "Residencial Vale das Águas", qElemNumber: 1 }]
              : Array.from(
                  { length: options.duplicatePeriod ? 2 : 1 },
                  (_, i) => ({
                    qText: "Set 2026",
                    qNum: Date.UTC(2026, 8, 1) / 86400000 + 25569,
                    qElemNumber: i,
                  }),
                );
          result = {
            qLayout: {
              qListObject: {
                qSize: { qcy: cells.length },
                qDataPages: [{ qMatrix: cells.map((c) => [c]) }],
              },
            },
          };
        } else if (objects.get(handle) === "uUjfH")
          result = {
            qLayout: { qHyperCube: { qAlwaysFullyExpanded: expanded } },
          };
        else
          result = {
            qLayout: {
              qHyperCube: {
                qSize: { qcx: 3, qcy: 2 },
                qDimensionInfo: [{ qFallbackTitle: "Cliente" }, {qFallbackTitle:"Data"}],
                qColumnOrder:[0,2,1],
                qMeasureInfo: [{ qFallbackTitle: "Valor" }],
                qGrandTotalRow: [{ qText: "3,00" }],
              },
            },
          };
      } else if (method === "SelectListObjectValues")
        result = { qSuccess: true };
      else if (method === "EvaluateEx")
        result = {
          qValue:
            params.qExpression === "vCondicaoHabilitaObjetos"
              ? { qNumber: -1, qIsNumeric: true, qText: "-1" }
              : { qText: "1" },
        };
      else if (method === "GetFullPropertyTree") {
        const id = objects.get(handle);
        const child = (qId: string, containerChildId?: string) => ({
          qProperty: {
            qInfo: { qId, qType: qId === "uUjfH" ? "pivot-table" : "table" },
            containerChildId,
            qHyperCubeDef: { columnOrder: [0, 2, 1] },
          },
          qChildren: [],
        });
        const children =
          id === QLIK_SHEETS[2]
            ? [child("uUjfH")]
            : id === QLIK_SHEETS[5]
              ? [child("revenue", "pZHcxgJ")]
              : id === QLIK_SHEETS[12]
                ? [child("receivables", "pZHcxgJ")]
                : [];
        result = {
          qPropEntry: {
            qProperty: { qInfo: { qId: id, qType: "sheet" } },
            qChildren: children,
          },
        };
      } else if (method === "ApplyPatches") {
        assert.equal(params.qSoftPatch, true);
        expanded = true;
        result = {};
      } else if (method === "GetEffectiveProperties")
        result = {
          qProp: { qHyperCubeDef: { qAlwaysFullyExpanded: expanded } },
        };
      else if (method === "CreateTemporaryBookmark")
        result = { qReturn: true, qId: "temporary-bookmark" };
      else if (method === "ExportData") {
        assert.equal(objects.get(handle), "receivables");
        result = { qUrl: "/api/v1/temp-contents/receivables.xlsx" };
      } else if (method === "GetHyperCubeData")
        result = {
          qDataPages: [
            {
              qMatrix: [
                [{ qText: "Cliente & A" }, { qText: "1,00" }, {qText:"02/09/2026"}],
                [{ qText: "Cliente B" }, { qText: "2,00" }, {qText:"03/09/2026"}],
              ],
            },
          ],
        };
      else if (method === "ClearAll") result = {};
      else throw new Error(`Unexpected mutation or RPC: ${method}`);
      queueMicrotask(() =>
        this.onmessage({ data: JSON.stringify({ id: request.id, result }) }),
      );
    }
  }
  class Reader {
    result = "";
    onload = () => {};
    onerror = () => {};
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((bytes) => {
        this.result = `data:application/octet-stream;base64,${Buffer.from(bytes).toString("base64")}`;
        this.onload();
      });
    }
  }
  const fetcher = async (raw: string | URL, init?: RequestInit) => {
    const location = String(raw);
    if (location === "/api/v1/csrf-token")
      return new Response(null, {
        status: 204,
        headers: { "qlik-csrf-token": "csrf" },
      });
    if (location === "/api/v1/reports") {
      reports.push(JSON.parse(String(init?.body)));
      return Response.json({ requestId: String(reports.length) });
    }
    if (location.startsWith("/api/v1/reports/"))
      return Response.json({
        data: [
          {
            status: options.reportError ? "failed" : "done",
            location: options.foreignDownload
              ? "https://outside.example/pdf"
              : "/api/v1/temp-contents/source.pdf",
          },
        ],
      });
    assert.equal(
      new URL(String(location)).origin,
      "https://tenant.qlikcloud.com",
    );
    return new Response("original-file-bytes");
  };
  const compiled = ts.transpileModule(
    readFileSync(
      new URL("../lib/accountability/qlik-runtime.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exports: Record<string, any> = {};
  vm.runInNewContext(compiled, {
    exports,
    WebSocket: Socket,
    FileReader: Reader,
    fetch: fetcher,
    window: { location: { origin: "https://tenant.qlikcloud.com" } },
    setTimeout: (callback: () => void, ms: number) =>
      setTimeout(callback, ms === 45000 || ms === 30000 ? ms : 0),
    clearTimeout,
    Date,
    console,
    URL,
  });
  return {
    run: () =>
      exports.accountabilityRuntime({
        socketUrl: "wss://tenant.qlikcloud.com/app/id/identity/test",
        appId: "id",
        sheetIds: [...QLIK_SHEETS],
        enterprise: "Residencial Vale das Águas",
        year: 2026,
        month: 9,
      }),
    calls,
    reports,
  };
}

test("native export preserves thirteen sheets, exact source strings and the distinct receivables object", async () => {
  const h = harness();
  const result = await h.run();
  assert.ok(result.compositionPdf);
  assert.deepEqual(
    h.reports[1].compositionTemplates.map(
      (x: any) => x.senseSheetTemplate.sheet.id,
    ),
    [...QLIK_SHEETS],
  );
  assert.equal(result.revenueData.rows[0][0], "Cliente & A");
  assert.equal(result.revenueData.headers[1], "Valor");
  assert.equal(result.revenueData.rows[0][1], "1,00");
  assert.equal(result.revenueData.headers[2],"Data");
  assert.equal(result.revenueData.rows[0][2],"02/09/2026");
  assert.equal(result.revenueData.totals[1],"3,00");
  assert.equal(result.revenueData.sourceRowCount, 2);
  assert.equal(h.reports.length, 2);
  assert.equal(h.reports[0].senseDataTemplate.id, "receivables");
  assert.equal(
    h.reports[0].senseDataTemplate.temporaryBookmarkV2.id,
    "temporary-bookmark",
  );
  assert.ok(
    h.reports[1].compositionTemplates.every(
      (x: any) =>
        x.senseSheetTemplate.temporaryBookmarkV2.id === "temporary-bookmark",
    ),
  );
  assert.ok(h.reports.every((x) => x.meta.tags[0] === "sense-dialog.download"));
  const definition = h.calls.filter(
    (x) => x.method === "CreateSessionObject",
  )[1].params.qProp.qListObjectDef;
  assert.equal(definition.qLibraryId, "zqXKPwp");
  assert.ok(
    h.calls
      .filter((x) => x.method === "ApplyPatches")
      .every((x) => x.params.qSoftPatch === true),
  );
});
test("ambiguous month selection stops before exporting any financial files", async () => {
  const h = harness({ duplicatePeriod: true });
  await assert.rejects(h.run(), /exatamente um valor/);
  assert.equal(h.reports.length, 0);
  assert.equal(
    h.calls.some((x) => x.method === "ExportData"),
    false,
  );
});
test("a native report failure prevents a partial book", async () => {
  const h = harness({ reportError: true });
  await assert.rejects(h.run(), /não concluído/);
});
test("downloads never forward the authenticated session to a foreign origin", async () => {
  const h = harness({ foreignDownload: true });
  await assert.rejects(h.run(), /origem de download inválida/);
});
test("a reload during export invalidates the book rather than mixing revisions", async () => {
  const h = harness({ reload: true });
  await assert.rejects(h.run(), /atualizados durante a geração/);
});
