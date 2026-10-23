import assert from "node:assert/strict";
import test from "node:test";
import { paidInstallments, assertFruitionMonths, salePrefill, type InstallmentEntry } from "../lib/distratos-prefill.ts";
const row = (id: string, title: string, amount: number): InstallmentEntry => ({ id, title_key: title, amount, cash_date: "2026-01-10" });
const receivedAt = "2026-10-23T09:00:00Z", receivableAt = "2026-10-23T10:00:00Z";
const count = (received: InstallmentEntry[], receivable: InstallmentEntry[] = []) => paidInstallments(received, receivable, receivedAt, receivableAt, "2026-10-23");
test("fruição conta parcelas distintas, sem multiplicar rateios, baixas parciais ou linhas duplicadas", () => {
  const first = row("r1", "0007", 50);
  assert.equal(count([first, first, row("r2", "0007", 50), row("r3", "7", 100)]).count, 2);
  assert.equal(count([row("r1", "p1", 50)], [row("a1", "p1", 50)]).count, 0);
  assert.equal(count([row("r1", "p1", 50), row("r2", "p1", 50)], [row("a1", "p1", 0)]).count, 1);
});
test("não conta previsão sem recebimento nem parcela integralmente estornada", () => {
  assert.equal(count([], [row("a1", "prevista", 100)]).count, 0);
  assert.equal(count([row("r1", "p1", 100), row("r2", "p1", -100)]).count, 0);
  assert.equal(count([row("r1", "p1", 100), row("r2", "p1", -50)], [row("a1", "p1", 50)]).count, 0);
});
test("dados ausentes, conflitantes ou defasados não viram zero confirmado", () => {
  assert.equal(paidInstallments([], [], receivedAt, null, "2026-10-23").count, null);
  assert.equal(paidInstallments([], [], receivableAt, receivedAt, "2026-10-23").count, null);
  assert.equal(paidInstallments([], [], receivedAt, receivableAt, "2026-10-23", false).count, null);
  assert.equal(count([{ ...row("r1", "p1", 100), title_key: null }]).count, null);
  assert.equal(count([row("r1", "p1", 100), row("r1", "p1", 200)]).count, null);
  assert.equal(count([{ ...row("r1", "p1", 100), cash_date: "2027-01-01" }]).count, null);
  assert.equal(count([], [row("a1", "p1", -100)]).count, null);
});
test("servidor exige a quantidade da fonte quando confirmada e não aplica percentuais novos", () => {
  const paid = count([row("r1", "p1", 100)]);
  assert.doesNotThrow(() => assertFruitionMonths(1, paid));
  assert.throws(() => assertFruitionMonths(2, paid), /total de parcelas pagas/);
  assert.doesNotThrow(() => assertFruitionMonths(3, { ...paid, count: null }));
});
test("data e valor da venda vêm apenas de valores originais válidos da consulta", () => {
  assert.deepEqual(salePrefill({ saleDate: "2022-01-21", saleValue: 74000 }, "2026-10-23"), { saleDate: "2022-01-21", saleValue: 74000 });
  assert.deepEqual(salePrefill({}, "2026-10-23"), { saleDate: "", saleValue: 0 });
  assert.deepEqual(salePrefill({ saleDate: "2026-02-30", saleValue: -10 }, "2026-10-23"), { saleDate: "", saleValue: 0 });
  assert.deepEqual(salePrefill({ saleDate: "2027-01-01", saleValue: "74000" }, "2026-10-23"), { saleDate: "", saleValue: 0 });
});
