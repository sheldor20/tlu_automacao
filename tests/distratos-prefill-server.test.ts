import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
await import("./helpers/payment-transport-loader.mjs");
const { loadDistratoUnit } = await import("../lib/distratos-server.ts");

test("autopreenchimento lê apenas a seleção exata e mantém pagamentos originais para cálculo", async (t) => {
  const queries: URL[] = [];
  let revision = "2026-10-23T10:00:00Z";
  const received = [{ id: "r1", title_key: "007", cash_date: "2022-01-10", amount: 40, description: "Baixa 1", company_id: "20", work_key: "20|33" }, { id: "r2", title_key: "007", cash_date: "2022-02-10", amount: 60, description: "Baixa 2", company_id: "20", work_key: "20|33" }];
  let balance = 0;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input)); queries.push(url);
    if (url.pathname.endsWith("/client_contracts")) return Response.json({ id: "20|33|0007", client_id: "buyer1", company_id: "20", work_key: "20|33", contract_number: "0007", block: "007", lot: "003" });
    if (url.pathname.endsWith("/qlik_works")) return Response.json({ key: "20|33", work_id: "033", name: "Obra sintética", company_id: "20" });
    if (url.pathname.endsWith("/qlik_companies")) return Response.json({ name: "Empresa sintética" });
    if (url.pathname.endsWith("/client_accounts")) return Response.json({ name: "Pessoa sintética" });
    if (url.pathname.endsWith("/operational_publications")) return Response.json([{ kind: "received", published_at: "2026-10-23T09:00:00Z" }, { kind: "receivable", published_at: revision }]);
    if (url.pathname.endsWith("/operational_cash_entries")) return Response.json(url.searchParams.get("kind") === "eq.received" ? received : balance ? [{ ...received[0], id: "a1", amount: balance }] : []);
    throw new Error("Unexpected request: " + url.pathname);
  });
  const db = createClient("https://synthetic.invalid", "synthetic-key", { auth: { persistSession: false, autoRefreshToken: false } });
  const first = await loadDistratoUnit(db, "20|33|0007");
  assert.equal(first.unit.paidInstallments?.count, 1);
  assert.deepEqual(first.unit.receipts.map((r) => [r.id, r.amount]), [["r1", 40], ["r2", 60]]);
  for (const query of queries.filter((q) => q.pathname.endsWith("/operational_cash_entries"))) {
    assert.equal(query.searchParams.get("contract_id"), "eq.20|33|0007");
    assert.equal(query.searchParams.get("active"), "eq.true");
  }
  balance = 50; revision = "2026-10-23T11:00:00Z";
  const partial = await loadDistratoUnit(db, "20|33|0007");
  assert.equal(partial.unit.paidInstallments?.count, 0);
  assert.notEqual(first.sourceRevision, partial.sourceRevision);
  revision = "2026-10-23T08:00:00Z";
  assert.equal((await loadDistratoUnit(db, "20|33|0007")).unit.paidInstallments?.count, null);
});
