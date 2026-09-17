import type { QlikCube, QlikCubeSpec } from "./qlik-operational";

export const CLIENT_STATUS_SPEC: QlikCubeSpec = {
  key: "client-status",
  fields: [
    "%IdVenda",
    "%IdEmpresa",
    "%IdObra",
    "Status Venda",
    "Status Escritura",
    "Tem Autorização Escritura?",
  ],
};
export type QlikClientStatus = {
  contract_id: string;
  company_id: string;
  work_key: string;
  sale_status: string;
  paid_off: boolean;
  deed_status: string;
  registration_status: string;
};

export function mapQlikClientStatuses(cube: QlikCube): QlikClientStatus[] {
  if (
    cube.key !== CLIENT_STATUS_SPEC.key ||
    cube.rows.length !== cube.totalRows ||
    cube.headers.join("|") !== CLIENT_STATUS_SPEC.fields!.join("|")
  ) {
    throw new Error("Leitura de situação dos contratos incompleta.");
  }
  const statuses = new Map<string, QlikClientStatus>();
  for (const row of cube.rows) {
    const [id, company, work, sale, deed, authorization] = row.map((c) =>
      c.text === "-" ? "" : c.text.trim(),
    );
    // The Qlik model also contains units without a sale.
    if (!id) continue;
    if (
      !company ||
      !work ||
      !work.startsWith(`${company}|`) ||
      !id.startsWith(`${work}|`)
    )
      throw new Error("Identificação da venda, empresa ou obra inconsistente.");
    if (
      !["Normal", "Quitada", "Cancelado"].includes(sale) ||
      ![
        "",
        "Não Informado",
        "Escriturado",
        "Registrado",
        "Autorização De Escritura Emitida",
      ].includes(deed) ||
      !["", "Sim", "Não"].includes(authorization)
    )
      throw new Error(
        "O Qlik retornou uma situação de contrato ainda não reconhecida.",
      );
    const complete = deed === "Escriturado" || deed === "Registrado";
    const authorized =
      deed === "Autorização De Escritura Emitida" || authorization === "Sim";
    const status: QlikClientStatus = {
      contract_id: id,
      company_id: company,
      work_key: work,
      sale_status: sale,
      paid_off: sale === "Quitada",
      deed_status: complete
        ? "Escriturada"
        : authorized
          ? "Autorizada"
          : "Não informado",
      registration_status:
        deed === "Registrado"
          ? "Registrado"
          : complete || authorized
            ? "Pendente"
            : "Não informado",
    };
    const previous = statuses.get(id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(status))
      throw new Error(
        "Mais de uma situação de escrituração para o mesmo contrato.",
      );
    statuses.set(id, status);
  }
  if (!statuses.size) throw new Error("Nenhum contrato encontrado no Qlik.");
  return [...statuses.values()];
}
