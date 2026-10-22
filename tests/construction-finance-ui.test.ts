import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React, { type ReactNode, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as finance from "../lib/construction-finance.ts";
import type { ConstructionFinanceData } from "../components/construction-finance.tsx";
const require = createRequire(import.meta.url);
const id = "11111111-1111-4111-8111-111111111111";
function load(path: string, overrides: Record<string, unknown> = {}) {
  const exports: Record<string, unknown> = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      exports,
      Date,
      URL,
      require: (name: string) => overrides[name] || require(name),
    },
  );
  return exports;
}
const ui = load("../components/ui.tsx");
const base: ConstructionFinanceData = {
  work: {
    id,
    name: "Obra teste",
    source_business_id: null,
    qlik_work_key: null,
    updated_at: "2026-10-22T08:00:00Z",
  },
  workKeys: [],
  linkedWorks: [],
  monthly: {
    rows: [],
    paid: null,
    payable: null,
    missingPaidKeys: [],
    missingPayableKeys: [],
  },
  sources: {
    paid: { at: "2026-10-22T08:42:00Z", status: "success" },
    payable: { at: "2026-10-22T08:20:00Z", status: "success" },
  },
  checkedAt: "2026-10-22T12:00:00Z",
  syncActive: true,
  commitments: [],
  estimate: null,
  stageBudgets: [],
  stages: [],
  canWrite: true,
};
const common = {
  money: (n: number | null) =>
    n === null
      ? "A informar"
      : Number(n).toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        }),
  day: (s: string) => s,
  OperationsError: ({ message }: { message: string }) =>
    message ? React.createElement("div", { role: "alert" }, message) : null,
};
function render(
  data: ConstructionFinanceData,
  state: { loading?: boolean; error?: string } = {},
) {
  const loaded = load("../components/construction-finance.tsx", {
    "./ui": ui,
    "./qlik-work-select": { QlikWorkCodes: () => null },
    "@/lib/construction-finance": finance,
    "@/lib/payment-client": {},
    "./operations-common": {
      ...common,
      useOperations: () => ({
        data,
        loading: false,
        error: "",
        ...state,
        reload: () => Promise.resolve(),
      }),
    },
  });
  return renderToStaticMarkup(
    React.createElement(
      loaded.ConstructionFinance as React.ComponentType<{
        id: string;
        progress: number;
      }>,
      { id, progress: 10 },
    ),
  );
}
test("UI sem vínculo não mostra zeros nem botões para valores manuais", () => {
  const html = render(base);
  assert.match(html, /Vínculo pendente/);
  assert.match(html, /Vincular empresa e obra/);
  assert.doesNotMatch(
    html,
    /R\$.*0,00|Novo compromisso|Atualizar estimativa|Salvar competência|type="number"/,
  );
});
test("UI mostra meses, fonte, atualização, ausências e legado sem misturar pagamentos e contas", () => {
  const data = {
    ...base,
    workKeys: ["test|001"],
    linkedWorks: [
      {
        key: "test|001",
        name: "Unidade",
        company_id: "test",
        active: true,
        qlik_companies: { name: "Empresa" },
      },
    ],
    monthly: {
      rows: [
        {
          month: "2026-10",
          paid: 25,
          payable: null,
          paidCount: 1,
          payableCount: 0,
        },
      ],
      paid: 25,
      payable: null,
      missingPaidKeys: [],
      missingPayableKeys: ["test|001"],
    },
    commitments: [
      {
        id: "c",
        description: "Legado",
        supplier: "Fornecedor",
        due_date: "2026-10-01",
        amount: 999,
        status: "paid",
      },
    ],
  };
  const html = render(data);
  for (const label of [
    "25,00",
    "999,00",
    "Histórico manual legado",
    "não confirma saldo zero",
    "Exportar planilha mensal",
    "qlik-operations",
    "08:42:00",
    "08:20:00",
    "10/2026",
    "Pagamentos realizados",
    "Contas a pagar",
    "Unidade",
    "Empresa",
  ])
    assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /1\.024,00|type="number"/);
  assert.doesNotMatch(
    render({ ...data, canWrite: false }),
    /Vincular empresa e obra<\/button>/,
  );
});
test("UI falha/carregamento não apresenta valores antigos nem exporta", () => {
  const data = {
    ...base,
    workKeys: ["test|001"],
    monthly: { ...base.monthly, paid: 123456 },
  };
  for (const state of [{ loading: true }, { error: "Falha de leitura" }]) {
    const html = render(data, state);
    assert.doesNotMatch(html, /123\.456|Exportar planilha mensal/);
  }
  assert.match(render(base, { error: "Falha de leitura" }), /role="alert"/);
});
test("campo de código executa validação e devolve chave exata somente sem ambiguidade", () => {
  let result: { text: string; keys: string[]; valid: boolean } | undefined;
  const works = [
    {
      key: "a|001",
      company_id: "a",
      work_id: "001",
      name: "Unidade",
      active: true,
    },
    {
      key: "b|001",
      company_id: "b",
      work_id: "001",
      name: "Unidade",
      active: true,
    },
  ];
  const loaded = load("../components/qlik-work-select.tsx", {
    "./ui": ui,
    "@/lib/payment-client": {},
    "@/lib/construction-finance": finance,
    "./operations-common": {
      ...common,
      useOperations: () => ({
        data: {
          works,
          companies: [
            { id: "a", name: "Empresa A" },
            { id: "b", name: "Empresa B" },
          ],
        },
        loading: false,
        error: "",
      }),
    },
  });
  const Component = loaded.QlikWorkCodes as (p: {
    id: string;
    value: string;
    onChange: (text: string, keys: string[], valid: boolean) => void;
  }) => ReactElement;
  const element = Component({
    id,
    value: "",
    onChange: (text, keys, valid) => {
      result = { text, keys, valid };
    },
  });
  function find(node: ReactNode): ReactElement | undefined {
    if (!React.isValidElement(node)) return;
    if (node.type === "textarea") return node;
    return React.Children.toArray(
      (node.props as { children?: ReactNode }).children,
    )
      .map(find)
      .find(Boolean);
  }
  const textarea = find(element)!;
  assert.ok(textarea);
  const change = (
    textarea.props as { onChange: (e: { target: { value: string } }) => void }
  ).onChange;
  change({ target: { value: "001" } });
  assert.equal(result?.valid, false);
  assert.deepEqual(result?.keys, []);
  change({ target: { value: "a|001" } });
  assert.equal(result?.valid, true);
  assert.deepEqual(result?.keys, ["a|001"]);
  const html = renderToStaticMarkup(
    React.createElement(Component, { id, value: "a|001", onChange: () => {} }),
  );
  assert.match(html, /a\|001/);
  assert.match(html, /Empresa A/);
  assert.match(html, /Unidade/);
});
