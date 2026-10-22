import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function harness(admin: boolean) {
  const jobs: Array<() => Promise<void>> = [];
  const calls: string[] = [];
  const exports: Record<string, unknown> = {};
  class PaymentError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status});
  runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/operations/construction/refresh/route.ts", import.meta.url), "utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {
    exports,
    require: (name: string) => {
      if(name === "next/server") return { after: (job: () => Promise<void>) => jobs.push(job) };
      if(name.endsWith("operations-server")) return { operationsAccess: async (_request:Request, modules:string[], write:boolean) => {assert.equal(modules.join(","),"obras");assert.equal(write,true);return {actor:{admin}};} };
      if(name.endsWith("payment-server")) return {PaymentError,paymentJson:json,paymentFailure:(error:PaymentError)=>json({error:error.message},error.status)};
      if(name.endsWith("qlik-operations-sync")) return {syncQlikOperations: async (kind:string) => {calls.push(kind);return json({partial:kind === "paid" && calls.length === 1});}};
      throw new Error(name);
    }
  });
  return {jobs,calls,post:exports.POST as (r:Request)=>Promise<Response>};
}
test("sincronização exige administrador e só inicia após responder; retoma etapas parciais", async () => {
  const denied=harness(false);
  assert.equal((await denied.post(new Request("http://local",{method:"POST"}))).status,403);
  assert.equal(denied.jobs.length,0);
  const allowed=harness(true);
  assert.equal((await allowed.post(new Request("http://local",{method:"POST"}))).status,200);
  assert.equal(allowed.calls.length,0);
  assert.equal(allowed.jobs.length,1);
  await allowed.jobs[0]();
  assert.deepEqual(allowed.calls,["paid","paid","payable"]);
});
