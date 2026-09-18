import assert from "node:assert/strict";
import test from "node:test";
import {
  collectionFilterKey,
  normalizeCollectionQuery,
  summarizeCollectionGroups,
  type CollectionGroupTotal,
} from "../lib/collection-totals.ts";

const totals: CollectionGroupTotal[] = [
  { collection_group: "easy", contracts: 40, amount: "12345.67", promises: 0, installments: 55 },
  { collection_group: "negotiation", contracts: 3, amount: "200.10", promises: 1, installments: 9 },
  { collection_group: "difficult", contracts: 2, amount: "300.20", promises: 2, installments: 20 },
  { collection_group: "judicial", contracts: 1, amount: "400.03", promises: 0, installments: 12 },
  { collection_group: "review", contracts: 1, amount: "50.01", promises: 0, installments: 1 },
  { collection_group: "current", contracts: 100, amount: 0, promises: 0, installments: 0 },
];

test("Parcelas esquecidas totals include all 40 contracts, not the 25-row page", () => {
  assert.deepEqual(summarizeCollectionGroups(totals, "easy"), {
    contracts: 40, amount: 12345.67, promises: 0, installments: 55,
  });
});

test("each category has its own total", () => {
  for (const row of totals) {
    const summary = summarizeCollectionGroups(totals, row.collection_group);
    assert.equal(summary.amount, Number(row.amount));
    assert.equal(summary.contracts, Number(row.contracts));
    assert.equal(summary.installments, Number(row.installments));
  }
});

test("Todos os atrasos includes review/judicial and excludes current", () => {
  assert.deepEqual(summarizeCollectionGroups(totals, "all"), {
    contracts: 47, amount: 13296.01, promises: 3, installments: 97,
  });
});

test("empty and missing groups have genuine zero totals", () => {
  const zero = { contracts: 0, amount: 0, promises: 0, installments: 0 };
  assert.deepEqual(summarizeCollectionGroups([], "easy"), zero);
  assert.deepEqual(summarizeCollectionGroups(undefined, "all"), zero);
  assert.deepEqual(summarizeCollectionGroups(totals, "missing"), zero);
});

test("decimal values are added in cents", () => {
  assert.equal(summarizeCollectionGroups([
    { collection_group: "easy", contracts: "1", amount: "0.10", promises: "0", installments: "1" },
    { collection_group: "difficult", contracts: "1", amount: "0.20", promises: "0", installments: "1" },
  ], "all").amount, 0.3);
});

test("filtered aggregates do not retain another company's values", () => {
  const filtered = [{ ...totals[0], contracts: 1, amount: "18.99", installments: 2 }];
  assert.deepEqual(summarizeCollectionGroups(filtered, "easy"), {
    contracts: 1, amount: 18.99, promises: 0, installments: 2,
  });
});

test("query normalization preserves accented names and strips filter operators", () => {
  assert.equal(normalizeCollectionQuery("  João da Silva,_%*()  "), "João da Silva");
  assert.equal(normalizeCollectionQuery("AB-12.3"), "AB-12.3");
});

test("response scope changes with search/company but not page/category", () => {
  assert.notEqual(collectionFilterKey("", "1"), collectionFilterKey("", "2"));
  assert.notEqual(collectionFilterKey("Ana", "1"), collectionFilterKey("João", "1"));
  assert.equal(collectionFilterKey(" Ana* ", "1"), collectionFilterKey("Ana", "1"));
});
