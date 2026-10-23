export type DistratoSelectOption = { value: string; label: string };

export function filterDistratoOptions(options: DistratoSelectOption[], query: string) {
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  return options.filter((option) => terms.every((term) => normalize(option.label).includes(term)));
}
