import test from "node:test";
import assert from "node:assert/strict";
import {
  addMonths,
  annualColumns,
  calculateBudget,
  newBudgetPlan,
  parseBusinessCurve,
  placeBusiness,
  type BudgetBusiness,
  type BudgetSources,
  type BudgetWork,
} from "../lib/budget-planner.ts";
import { budgetSchema } from "../lib/budget-schema.ts";
const id = "11111111-1111-4111-8111-111111111111";
const curve = [
  { month: 1, vgv: 200, investment: 30 },
  { month: 2, vgv: 300, investment: 70 },
];
const work: BudgetWork = {
  business_id: id,
  business_name: "Obra",
  linked: false,
  start: "2026-09",
  end: "2026-10",
  enabled: true,
  incremental: false,
  curve,
};
const business: BudgetBusiness = {
  id,
  name: "Obra",
  potential_vgv: 500,
  curve,
  version: 1,
  qlik_work_key: null,
};
const sources: BudgetSources = {
  rows: [
    {
      month: "2026-01",
      company_id: "A",
      work_key: null,
      kind: "received",
      amount: 1000,
      count: 1,
      category: "Principal",
    },
    {
      month: "2026-01",
      company_id: "A",
      work_key: null,
      kind: "paid",
      amount: 300,
      count: 1,
      category: "Obra",
    },
    {
      month: "2026-01",
      company_id: "A",
      work_key: null,
      kind: "paid",
      amount: 100,
      count: 1,
      category: "Operação",
    },
  ],
  coverage: [
    {
      kind: "received",
      company_id: "A",
      count: 1,
      updated_at: null,
      undated: 0,
    },
    { kind: "paid", company_id: "A", count: 1, updated_at: null, undated: 0 },
  ],
  companies: [],
  overdue_receivables: 0,
};
test("60 meses, virada de ano e orçamento base zero", () => {
  const p = newBudgetPlan(2026, "2026-09");
  const rows = calculateBudget(p, [], sources, "budget");
  assert.equal(rows.length, 60);
  assert.equal(rows[59].month, "2030-12");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(
    rows.reduce((n, r) => n + r.expense, 0),
    0,
  );
  assert.equal(rows[0].closing, null);
});
test("movimento da obra desloca a receita, prazo comprime o investimento sem alterar o total", () => {
  const a = placeBusiness(work, curve);
  assert.deepEqual(a.receipts, [
    { month: "2026-11", amount: 200 },
    { month: "2026-12", amount: 300 },
  ]);
  const b = placeBusiness({ ...work, start: "2026-10", end: "2026-12" }, curve);
  assert.equal(b.receipts[0].month, "2027-01");
  assert.equal(
    b.investment.reduce((n, r) => n + r.amount, 0),
    100,
  );
  const c = placeBusiness({ ...work, end: "2026-09" }, curve);
  assert.equal(c.investment[0].amount, 100);
});
test("distribuição preserva centavos para qualquer prazo", () => {
  for (let months = 1; months <= 120; months++) {
    const r = placeBusiness(
      { ...work, end: addMonths(work.start, months - 1) },
      [
        { month: 1, vgv: 0, investment: 0.01 },
        { month: 2, vgv: 0, investment: 99.98 },
      ],
    );
    assert.equal(
      Math.round(r.investment.reduce((n, r) => n + r.amount, 0) * 100),
      9999,
    );
  }
});
test("resultado gerencial se concilia com caixa e investimento não duplica a despesa", () => {
  const p = newBudgetPlan(2026, "2026-09");
  p.opening_cash = 50;
  p.mappings = { "expense:A:*:Obra": "works" };
  p.adjustments = [
    {
      id: "a",
      account_id: "administrative",
      month: "2026-01",
      amount: 25,
      justification: "Competência",
    },
  ];
  const row = calculateBudget(p, [], sources, "actual")[0];
  assert.equal(row.income, 1000);
  assert.equal(row.expense, 125);
  assert.equal(row.result, 875);
  assert.equal(row.bridge, 25);
  assert.equal(row.investment, 300);
  assert.equal(row.cashResult, 600);
  assert.equal(row.closing, 650);
  assert.equal(row.result + row.bridge - row.investment, row.cashResult);
});
test("competência orçada e pagamento podem estar em meses diferentes", () => {
  const p = newBudgetPlan(2026, "2026-09");
  p.opening_cash = 1000;
  p.lines = [
    {
      id: "a",
      account_id: "administrative",
      month: "2026-01",
      cash_month: "2026-02",
      amount: 100,
      justification: "Equipe",
    },
  ];
  const rows = calculateBudget(p, [], sources, "budget");
  assert.equal(rows[0].result, -100);
  assert.equal(rows[0].bridge, 100);
  assert.equal(rows[0].cashResult, 0);
  assert.equal(rows[1].cashResult, -100);
  const annual = annualColumns(rows);
  assert.equal(annual[0].closing, 900);
  assert.equal(annual[1].opening, 900);
  assert.equal(annual[0].bridge, 0);
});
test("fonte incompleta nunca produz resultado ou saldo final válido", () => {
  const p = newBudgetPlan(2026, "2026-09");
  p.opening_cash = 100;
  const rows = calculateBudget(
    p,
    [],
    {
      ...sources,
      coverage: sources.coverage.filter((c) => c.kind !== "received"),
    },
    "forecast",
  );
  assert.equal(rows[0].complete, false);
  assert.equal(rows[0].closing, null);
  assert.equal(rows[8].closing, null);
});
test("histórico realizado não muda quando a obra é movida", () => {
  const p = newBudgetPlan(2026, "2026-09");
  p.works = [{ ...work, start: "2026-01", end: "2026-02" }];
  const before = calculateBudget(p, [business], sources, "forecast");
  p.works = [work];
  const after = calculateBudget(p, [business], sources, "forecast");
  assert.deepEqual(before.slice(0, 8), after.slice(0, 8));
  assert.equal(after[10].income, 200);
});
test("carteira capturada e curva do cenário não seguem mudanças posteriores da origem", () => {
  const p = newBudgetPlan(2026, "2026-09");
  p.baseline_receipts = [
    {
      month: "2026-11",
      company_id: "A",
      work_key: null,
      kind: "receivable",
      category: "Principal",
      amount: 10,
      count: 1,
    },
  ];
  p.works = [work];
  const rows = calculateBudget(
    p,
    [{ ...business, curve: [{ month: 1, vgv: 999, investment: 888 }] }],
    {
      ...sources,
      rows: [
        ...sources.rows,
        {
          month: "2026-11",
          company_id: "A",
          work_key: null,
          kind: "receivable",
          category: "Principal",
          amount: 99999,
          count: 1,
        },
      ],
    },
    "budget",
  );
  assert.equal(rows[10].income, 210);
});
test("negócio ligado ao Qlik só entra como previsão incremental confirmada", () => {
  const p = newBudgetPlan(2026, "2026-09");
  p.works = [work];
  const b = { ...business, qlik_work_key: "w" };
  assert.equal(calculateBudget(p, [b], sources, "budget")[10].income, 0);
  p.works[0].incremental = true;
  assert.equal(calculateBudget(p, [b], sources, "budget")[10].income, 200);
});
test("CSV e colagem de planilha aceitam centavos e rejeitam linhas parciais ou repetidas", () => {
  assert.deepEqual(
    parseBusinessCurve("mes;vgv;investimento\n1;1.234,56;100,00"),
    [{ month: 1, vgv: 1234.56, investment: 100 }],
  );
  assert.equal(parseBusinessCurve("1\t123.45\t0")[0].vgv, 123.45);
  for (const csv of [
    "1;2;3\n1;3;4",
    "0;2;3",
    "1;-2;3",
    "1;NaN;3",
    "1;2",
    "mes;vgv;investimento",
    "1;;0",
  ])
    assert.throws(() => parseBusinessCurve(csv));
});
test("servidor exige justificativa, referência válida, meses válidos e unicidade", () => {
  const p = newBudgetPlan(2026, "2026-09");
  assert.equal(budgetSchema.safeParse(p).success, true);
  assert.equal(
    budgetSchema.safeParse({ ...p, works: [work, work] }).success,
    false,
  );
  assert.equal(
    budgetSchema.safeParse({ ...p, works: [{ ...work, end: "2026-08" }] })
      .success,
    false,
  );
  assert.equal(
    budgetSchema.safeParse({ ...p, mappings: { "expense:X": "current_vgv" } })
      .success,
    false,
  );
  assert.equal(
    budgetSchema.safeParse({
      ...p,
      lines: [
        {
          id: "a",
          account_id: "administrative",
          month: "2026-01",
          cash_month: "2031-01",
          amount: 100,
          justification: "",
        },
      ],
    }).success,
    false,
  );
});

