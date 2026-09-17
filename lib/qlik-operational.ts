import { withQlikOperationalPage } from "./qlik-cloud";

export type QlikCubeSpec = {
  key: string;
  fields?: string[];
  objectId?: string;
  measureId?: string;
  limit?: number;
  offset?: number;
  rowBudget?: number;
};
export type QlikCell = { text: string; number: number | null };
export type QlikCube = {
  key: string;
  headers: string[];
  rows: QlikCell[][];
  totalRows: number;
  properties?: unknown;
  total?: number | null;
  revision?: string;
};
export const OPERATIONAL_QLIK_URL =
  "https://terralotusurbanismo.us.qlikcloud.com/sense/app/e3d13862-ec1f-4332-8a5b-df4c7b93fa7c/sheet/32a488c2-14d8-4bde-ba4f-35211d75376b/state/analysis";
export const CLIENT_STATUS_QLIK_URL =
  "https://terralotusurbanismo.us.qlikcloud.com/sense/app/465cc478-f1b4-4969-b057-d80a623b6de8/sheet/cdc4d2c1-2344-49c8-a279-2b390061fa06/state/analysis";

export async function readOperationalQlik(
  specs: QlikCubeSpec[] = [],
  inspect = false,
  onPage?: (cube: QlikCube) => Promise<void>,
  source: "finance" | "sales" = "finance",
) {
  return withQlikOperationalPage(
    source === "sales" ? CLIENT_STATUS_QLIK_URL : OPERATIONAL_QLIK_URL,
    async (page, socketUrl, appId) => {
      if (onPage) await page.exposeFunction("operationalRows", onPage);
      return page.evaluate(
        async ({ socketUrl, appId, specs, inspect, stream, source }) => {
          type Result = Record<string, unknown>;
          const socket = new WebSocket(socketUrl);
          const pending = new Map<
            number,
            {
              resolve: (r: Result) => void;
              reject: (e: Error) => void;
              timer: ReturnType<typeof setTimeout>;
            }
          >();
          let id = 0;
          socket.onmessage = (event) => {
            const response = JSON.parse(String(event.data));
            const p = pending.get(response.id);
            if (!p) return;
            clearTimeout(p.timer);
            pending.delete(response.id);
            if (response.error)
              p.reject(new Error(`Qlik: ${response.error.message}`));
            else p.resolve(response.result || {});
          };
          socket.onclose = () => {
            for (const p of pending.values()) {
              clearTimeout(p.timer);
              p.reject(new Error("Conexão Qlik encerrada."));
            }
            pending.clear();
          };
          const call = (handle: number, method: string, params: Result = {}) =>
            new Promise<Result>((resolve, reject) => {
              const next = ++id;
              const timer = setTimeout(() => {
                pending.delete(next);
                reject(new Error(`Tempo esgotado: ${method}`));
              }, 45000);
              pending.set(next, { resolve, reject, timer });
              socket.send(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: next,
                  handle,
                  method,
                  params,
                }),
              );
            });
          const handle = (r: Result) =>
            (r.qReturn as { qHandle: number }).qHandle;
          const layout = async (h: number) =>
            (await call(h, "GetLayout")).qLayout as Record<string, unknown>;
          try {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(
                () => reject(new Error("Qlik indisponível.")),
                30000,
              );
              socket.onopen = () => {
                clearTimeout(timer);
                resolve();
              };
              socket.onerror = () => {
                clearTimeout(timer);
                reject(new Error("Falha na conexão Qlik."));
              };
            });
            const doc = handle(await call(-1, "OpenDoc", { qDocName: appId }));
            const appLayout = (await call(doc, "GetAppLayout")).qLayout as {
              qLastReloadTime?: string;
            };
            const revision = appLayout.qLastReloadTime;
            if (!revision || !Number.isFinite(Date.parse(revision)))
              throw new Error(
                "Não foi possível identificar a versão da origem Qlik.",
              );
            await call(doc, "ClearAll", { qLockedAlso: true });
            for (const [name, value] of source === "finance"
              ? ([
                  ["vQtdDias", 99999999],
                  ["vDesembolsoFinanceiro", "Normal"],
                ] as const)
              : []) {
              const variable = handle(
                await call(doc, "GetVariableByName", { qName: name }),
              );
              await call(
                variable,
                typeof value === "number" ? "SetNumValue" : "SetStringValue",
                { qVal: value },
              );
            }
            let fields: unknown[] = [];
            if (inspect) {
              const obj = handle(
                await call(doc, "CreateSessionObject", {
                  qProp: {
                    qInfo: { qType: "FieldList" },
                    qFieldListDef: {
                      qShowSystem: false,
                      qShowHidden: true,
                      qShowSrcTables: true,
                    },
                  },
                }),
              );
              fields = ((await layout(obj)).qFieldList as { qItems: unknown[] })
                .qItems;
            }
            const cubes: Array<{
              key: string;
              headers: string[];
              rows: Array<Array<{ text: string; number: number | null }>>;
              totalRows: number;
              properties?: unknown;
              total?: number | null;
              revision?: string;
            }> = [];
            for (const spec of specs) {
              const h = spec.objectId
                ? handle(await call(doc, "GetObject", { qId: spec.objectId }))
                : handle(
                    await call(doc, "CreateSessionObject", {
                      qProp: {
                        qInfo: { qType: "table" },
                        qHyperCubeDef: {
                          qDimensions: (spec.fields || []).map((field) => ({
                            qDef: { qFieldDefs: [field] },
                            qNullSuppression: false,
                          })),
                          qMeasures: spec.measureId
                            ? [{ qLibraryId: spec.measureId }]
                            : [],
                          qSuppressZero: !!spec.measureId,
                          qSuppressMissing: !!spec.measureId,
                          qInitialDataFetch: [],
                        },
                      },
                    }),
                  );
              const l = await layout(h);
              const cube = l.qHyperCube as {
                qSize: { qcx: number; qcy: number };
                qDimensionInfo: Array<{
                  qFallbackTitle: string;
                  qError?: unknown;
                }>;
                qMeasureInfo: Array<{ qFallbackTitle: string }>;
                qGrandTotalRow?: Array<{ qNum: number }>;
                qError?: unknown;
              };
              if (
                !cube ||
                cube.qError ||
                cube.qDimensionInfo.some((d) => d.qError)
              )
                throw new Error(`Tabela Qlik inválida: ${spec.key}`);
              const height = Math.max(
                1,
                Math.min(1000, Math.floor(10000 / cube.qSize.qcx)),
              );
              const total = spec.limit
                ? Math.min(spec.limit, cube.qSize.qcy)
                : cube.qSize.qcy;
              const offset = spec.offset || 0;
              const end = Math.min(total, offset + (spec.rowBudget || total));
              if (total > 1000000)
                throw new Error(
                  "A extração excedeu o limite de 1 milhão de linhas.",
                );
              const rows: Array<
                Array<{ text: string; number: number | null }>
              > = [];
              const headers = [
                ...cube.qDimensionInfo,
                ...cube.qMeasureInfo,
              ].map((c) => c.qFallbackTitle);
              for (let batch = offset; batch < end; batch += height * 4) {
                const pages = await Promise.all(
                  Array.from({ length: 4 }, (_, i) => batch + i * height)
                    .filter((top) => top < end)
                    .map(async (top) => {
                      const data = await call(h, "GetHyperCubeData", {
                        qPath: "/qHyperCubeDef",
                        qPages: [
                          {
                            qTop: top,
                            qLeft: 0,
                            qWidth: cube.qSize.qcx,
                            qHeight: Math.min(height, end - top),
                          },
                        ],
                      });
                      const matrix = (
                        data.qDataPages as Array<{
                          qMatrix: Array<
                            Array<{ qText?: string; qNum?: number }>
                          >;
                        }>
                      )[0].qMatrix;
                      if (matrix.length !== Math.min(height, end - top))
                        throw new Error("Extração Qlik incompleta.");
                      const pageRows = matrix.map((row) =>
                        row.map((c) => ({
                          text: c.qText || "",
                          number:
                            typeof c.qNum === "number" &&
                            Number.isFinite(c.qNum)
                              ? c.qNum
                              : null,
                        })),
                      );
                      return pageRows;
                    }),
                );
                const pageRows = pages.flat();
                if (stream)
                  await (
                    window as unknown as {
                      operationalRows: (c: unknown) => Promise<void>;
                    }
                  ).operationalRows({
                    key: spec.key,
                    headers,
                    rows: pageRows,
                    totalRows: cube.qSize.qcy,
                    total: cube.qGrandTotalRow?.[0]?.qNum ?? null,
                    revision,
                  });
                else rows.push(...pageRows);
              }
              cubes.push({
                key: spec.key,
                headers: [...cube.qDimensionInfo, ...cube.qMeasureInfo].map(
                  (c) => c.qFallbackTitle,
                ),
                rows,
                totalRows: cube.qSize.qcy,
                total: cube.qGrandTotalRow?.[0]?.qNum ?? null,
                revision,
                ...(inspect && spec.measureId
                  ? {
                      measureProperties: await call(
                        handle(
                          await call(doc, "GetMeasure", {
                            qId: spec.measureId,
                          }),
                        ),
                        "GetProperties",
                      ),
                    }
                  : {}),
                ...(inspect && spec.objectId
                  ? { properties: await call(h, "GetProperties") }
                  : {}),
              });
            }
            const finalLayout = (await call(doc, "GetAppLayout")).qLayout as {
              qLastReloadTime?: string;
            };
            if (finalLayout.qLastReloadTime !== revision)
              throw new Error("qlik_source_changed");
            return { fields, cubes };
          } finally {
            socket.close();
          }
        },
        { socketUrl, appId, specs, inspect, stream: !!onPage, source },
      );
    },
  );
}
