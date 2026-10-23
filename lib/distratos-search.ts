import { unitIdentifier } from "./distratos.ts";

export type DistratoSearchContract = {
  id: string; block: string; lot: string; contract_number: string; buyerName: string;
};

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

export function searchDistratoContracts(
  contracts: DistratoSearchContract[],
  query: string,
  workCode: string,
  filters: { block: string; lot: string },
) {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  return contracts.filter((contract) => {
    if (filters.block && contract.block !== filters.block) return false;
    if (filters.lot && contract.lot !== filters.lot) return false;
    const text = normalize([
      contract.buyerName, contract.contract_number,
      unitIdentifier({ workCode, block: contract.block, lot: contract.lot }),
      `quadra ${contract.block} lote ${contract.lot}`,
    ].join(" "));
    return terms.every((term) => text.includes(term));
  });
}
