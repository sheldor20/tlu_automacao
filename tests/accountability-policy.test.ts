import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BETA_RECIPIENT,
  QLIK_SHEETS,
  canGenerateBook,
  isHistoricalDispatch,
  monthlyEmail,
} from "../lib/accountability/policy.ts";
test("BETA destination is fixed and mail contains no enterprise recipient", () => {
  const message = monthlyEmail("Empreendimento de teste", "setembro de 2026");
  assert.equal(message.to, "rosangela@terralotusurbanismo.com.br");
  assert.equal(message.to, BETA_RECIPIENT);
  assert.match(message.subject, /BETA/);
  assert.match(message.text, /Excel/);
  assert.deepEqual(Object.keys(message).sort(), ["subject", "text", "to"]);
});
test("September can be generated when explicitly closed, irrespective of the Qlik label", () => {
  assert.equal(
    canGenerateBook(2026, 9, true, new Date("2026-10-22T12:00:00Z")),
    true,
  );
  assert.equal(
    canGenerateBook(2026, 9, false, new Date("2026-10-22T12:00:00Z")),
    false,
  );
});
test("current/future periods and prior years cannot be sent", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  for (const [year, month] of [
    [2026, 10],
    [2026, 11],
    [2025, 9],
    [2026, 0],
    [2026, 13],
    [2026, 1.5],
  ])
    assert.equal(canGenerateBook(year, month, true, now), false);
});
test("Sao Paulo month boundary is respected", () => {
  assert.equal(
    canGenerateBook(2026, 9, true, new Date("2026-10-01T01:00:00Z")),
    false,
  );
  assert.equal(
    canGenerateBook(2026, 9, true, new Date("2026-10-01T03:00:00Z")),
    true,
  );
});
test("historical dispatches are a fixed 2026 baseline", () => {
  assert.equal(isHistoricalDispatch(2026, 9), true);
  assert.equal(isHistoricalDispatch(2026, 10), false);
  assert.equal(isHistoricalDispatch(2027, 9), false);
});
test("all thirteen source sheets are retained without duplication", () => {
  assert.equal(QLIK_SHEETS.length, 13);
  assert.equal(new Set(QLIK_SHEETS).size, 13);
});
