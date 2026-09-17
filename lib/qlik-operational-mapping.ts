import { createHash } from "node:crypto";
import type { QlikCell, QlikCubeSpec, QlikCube } from "./qlik-operational";
export const OPERATIONAL_MEASURES = {
  received: "818299db-48eb-4571-9af5-bf7122a22b5b",
  paid: "02f52521-bed6-40f0-9dd1-1cedc6193070",
  payable: "a1cd67d3-08de-4276-ae7e-8da123a5e804",
  receivable: "87d7ac56-9b74-4154-bd06-a1c66e026b69",
} as const;
export type OperationalKind = keyof typeof OPERATIONAL_MEASURES | "catalog";
export const catalogSpecs: QlikCubeSpec[] = [
  { key: "companies", fields: ["%IdEmpresa", "Nome Empresa"] },
  {
    key: "works",
    fields: ["%IdEmpresa", "%IdObra", "Cód Unidade Negócio", "Unidade Negócio"],
  },
];
export function operationalPeopleSpec(
  kind: Exclude<OperationalKind, "catalog">,
): QlikCubeSpec {
  return {
    key: "people",
    measureId: OPERATIONAL_MEASURES[kind],
    fields: [
      "%IdEmpresa",
      "%IdObra",
      "%IdEmitente",
      "%IdVenda",
      "Nr Venda",
      "Unidade",
      "Nome Emitente",
    ],
  };
}
export function mapOperationalPeople(cube: QlikCube): ImportRecord[] {
  const rows = cube.rows.map((row) => [
    ...row.slice(0, 4),
    { text: "catalog", number: null },
    { text: "", number: null },
    ...row.slice(4, 7),
    { text: "", number: null },
    { text: "", number: null },
    { text: "", number: null },
    row[7],
  ]);
  return mapOperationalPage(
    { ...cube, key: "received", rows },
    "received",
  ).records.filter((r) => r.entity !== "entries");
}
export function operationalSpec(
  kind: Exclude<OperationalKind, "catalog">,
): QlikCubeSpec {
  return {
    key: kind,
    measureId: OPERATIONAL_MEASURES[kind],
    fields: [
      "%IdEmpresa",
      "%IdObra",
      "%IdEmitente",
      "%IdVenda",
      "Cód Parcela",
      "Nr Parcela",
      "Nr Venda",
      "Unidade",
      "Nome Emitente",
      kind === "received"
        ? "Período"
        : kind === "paid"
          ? "Data Baixa"
          : kind === "payable"
            ? "Data Vencimento"
            : "Data Prorrogação Vencimento",
      "Data Vencimento",
      "CAP",
    ],
  };
}
export function qlikText(cell: QlikCell) {
  return cell?.text && cell.text !== "-" ? cell.text.trim() : null;
}
export function qlikDate(cell: QlikCell) {
  if (cell?.number !== null && Number.isFinite(cell?.number))
    return new Date(
      Date.UTC(1899, 11, 30) + Math.round(cell.number!) * 86400000,
    )
      .toISOString()
      .slice(0, 10);
  const text = qlikText(cell);
  if (!text) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  throw new Error("Data inválida na origem Qlik.");
}
export type ImportRecord = {
  entity: "companies" | "works" | "clients" | "contracts" | "entries";
  id: string;
  data: Record<string, unknown>;
};
export function mapOperationalPage(cube: QlikCube, kind: OperationalKind) {
  const records: ImportRecord[] = [];
  let total = 0;
  for (const row of cube.rows) {
    if (cube.key === "companies") {
      const id = qlikText(row[0]),
        name = qlikText(row[1]);
      if (id && name)
        records.push({
          entity: "companies",
          id,
          data: { id, name, company_key: name },
        });
      continue;
    }
    if (cube.key === "works") {
      const key = qlikText(row[1]);
      if (!key || key.endsWith("|")) continue;
      const company = qlikText(row[0]) || key.split("|")[0],
        workId = qlikText(row[2]) || key,
        name = qlikText(row[3]);
      if (!company || !key.startsWith(company + "|"))
        throw new Error("Vínculo de empresa e obra inconsistente no Qlik.");
      records.push({
        entity: "works",
        id: key,
        data: {
          key,
          company_id: company,
          work_id: workId,
          name: name || "Cadastro sem descrição (" + key + ")",
          active: !!name,
        },
      });
      continue;
    }
    if (kind === "catalog" || cube.key !== kind)
      throw new Error("Origem financeira inválida.");
    const company = qlikText(row[0]),
      work = qlikText(row[1])?.endsWith("|") ? null : qlikText(row[1]),
      client = qlikText(row[2]),
      sale = qlikText(row[3]),
      title = qlikText(row[4]),
      name = qlikText(row[8]);
    const raw = row[12]?.number;
    if (raw === null || !Number.isFinite(raw) || !company || !title)
      throw new Error("Título sem empresa, identificação ou valor.");
    const amount = Math.round(raw * 1e6) / 1e6;
    total += amount;
    const cashDate = qlikDate(row[9]),
      due = qlikDate(row[10]),
      category = qlikText(row[11]);
    const incoming = kind === "received" || kind === "receivable";
    // The complete dimensional grain distinguishes split allocations of a title.
    const id =
      kind +
      ":" +
      createHash("sha256")
        .update(
          JSON.stringify([row.slice(0, 12).map((c) => qlikText(c)), amount]),
        )
        .digest("hex");
    const contractId = incoming && sale && client ? sale : null;
    if (incoming && client && name) {
      records.push({
        entity: "clients",
        id: client,
        data: { id: client, name },
      });
      if (sale) {
        const unit = qlikText(row[7]),
          match = unit?.match(/QD\.?\s*(\S+)\s+LT\.?\s*(\S+)/i);
        records.push({
          entity: "contracts",
          id: sale,
          data: {
            id: sale,
            client_id: client,
            company_id: company,
            work_key: work,
            contract_number: qlikText(row[6]) || sale,
            lot: match?.[2] || unit,
            block: match?.[1] || null,
            status: null,
          },
        });
      }
    } else if (contractId)
      throw new Error("Contrato sem cliente identificado.");
    records.push({
      entity: "entries",
      id,
      data: {
        id,
        company_id: company,
        work_key: work,
        contract_id: contractId,
        kind,
        title_key: title.split("|").slice(1).join("|"),
        cash_date: cashDate,
        original_due_date: due,
        amount,
        description: [qlikText(row[5]), category].filter(Boolean).join(" · "),
        counterparty: name,
        stage_name: null,
        source_category: category,
      },
    });
  }
  return { records, total };
}
