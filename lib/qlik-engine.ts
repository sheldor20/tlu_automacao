export function extractQlikAppId(sheetUrl: string) {
  const pathname = new URL(sheetUrl).pathname;
  const match = pathname.match(/\/sense\/app\/([^/]+)/i);
  if (!match?.[1]) throw new Error("Qlik: o identificador do aplicativo não foi encontrado na URL da planilha.");
  return decodeURIComponent(match[1]);
}

export function isQlikAppWebSocketUrl(socketUrl: string, appId: string) {
  try {
    const url = new URL(socketUrl);
    const match = url.pathname.match(/\/app\/([^/]+)/i);
    const socketAppId = match?.[1];
    return url.protocol === "wss:"
      && typeof socketAppId === "string"
      && decodeURIComponent(socketAppId).toLocaleLowerCase() === appId.toLocaleLowerCase();
  } catch {
    return false;
  }
}
