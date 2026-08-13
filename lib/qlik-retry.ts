export function isRecoverableQlikBrowserError(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return /target closed|session closed|browser (?:has )?disconnected|connection closed|protocol error.*closed|tempo esgotado ao abrir o websocket|nao foi possivel abrir o websocket autenticado|pagina nao abriu uma conexao nativa autenticada/.test(message);
}
