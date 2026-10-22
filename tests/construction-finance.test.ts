import test from "node:test";
import assert from "node:assert/strict";
import {
  constructionLinkSchema,
  constructionWorkKeys,
  inheritedLinkMatches,
  monthlyConstructionExpenses,
  monthlyExpensesCsv,
  resolveQlikCodes,
  type MonthlyCashEntry,
} from "../lib/construction-finance.ts";
const sources = {
  paid: { at: "2026-10-22T08:42:00Z", status: "success" },
  payable: { at: "2026-10-22T08:20:00Z", status: "success" },
};
const entry = (
  id: string,
  kind = "paid",
  amount: number | string = 10,
  work_key = "test|001",
  cash_date: string | null = "2026-10-22",
): MonthlyCashEntry => ({
  id,
  kind,
  amount,
  work_key,
  cash_date,
  active: true,
  source_category: "Reformas",
});
const works = [
  {
    key: "test|001",
    company_id: "test",
    work_id: "001",
    name: "Apartamento",
    active: true,
  },
  {
    key: "other|001",
    company_id: "other",
    work_id: "001",
    name: "Apartamento",
    active: true,
  },
  {
    key: "other|002",
    company_id: "other",
    work_id: "002",
    name: "Outra unidade",
    active: true,
  },
  {
    key: "test|003",
    company_id: "test",
    work_id: "003",
    name: "Inativa",
    active: false,
  },
];
test("código manual preserva zeros, exige empresa na ambiguidade e nunca escolhe por nome", () => {
  assert.deepEqual(resolveQlikCodes("", works), { keys: [], errors: [] });
  assert.equal(resolveQlikCodes("001", works).keys.length, 0);
  assert.match(resolveQlikCodes("001", works).errors[0], /mais de uma empresa/);
  assert.deepEqual(resolveQlikCodes(" test|001\nother|001 ", works), {
    keys: ["test|001", "other|001"],
    errors: [],
  });
  assert.deepEqual(resolveQlikCodes("002", works).keys, ["other|002"]);
  for (const input of ["1", "Apartamento", "test|003", "missing|100"])
    assert.equal(resolveQlikCodes(input, works).errors.length, 1);
  assert.equal(resolveQlikCodes("test|001;test|001", works).errors.length, 1);
});
test("vínculo exige confirmação, chave composta e controle de concorrência", () => {
  const input = {
    action: "link",
    id: "11111111-1111-4111-8111-111111111111",
    work_keys: ["test|001"],
    expected_updated_at: "2026-10-22T12:00:00+00:00",
    confirmed: true,
  };
  assert.equal(constructionLinkSchema.safeParse(input).success, true);
  for (const patch of [
    { confirmed: false },
    { expected_updated_at: undefined },
    { work_keys: ["001"] },
    { work_keys: ["test|001", "test|001"] },
    { amount: 100 },
  ])
    assert.equal(
      constructionLinkSchema.safeParse({ ...input, ...patch }).success,
      false,
    );
  assert.deepEqual(constructionWorkKeys({ qlik_work_key: "test|001" }), [
    "test|001",
  ]);
  assert.deepEqual(
    constructionWorkKeys({
      qlik_work_key: "test|001",
      qlik_additional_work_keys: ["test|001", "other|001"],
    }),
    ["test|001", "other|001"],
  );
  assert.equal(inheritedLinkMatches("test|001", ["other|001"]), false);
});
test("mensal soma apenas lançamentos ativos vinculados; separa pagamento, obrigação e sem data", () => {
  const rows = [
    entry("p1", "paid", "10.123456"),
    entry("p2", "paid", 20, "other|001"),
    entry("due", "payable", 50),
    entry("older", "paid", 8, "test|001", "2026-09-30"),
    entry("missing", "paid", 2, "test|001", null),
    entry("other", "paid", 999, "wrong|1"),
    entry("receipt", "received", 999),
    { ...entry("inactive", "paid", 999), active: false },
  ];
  const result = monthlyConstructionExpenses(
    [...rows, rows[0]],
    ["test|001", "other|001"],
    sources,
  );
  assert.equal(result.rows.length, 3);
  assert.ok(Math.abs(result.rows[0].paid! - 30.123456) < 1e-9);
  assert.equal(result.rows[0].payable, 50);
  assert.equal(result.rows[1].payable, null);
  assert.equal(result.rows[2].month, null);
  assert.ok(Math.abs(result.paid! - 40.123456) < 1e-9);
  assert.equal(result.payable, 50);
  assert.deepEqual(result.missingPayableKeys, ["other|001"]);
});
test("sem vínculo, sem registros e publicação pendente não viram zero; zero observado continua zero", () => {
  assert.equal(
    monthlyConstructionExpenses([entry("p")], [], sources).paid,
    null,
  );
  assert.equal(
    monthlyConstructionExpenses([], ["test|001"], sources).paid,
    null,
  );
  assert.equal(
    monthlyConstructionExpenses([entry("p")], ["test|001"], {
      ...sources,
      paid: { at: null, status: "loading" },
    }).paid,
    null,
  );
  assert.equal(
    monthlyConstructionExpenses(
      [entry("zero", "paid", 0)],
      ["test|001"],
      sources,
    ).paid,
    0,
  );
  assert.throws(
    () =>
      monthlyConstructionExpenses(
        [entry("bad", "paid", "")],
        ["test|001"],
        sources,
      ),
    /inválido/,
  );
  assert.throws(
    () =>
      monthlyConstructionExpenses(
        [entry("bad", "paid", "NaN")],
        ["test|001"],
        sources,
      ),
    /inválido/,
  );
});
test("CSV preserva fonte, período, ausência, publicação e impede fórmulas de nomes externos", () => {
  const monthly = monthlyConstructionExpenses(
    [entry("p", "paid", 12.5)],
    ["test|001"],
    sources,
  );
  const csv = monthlyExpensesCsv(
    "=HYPERLINK(1)",
    ['test|001 · Unidade "A" · Empresa'],
    monthly.rows,
    sources,
  );
  assert.ok(csv.startsWith("\uFEFF"));
  for (const text of [
    "' =HYPERLINK".replace("' ", "'"),
    "12,50",
    "Sem registros (não confirma zero)",
    "2026-10",
    sources.paid.at,
    "qlik-operations",
    'Unidade ""A""',
  ])
    assert.ok(csv.includes(text), text);
});

 test("filtra Reformas ou agrupador 9.118 sem duplicar nem incluir códigos vizinhos", () => {
  const categories = ["Reformas", "REFORMAS", "9.118", "9.118.01 - Material", "9.118 · Reformas", "9.1180", "19.118", "9.119", null, "", "Outros", "Sem reformas gerais"];
  const result = monthlyConstructionExpenses(categories.map((source_category, i) => ({ ...entry(String(i)), source_category })), ["test|001"], sources);
  assert.equal(result.paid, 60);
  assert.equal(result.rows[0].paidCount, 6);
 });
