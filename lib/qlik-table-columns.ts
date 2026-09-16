// GetHyperCubeData returns cells in qColumnOrder. Dimension/measure metadata
// remains in definition order, which may differ when a measure is interleaved.
export function qlikTableHeaders(headers: string[], columnOrder?: number[]): string[] {
  if (!columnOrder?.length) return headers;
  if (columnOrder.length !== headers.length || new Set(columnOrder).size !== headers.length ||
      columnOrder.some((index) => !Number.isInteger(index) || index < 0 || index >= headers.length)) {
    throw new Error("Qlik: ordem de colunas inválida; a carga anterior foi preservada.");
  }
  return columnOrder.map((index) => headers[index]);
}
