import test from "node:test";
import assert from "node:assert/strict";
import {
  mapOperationalPage,
  qlikDate,
} from "../lib/qlik-operational-mapping.ts";
const cells = (values: Array<string | number | null>) =>
  values.map((v) => ({
    text: v === null ? "-" : String(v),
    number: typeof v === "number" ? v : null,
  }));
test("catálogo preserva a chave composta e inclui obras sem movimento, sem criar obras vazias", () => {
  const cube = {
    key: "works",
    headers: [],
    totalRows: 3,
    rows: [
      cells([null, "13|001", "13|001", "Residencial"]),
      cells(["1", "1|", null, null]),
      cells(["9", "9|09", null, null]),
    ],
  };
  const result = mapOperationalPage(cube, "catalog");
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].data.company_id, "13");
  assert.equal(result.records[1].data.active, false);
  assert.throws(
    () =>
      mapOperationalPage(
        { ...cube, rows: [cells(["2", "1|001", "1|001", "Obra"])] },
        "catalog",
      ),
    /inconsistente/,
  );
});
test("datas duais e rateios financeiros preservam precisão e vínculos", () => {
  assert.equal(qlikDate({ text: "17/09/2026", number: 46282 }), "2026-09-17");
  const row = cells([
    "1",
    "1|001",
    "42",
    "1|001|7",
    "Recebido|1|001|7|1",
    "1/120",
    "7",
    "QD.002 LT.017",
    "Cliente",
    46282,
    46252,
    "Principal",
    100.123456,
  ]);
  const cube = { key: "received", headers: [], totalRows: 1, rows: [row] };
  const mapped = mapOperationalPage(cube, "received");
  const contract = mapped.records.find((r) => r.entity === "contracts")!;
  assert.equal(contract.data.lot, "017");
  assert.equal(contract.data.block, "002");
  assert.equal(mapped.total, 100.123456);
  const entry = mapped.records.find((r) => r.entity === "entries")!;
  assert.equal(entry.data.contract_id, "1|001|7");
  assert.equal(entry.data.title_key, "1|001|7|1");
  assert.equal(entry.data.stage_name, null);
  assert.equal(entry.data.source_category, "Principal");
});
test("vencidos trazidos para hoje ficam fora da previsão; datas futuras ajustadas são preservadas", () => {
  const row = cells(["1","1|001","42","v1","Receber|1","1","1","Lote","Cliente","17/09/2026","01/09/2026","Principal",100]);
  const cube = {key:"receivable",headers:[],totalRows:1,rows:[row]};
  const mapped = mapOperationalPage(cube,"receivable","2026-09-17");
  assert.equal(mapped.records.find(r=>r.entity==="entries")!.data.cash_date,"2026-09-01");
  row[9] = {text:"12/10/2026",number:null};
  row[10] = {text:"10/10/2026",number:null};
  assert.equal(mapOperationalPage(cube,"receivable","2026-09-17").records.find(r=>r.entity==="entries")!.data.cash_date,"2026-10-12");
});
