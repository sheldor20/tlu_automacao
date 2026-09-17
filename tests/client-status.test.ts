import test from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_STATUS_SPEC,
  mapQlikClientStatuses,
} from "../lib/qlik-client-status.ts";
import { clientFinancialStatus } from "../lib/client-workspace.ts";

const cube = (rows: string[][]) => ({
  key: "client-status",
  headers: CLIENT_STATUS_SPEC.fields!,
  totalRows: rows.length,
  rows: rows.map((r) => r.map((text) => ({ text, number: null }))),
});
test("situação do cliente considera todos os contratos e prioriza atraso", () => {
  assert.equal(
    clientFinancialStatus([
      { financial_status: "paid" },
      { financial_status: "overdue" },
    ]),
    "overdue",
  );
  assert.equal(
    clientFinancialStatus([
      { financial_status: "current" },
      { financial_status: "paid" },
    ]),
    "current",
  );
  assert.equal(
    clientFinancialStatus([
      { financial_status: "paid" },
      { financial_status: "paid" },
    ]),
    "paid",
  );
  assert.equal(
    clientFinancialStatus([
      { financial_status: "unknown" },
      { financial_status: "paid" },
    ]),
    "unknown",
  );
  assert.equal(clientFinancialStatus([]), "unknown");
  assert.equal(
    clientFinancialStatus([
      { financial_status: "paid" },
      { financial_status: "unknown", sale_status: "Cancelado" },
    ]),
    "paid",
  );
  assert.equal(
    clientFinancialStatus([
      { financial_status: "unknown", sale_status: "Cancelado" },
    ]),
    "unknown",
  );
});
test("Qlik: quitação, autorização, escritura e registro preservam as etapas da fonte", () => {
  const statuses = mapQlikClientStatuses(
    cube([
      ["1|001|1", "1", "1|001", "Quitada", "Registrado", "Sim"],
      ["1|001|2", "1", "1|001", "Normal", "Escriturado", "Sim"],
      [
        "1|001|3",
        "1",
        "1|001",
        "Normal",
        "Autorização De Escritura Emitida",
        "Não",
      ],
      ["1|001|4", "1", "1|001", "Normal", "Não Informado", "Sim"],
      ["1|001|5", "1", "1|001", "Cancelado", "Não Informado", "Não"],
      ["-", "-", "-", "-", "-", "-"],
    ]),
  );
  assert.equal(statuses.length, 5);
  assert.equal(statuses[0].paid_off, true);
  assert.equal(statuses[0].registration_status, "Registrado");
  assert.equal(statuses[0].deed_status, "Escriturada");
  assert.equal(statuses[1].registration_status, "Pendente");
  assert.equal(statuses[2].deed_status, "Autorizada");
  assert.equal(statuses[3].deed_status, "Autorizada");
  assert.equal(statuses[4].paid_off, false);
  assert.equal(statuses[4].registration_status, "Não informado");
});
test("Qlik: rejeita dados parciais, conflitos por contrato e vínculos incorretos", () => {
  const row = ["1|001|1", "1", "1|001", "Quitada", "Registrado", "Sim"];
  assert.throws(
    () => mapQlikClientStatuses({ ...cube([row]), totalRows: 2 }),
    /incompleta/,
  );
  assert.throws(
    () =>
      mapQlikClientStatuses(
        cube([[...row.slice(0, 2), "2|001", ...row.slice(3)]]),
      ),
    /inconsistente/,
  );
  assert.throws(
    () =>
      mapQlikClientStatuses(
        cube([row, [...row.slice(0, 4), "Escriturado", "Sim"]]),
      ),
    /Mais de uma/,
  );
  assert.throws(
    () =>
      mapQlikClientStatuses(
        cube([[...row.slice(0, 3), "Novo status", ...row.slice(4)]]),
      ),
    /não reconhecida/,
  );
  assert.equal(mapQlikClientStatuses(cube([row, row])).length, 1);
});
