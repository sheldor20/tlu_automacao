import test from "node:test";
import assert from "node:assert/strict";
import { runPaymentUploads, appendPaymentFiles } from "../lib/payment-upload-queue.ts";

test("large batches bound concurrency, keep failures in selection order and report completion", async () => {
  const files = Array.from({ length: 120 }, (_, i) => i);
  let active = 0, peak = 0;
  const progress: number[] = [];
  const result = await runPaymentUploads(files, async (file) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, file % 3));
    active--;
    if (file % 17 === 0) throw new Error(`failed ${file}`);
  }, ({ completed, total }) => { assert.equal(total, 120); progress.push(completed); });
  assert.equal(peak, 3);
  assert.deepEqual(result.pending, files.filter((file) => file % 17 === 0));
  assert.deepEqual(progress, Array.from({ length: 121 }, (_, i) => i));
  const retried: number[] = [];
  await runPaymentUploads(result.pending, async (file) => { retried.push(file); }, () => {});
  assert.deepEqual(retried, result.pending);
});

test("empty batch and repeated selections", async () => {
  const result = await runPaymentUploads([], async () => { assert.fail(); }, () => {});
  assert.deepEqual(result, { pending: [], errors: [] });
  const first = new File(["a"], "a.pdf", { type: "application/pdf", lastModified: 1 });
  const duplicate = new File(["a"], "a.pdf", { type: "application/pdf", lastModified: 1 });
  const second = new File(["b"], "b.pdf");
  assert.deepEqual(appendPaymentFiles([first], [duplicate, second]), [first, second]);
});
