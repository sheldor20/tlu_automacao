/* Executes the actual sender with all external dependencies replaced. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as policy from "../lib/accountability/policy.ts";

test("send uses display name for email and technical code only for export", async () => {
  let exportValue: string | undefined;
  let email: { to: string; subject: string; text: string } | undefined;
  const writes: unknown[] = [];
  const service = {
    from(table: string) {
      assert.equal(table, "accountability_dispatches");
      return {
        update(values: unknown) {
          writes.push(values);
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
  const exports: {
    sendAccountabilityDispatch?: (
      service: unknown,
      id: string,
      enterprise: { name: string; qlik_value: string },
      year: number,
      month: number,
    ) => Promise<{ sent: boolean }>;
  } = {};
  const source = ts.transpileModule(
    readFileSync("lib/accountability/send.ts", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  runInNewContext(source, {
    exports,
    require(key: string) {
      if (key === "./policy") return policy;
      if (key === "./artifacts") return {
        accountabilityArtifacts: async (_service: unknown, _id: string, value: string) => {
          exportValue = value;
          return { pdf: Buffer.from("pdf"), excel: Buffer.from("xlsx"), reference: "setembro de 2026" };
        },
      };
      throw new Error(`Unmocked dependency: ${key}`);
    },
    Buffer, Date, Error, AbortSignal,
    process: { env: { RESEND_API_KEY: "fake", RESEND_FROM_EMAIL: "test@example.test" } },
    fetch: async (_url: string, init: RequestInit) => {
      email = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ id: "33333333-3333-4333-8333-333333333333" }), { status: 200 });
    },
  });
  const result = await exports.sendAccountabilityDispatch!(
    service, "11111111-1111-4111-8111-111111111111",
    { name: "Nome legível", qlik_value: "TECHNICAL_FILTER_009" }, 2026, 9,
  );
  assert.equal(result.sent, true);
  assert.equal(exportValue, "TECHNICAL_FILTER_009");
  assert.equal(email?.to, policy.BETA_RECIPIENT);
  assert.match(email!.subject, /Nome legível/);
  assert.match(email!.text, /Nome legível/);
  assert.doesNotMatch(email!.subject + email!.text, /TECHNICAL_FILTER_009/);
  assert.equal(writes.length, 1);
});
