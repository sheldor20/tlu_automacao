/** Runs inside an authenticated Qlik page. No data definitions are persisted. */
export async function accountabilityRuntime(input: {
  socketUrl: string;
  appId: string;
  sheetIds: string[];
  enterprise: string;
  year: number;
  month: number;
  probe?: boolean;
}) {
  type Obj = Record<string, any>;
  const { socketUrl, appId, sheetIds, enterprise, year, month } = input;
  const socket = new WebSocket(socketUrl);
  let sequence = 0;
  const pending = new Map<
    number,
    {
      resolve: (value: Obj) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      method: string;
    }
  >();
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error)
      request.reject(
        new Error(`Qlik ${request.method}: ${message.error.message}`),
      );
    else request.resolve(message.result || {});
  };
  const call = (handle: number, method: string, params: Obj = {}) =>
    new Promise<Obj>((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Qlik: tempo esgotado em ${method}.`));
      }, 45000);
      pending.set(id, { resolve, reject, timer, method });
      socket.send(
        JSON.stringify({ jsonrpc: "2.0", id, handle, method, params }),
      );
    });
  const handle = (result: Obj): number => result.qReturn.qHandle;
  const object = async (doc: number, id: string) =>
    handle(await call(doc, "GetObject", { qId: id }));
  const layout = async (id: number) => (await call(id, "GetLayout")).qLayout;
  const download = async (location: string) => {
    const url = new URL(location, window.location.origin);
    if (url.origin !== window.location.origin || url.protocol !== "https:")
      throw new Error("Qlik: origem de download inválida.");
    const response = await fetch(url, {
      credentials: "include",
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(`Qlik: download recusado (${response.status}).`);
    const blob = await response.blob();
    if (blob.size > 24_000_000)
      throw new Error("Qlik: arquivo excede o limite do book.");
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () =>
        reject(new Error("Qlik: falha na leitura do arquivo."));
      reader.readAsDataURL(blob);
    });
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Qlik: conexão indisponível.")),
        30000,
      );
      socket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Qlik: falha de conexão."));
      };
    });
    const doc = handle(await call(-1, "OpenDoc", { qDocName: appId }));
    const revision = (await call(doc, "GetAppLayout")).qLayout.qLastReloadTime;
    if (!revision) throw new Error("Qlik: versão dos dados indisponível.");
    await call(doc, "ClearAll", { qLockedAlso: true });
    async function select(
      field: string,
      match: (cell: Obj) => boolean,
      libraryId?: string,
    ) {
      const h = handle(
        await call(doc, "CreateSessionObject", {
          qProp: {
            qInfo: { qType: "accountability-filter" },
            qListObjectDef: {
              ...(libraryId
                ? { qLibraryId: libraryId }
                : { qDef: { qFieldDefs: [field] } }),
              qInitialDataFetch: [
                { qLeft: 0, qTop: 0, qWidth: 1, qHeight: 3000 },
              ],
            },
          },
        }),
      );
      const value = await layout(h);
      const total = value.qListObject.qSize.qcy;
      if (total > 3000)
        throw new Error(
          `Qlik: filtro ${field} excede o limite de seleção segura.`,
        );
      const cells = (value.qListObject.qDataPages || []).flatMap((page: Obj) =>
        page.qMatrix.map((row: Obj[]) => row[0]),
      );
      const selected = cells.filter(match);
      if (selected.length !== 1)
        throw new Error(
          `Qlik: selecione exatamente um valor válido de ${field}; encontrados ${selected.length}.`,
        );
      const result = await call(h, "SelectListObjectValues", {
        qPath: "/qListObjectDef",
        qValues: [selected[0].qElemNumber],
        qToggleMode: false,
      });
      if (result.qSuccess === false)
        throw new Error(`Qlik: seleção recusada em ${field}.`);
      return selected[0];
    }
    await select("Empreendimento", (c) => c.qText === enterprise);
    const start = Date.UTC(year, month - 1, 1) / 86400000 + 25569,
      end = Date.UTC(year, month, 1) / 86400000 + 25569;
    const period = await select(
      "Período Fechado",
      (c) => Number.isFinite(c.qNum) && c.qNum >= start && c.qNum < end,
      "zqXKPwp",
    );
    const proof = (
      await call(doc, "EvaluateEx", {
        qExpression: "GetSelectedCount(Empreendimento)",
      })
    ).qValue.qText;
    const condition = (
      await call(doc, "EvaluateEx", { qExpression: "vCondicaoHabilitaObjetos" })
    ).qValue;
    if (
      proof !== "1" ||
      !Number.isFinite(condition.qNumber) ||
      condition.qNumber === 0
    )
      throw new Error(
        `Qlik: os filtros nativos não habilitaram os relatórios (${proof}, ${condition.qText}).`,
      );
    const csrf = await fetch("/api/v1/csrf-token", { credentials: "include" });
    const csrfToken = csrf.headers.get("qlik-csrf-token");
    if (!csrfToken)
      throw new Error("Qlik: sessão de exportação sem token CSRF.");
    const overallDeadline = Date.now() + 420000;
    let nextSubmissionAt = Date.now();
    async function report(payload: Obj) {
      const submitAt = Math.max(Date.now(), nextSubmissionAt);
      nextSubmissionAt = submitAt + 6500;
      if (submitAt > Date.now())
        await new Promise((r) => setTimeout(r, submitAt - Date.now()));
      const submitted = await fetch("/api/v1/reports", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "qlik-csrf-token": csrfToken!,
        },
        body: JSON.stringify({
          ...payload,
          meta: { exportDeadline: "PT10M", tags: ["sense-dialog.download"] },
        }),
      });
      const info = await submitted.json();
      if (!submitted.ok)
        throw new Error(
          `Qlik: exportação recusada (${submitted.status}): ${JSON.stringify(info).slice(0, 500)}`,
        );
      const requestId = info.requestId || info.id;
      if (!requestId)
        throw new Error("Qlik: identificador de exportação ausente.");
      const deadline = Math.min(Date.now() + 180000, overallDeadline);
      while (Date.now() < deadline) {
        const statusResponse = await fetch(
          `/api/v1/reports/${encodeURIComponent(requestId)}/outputs`,
          { credentials: "include" },
        );
        if (!statusResponse.ok)
          throw new Error(
            `Qlik: falha ao consultar a exportação (${statusResponse.status}).`,
          );
        const status = await statusResponse.json();
        const outputs = status.data || [];
        if (
          outputs.some(
            (o: Obj) =>
              ["failed", "aborted", "aborting"].includes(o.status) ||
              (o.exportErrors || []).length,
          )
        )
          throw new Error(
            `Qlik: relatório não concluído: ${JSON.stringify(outputs).slice(0, 600)}`,
          );
        const done = outputs.find(
          (o: Obj) => o.status === "done" && o.location,
        );
        if (done) return download(done.location);
        await new Promise((r) => setTimeout(r, 2000));
      }
      throw new Error(
        "Qlik: a geração do relatório excedeu o prazo. Nenhum e-mail foi enviado.",
      );
    }
    const plans: Obj[] = [];
    for (const sheetId of sheetIds) {
      const h = await object(doc, sheetId);
      const tree = (await call(h, "GetFullPropertyTree")).qPropEntry;
      plans.push({ sheetId, tree });
    }
    const allNodes = (tree: Obj): Obj[] => [
      tree,
      ...(tree.qChildren || []).flatMap(allNodes),
    ];
    const consolidated = plans.find(
      (p) => p.sheetId === "62a32512-dbd3-4492-b92e-34597b95651e",
    );
    if (!consolidated) throw new Error("Qlik: pasta consolidada ausente.");
    const pivot = allNodes(consolidated.tree).find(
      (n) => n.qProperty.qInfo.qId === "uUjfH",
    );
    if (!pivot)
      throw new Error("Qlik: demonstrativo consolidado não encontrado.");
    const pivotHandle = await object(doc, "uUjfH");
    await call(pivotHandle, "ApplyPatches", {
      qPatches: [
        {
          qOp: "add",
          qPath: "/qHyperCubeDef/qAlwaysFullyExpanded",
          qValue: "true",
        },
      ],
      qSoftPatch: true,
    });
    if (
      (await call(pivotHandle, "GetEffectiveProperties")).qProp.qHyperCubeDef
        .qAlwaysFullyExpanded !== true
    )
      throw new Error(
        "Qlik: não foi possível expandir todos os níveis da DRE.",
      );
    const bookmark = await call(doc, "CreateTemporaryBookmark", {
      qOptions: { qIncludeVariables: true, qIncludeAllPatches: true },
    });
    if (!bookmark.qReturn || !bookmark.qId)
      throw new Error("Qlik: estado de exportação não pôde ser preservado.");
    const context = {
      appId,
      selectionType: "temporaryBookmarkV2",
      temporaryBookmarkV2: { id: bookmark.qId },
      reloadTimestampMatchType: "requestTimeExact",
    };
    const pdfOutput = {
      size: "A4",
      orientation: "A",
      resizeType: "autofit",
      imageRenderingDpi: 200,
      align: { horizontal: "center", vertical: "middle" },
    };
    const receiptsPlan = plans.find(
      (p) => p.sheetId === "c7cd575a-4da9-41da-b97b-f7b87385fc9f",
    );
    const revenuePlan = plans.find(
      (p) => p.sheetId === "75b2309a-3d3f-4c25-b2a1-e8f52f9c590f",
    );
    const tableNode = (plan: Obj) =>
      allNodes(plan.tree).find(
        (n) =>
          n.qProperty.containerChildId === "pZHcxgJ" &&
          n.qProperty.qInfo.qType === "table",
      );
    if (!receiptsPlan || !revenuePlan)
      throw new Error("Qlik: pastas de receita ou recebíveis ausentes.");
    const receivable = tableNode(receiptsPlan),
      revenue = tableNode(revenuePlan);
    if (
      !receivable ||
      !revenue ||
      receivable.qProperty.qInfo.qId === revenue.qProperty.qInfo.qId
    )
      throw new Error(
        "Qlik: objetos distintos de recebimentos e recebíveis não encontrados.",
      );
    const receivableHandle = await object(doc, receivable.qProperty.qInfo.qId);
    const receivableLayout = await layout(receivableHandle);
    if (receivableLayout.qHyperCube.qError?.qErrorCode)
      throw new Error("Qlik: tabela de recebíveis indisponível.");
    const receivablesXlsx = await report({
      type: "sense-data-1.0",
      senseDataTemplate: { ...context, id: receivable.qProperty.qInfo.qId },
      output: { outputId: "tlu-recebiveis", type: "xlsx" },
    });
    const revenueHandle = await object(doc, revenue.qProperty.qInfo.qId);
    const cube = (await layout(revenueHandle)).qHyperCube;
    if (cube.qError?.qErrorCode)
      throw new Error("Qlik: receita detalhada indisponível.");
    const { qcx: width, qcy: height } = cube.qSize;
    if (!width || height * width > 300000)
      throw new Error(
        "Qlik: tabela detalhada excede o tamanho permitido para envio por e-mail.",
      );
    const rows: string[][] = [];
    const batch = Math.max(1, Math.floor(10000 / width));
    for (let top = 0; top < height; top += batch) {
      const data = await call(revenueHandle, "GetHyperCubeData", {
        qPath: "/qHyperCubeDef",
        qPages: [
          {
            qLeft: 0,
            qTop: top,
            qWidth: width,
            qHeight: Math.min(batch, height - top),
          },
        ],
      });
      for (const page of data.qDataPages || [])
        for (const row of page.qMatrix || [])
          rows.push(row.map((cell: Obj) => String(cell.qText ?? "")));
    }
    if (rows.length !== height || rows.some((row) => row.length !== width))
      throw new Error("Qlik: receita detalhada incompleta; envio cancelado.");
    const headers = [...cube.qDimensionInfo, ...cube.qMeasureInfo].map(
      (item: Obj) => item.qFallbackTitle || "",
    );
    const order = (
      (cube.qColumnOrder?.length ? cube.qColumnOrder : revenue.qProperty.qHyperCubeDef.columnOrder) ||
      Array.from({ length: width }, (_, i) => i)
    ).filter((i: number) => Number.isInteger(i) && i >= 0 && i < width);
    if (new Set(order).size !== width)
      throw new Error("Qlik: ordem das colunas da receita não confirmada.");
    const totals = [
      ...Array(cube.qDimensionInfo.length).fill(""),
      ...(cube.qGrandTotalRow || []).map((cell: Obj) =>
        String(cell.qText ?? ""),
      ),
    ];
    const revenueData = {
      headers: order.map((i: number) => headers[i]),
      // QIX already applies qColumnOrder to qMatrix. Reorder metadata only.
      rows,
      totals: order.map((i: number) => totals[i] || ""),
      sourceRowCount: height,
    };
    const pdfs: { sheetId: string; base64: string }[] = [];
    const sheetTemplate = (plan: Obj) => ({
      ...context,
      sheet: {
        id: plan.sheetId,
        widthPx: 1920,
        heightPx:
          plan.sheetId === "62a32512-dbd3-4492-b92e-34597b95651e" ? 3200 : 1280,
      },
    });
    let compositionPdf: string | undefined;
    if (input.probe) {
      pdfs.push({
        sheetId: plans[0].sheetId,
        base64: await report({
          type: "sense-sheet-1.0",
          senseSheetTemplate: sheetTemplate(plans[0]),
          output: { outputId: "tlu-probe", type: "pdf", pdfOutput },
        }),
      });
    } else {
      compositionPdf = await report({
        type: "composition-1.0",
        compositionTemplates: plans.map((plan) => ({
          type: "sense-sheet-1.0",
          senseSheetTemplate: sheetTemplate(plan),
        })),
        output: {
          outputId: "tlu-book-original",
          type: "pdfcomposition",
          pdfCompositionOutput: { pdfOutputs: plans.map(() => pdfOutput) },
        },
      });
    }
    if ((await call(doc, "GetAppLayout")).qLayout.qLastReloadTime !== revision)
      throw new Error(
        "Qlik: os dados foram atualizados durante a geração. Gere o book novamente.",
      );
    return {
      enterprise,
      year,
      month,
      expandedConsolidated: true as const,
      detailedRevenueComplete: true as const,
      pdfs,
      compositionPdf,
      receivablesXlsx,
      revenueData,
      revision,
      period: period.qText,
      receivableRows: receivableLayout.qHyperCube.qSize.qcy,
    };
  } finally {
    socket.close();
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Sessão de exportação encerrada."));
    }
    pending.clear();
  }
}
