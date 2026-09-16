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

// Keep extraction selections and variables separate from the native sheet,
// whose opening actions may otherwise overwrite them or enter modal mode.
export function isolatedQlikAppWebSocketUrl(socketUrl: string, appId: string, identity: string) {
  if (!isQlikAppWebSocketUrl(socketUrl, appId) || !identity.trim()) {
    throw new Error("Qlik: conexão ou identidade inválida para a sessão de leitura.");
  }
  const url = new URL(socketUrl);
  url.pathname = `/app/${encodeURIComponent(appId)}/identity/${encodeURIComponent(identity)}`;
  return url.toString();
}
