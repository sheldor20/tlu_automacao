export function extractQlikAppId(sheetUrl: string) {
  const pathname = new URL(sheetUrl).pathname;
  const match = pathname.match(/\/sense\/app\/([^/]+)/i);
  if (!match?.[1]) throw new Error("Qlik: o identificador do aplicativo não foi encontrado na URL da planilha.");
  return decodeURIComponent(match[1]);
}
