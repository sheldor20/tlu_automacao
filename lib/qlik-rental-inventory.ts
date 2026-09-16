import type { QlikTableSnapshot } from "./qlik-delinquency";

export const RENTAL_INVENTORY_CONNECTION = "qlik-rental-inventory";
export const RENTAL_INVENTORY_APP = "5073ca65-2740-43d7-9688-70b76e124382";
export const RENTAL_INVENTORY_SHEET = "14e708cf-cef9-49a2-8e26-71fe61bed660";
export const RENTAL_INVENTORY_URL = `https://terralotusurbanismo.us.qlikcloud.com/sense/app/${RENTAL_INVENTORY_APP}/sheet/${RENTAL_INVENTORY_SHEET}/state/analysis`;

export type RentalInventoryMapping = {
  object_id: string;
  id_column: string;
  name_column: string;
  type_column?: string;
  rentable_column?: string;
  rentable_values?: { yes: string[]; no: string[] };
  legacy_matches?: Record<string, string>;
};
export type RentalInventoryRow = {
  source_id: string;
  name: string;
  property_type?: string;
  rentable?: boolean;
  existing_rental_id?: string;
};

export function rentalInventoryMapping(settings: Record<string, unknown>): RentalInventoryMapping {
  if (settings.mapping_verified !== true) throw new Error("Confirme o objeto da tabela, o código estável e o nome do imóvel no Qlik antes de ativar a importação.");
  for (const key of ["object_id", "id_column", "name_column"]) {
    if (typeof settings[key] !== "string" || !settings[key].trim()) throw new Error(`Mapeamento de imóveis pendente: ${key}.`);
  }
  for (const key of ["type_column", "rentable_column"]) {
    if (settings[key] !== undefined && (typeof settings[key] !== "string" || !settings[key].trim())) throw new Error(`Coluna inválida: ${key}.`);
  }
  if (settings.id_column === settings.name_column) throw new Error("O código estável do imóvel precisa ser diferente do nome.");
  if (settings.rentable_column) {
    const values = settings.rentable_values as RentalInventoryMapping["rentable_values"];
    if (!values || !Array.isArray(values.yes) || !Array.isArray(values.no) || !values.yes.length || !values.no.length ||
      [...values.yes, ...values.no].some((value) => typeof value !== "string" || !value.trim()) ||
      values.yes.some((value) => values.no.map(normalize).includes(normalize(value)))) throw new Error("Configure os valores de sim e não para locação, sem sobreposição.");
  }
  if (settings.legacy_matches !== undefined && (!settings.legacy_matches || typeof settings.legacy_matches !== "object" || Array.isArray(settings.legacy_matches))) throw new Error("Vínculos dos imóveis existentes inválidos.");
  return settings as RentalInventoryMapping;
}
const normalize = (text: string) => text.trim().toLocaleLowerCase("pt-BR");

export function parseRentalInventory(snapshot: QlikTableSnapshot, mapping: RentalInventoryMapping): RentalInventoryRow[] {
  if (!snapshot.rows.length) throw new Error("O Qlik retornou uma carteira vazia. A última carga será preservada.");
  const index = (name: string) => {
    const positions = snapshot.headers.map((header, i) => normalize(header) === normalize(name) ? i : -1).filter((i) => i >= 0);
    if (positions.length !== 1) throw new Error(`Coluna ausente ou ambígua no Qlik: ${name}.`);
    return positions[0];
  };
  const idIndex = index(mapping.id_column), nameIndex = index(mapping.name_column);
  const typeIndex = mapping.type_column ? index(mapping.type_column) : null;
  const rentableIndex = mapping.rentable_column ? index(mapping.rentable_column) : null;
  const seen = new Set<string>();
  return snapshot.rows.map((cells) => {
    if (cells.length !== snapshot.headers.length) throw new Error("Linha incompleta na tabela de imóveis do Qlik.");
    const source_id = cells[idIndex].trim(), name = cells[nameIndex].trim();
    if (!source_id || source_id === "-" || source_id.length > 200 || name.length < 2 || name.length > 140 || seen.has(source_id)) throw new Error("Imóvel com código ausente/duplicado ou nome inválido. A carga não será gravada.");
    seen.add(source_id);
    const row: RentalInventoryRow = { source_id, name };
    if (typeIndex !== null) {
      const value = cells[typeIndex].trim();
      if (!value || value === "-" || value.length > 120) throw new Error(`Tipo do imóvel ${source_id} não informado no Qlik.`);
      row.property_type = value;
    }
    if (rentableIndex !== null) {
      const value = normalize(cells[rentableIndex]);
      if (mapping.rentable_values?.yes.map(normalize).includes(value)) row.rentable = true;
      else if (mapping.rentable_values?.no.map(normalize).includes(value)) row.rentable = false;
      else throw new Error(`Permissão de locação não reconhecida no imóvel ${source_id}.`);
    }
    const legacyId = mapping.legacy_matches?.[source_id];
    if (legacyId) {
      if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(legacyId)) throw new Error("Vínculo inválido com imóvel existente.");
      row.existing_rental_id = legacyId;
    }
    return row;
  });
}