test("visão por empresa e transferências não inflam receita ou despesa", () => {
  const p = newBudgetPlan(2026, "2026-09");
  p.company_id = "A";
  p.mappings = {
    "income:A:*:Transferência": "transfer_in",
    "expense:A:*:Obra": "works",
  };
  const src = {
    ...sources,
    rows: [
      ...sources.rows,
      {
        month: "2026-01",
        company_id: "A",
        work_key: null,
        kind: "received" as const,
        amount: 50,
        count: 1,
        category: "Transferência",
      },
      {
        month: "2026-01",
        company_id: "B",
        work_key: null,
        kind: "received" as const,
        amount: 9999,
        count: 1,
        category: "Principal",
      },
    ],
  };
  const row = calculateBudget(p, [], src, "actual")[0];
  assert.equal(row.income, 1000);
  assert.equal(row.expense, 100);
  assert.equal(row.transfers, 50);
  assert.equal(row.cashResult, 650);
});
test("reajuste composto não modifica carteira contratada ou realizado", () => {
  const p = newBudgetPlan(2026, "2026-09");
  p.annual_rates.expense = 10;
  p.lines = [
    {
      id: "l",
      month: "2028-01",
      cash_month: "2028-01",
      account_id: "administrative",
      amount: 100,
      justification: "Equipe",
    },
  ];
  p.annual_rates.income = 10;
  p.baseline_receipts = [
    {
      month: "2028-01",
      company_id: "A",
      work_key: null,
      kind: "receivable",
      category: "Principal",
      amount: 100,
      count: 1,
    },
  ];
  const r = calculateBudget(p, [], sources, "budget").find(
    (r) => r.month === "2028-01",
  )!;
  assert.equal(r.expense, 121);
  assert.equal(r.income, 100);
});
test("ano realizado agrega somente meses fechados e futuro aparece sem dados", () => {
  const p = newBudgetPlan(2026, "2026-09");
  const rows = calculateBudget(p, [], sources, "actual");
  const yearly = annualColumns(rows);
  assert.equal(rows[8].active, false);
  assert.equal(yearly[0].complete, true);
  assert.equal(yearly[1].active, false);
});
