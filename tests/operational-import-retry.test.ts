import test from "node:test";
import assert from "node:assert/strict";
import { retryImportWrite } from "../lib/operational-import-retry.ts";

test("retries a transient schema outage before an idempotent page succeeds", async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await retryImportWrite(
    async () => ({
      error:
        ++calls < 3
          ? { code: "PGRST002", message: "Schema cache unavailable" }
          : null,
    }),
    async (ms) => {
      delays.push(ms);
    },
  );
  assert.equal(result.error, null);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1000, 2000]);
});
test("does not retry an invalid financial record and bounds transient retries", async () => {
  let calls = 0;
  const invalid = { code: "23503", message: "foreign key violation" };
  assert.equal(
    (
      await retryImportWrite(
        async () => {
          calls++;
          return { error: invalid };
        },
        async () => {},
      )
    ).error,
    invalid,
  );
  assert.equal(calls, 1);
  calls = 0;
  await retryImportWrite(
    async () => {
      calls++;
      return { error: { code: "PGRST002", message: "unavailable" } };
    },
    async () => {},
  );
  assert.equal(calls, 5);
});

test('retries a lock timeout on an idempotent import page',async()=>{
 let calls=0;
 const r=await retryImportWrite(async()=>({error:++calls===1?{code:'55P03',message:'canceling statement due to lock timeout'}:null}),async()=>{});
 assert.equal(calls,2);assert.equal(r.error,null);
});
