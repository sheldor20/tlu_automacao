import assert from "node:assert/strict";
import test from "node:test";
import { parseReceiptForm, receiptForm, receiptTotals, receiptYearMonths } from "../lib/rental-receipts.ts";

test("recebimentos manuais: centavos, opcionais e resultado negativo", () => {
  const input = { ...receiptForm(), rent_received: "2500,50", administration_fee: "150.20", reserve_fund: "100", fines: "20", reimbursements: "50", property_tax: "200" };
  const values = parseReceiptForm(input);
  assert.deepEqual(receiptTotals(values), { credits: 2570.50, deductions: 450.20, net: 2120.30 });
  assert.equal(receiptTotals(parseReceiptForm({ ...receiptForm(), rent_received: "0", administration_fee: "12.34" })).net, -12.34);
  assert.equal(parseReceiptForm({ ...receiptForm(), rent_received: "0" }).fines, 0);
  for (const invalid of ["", "-1", "NaN", "Infinity", "1.234", "10000000000000"]) {
    assert.throws(() => parseReceiptForm({ ...receiptForm(), rent_received: invalid }));
  }
});

test("gráfico mantém ordem mensal, zero real e ausência de lançamento distintos", () => {
  const rows = [{ ...parseReceiptForm({ ...receiptForm(), rent_received: "0" }), reference_month: "2026-02-01", net_received: 0, receipt_count: 1 }];
  const months = receiptYearMonths(2026, rows);
  assert.equal(months.length, 12);
  assert.equal(months[0].totals, null);
  assert.equal(months[1].totals!.net, 0);
  assert.equal(months[2].totals, null);
  assert.equal(months[11].referenceMonth, "2026-12-01");
  assert.ok(receiptYearMonths(2027, rows).every((month) => month.totals === null));
});
