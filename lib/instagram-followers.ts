const DEFAULT_GRAPH_BASE_URL = "https://graph.instagram.com";
const DEFAULT_GRAPH_VERSION = "v25.0";

export type InstagramProfile = {
  id: string;
  username: string;
  followersCount: number;
};

export function parseInstagramProfile(payload: unknown): InstagramProfile {
  if (!payload || typeof payload !== "object") {
    throw new Error("Instagram: resposta inválida da API.");
  }

  const profile = payload as Record<string, unknown>;
  const followersCount = Number(profile.followers_count);
  if (
    typeof profile.id !== "string"
    || typeof profile.username !== "string"
    || !Number.isInteger(followersCount)
    || followersCount < 0
  ) {
    throw new Error("Instagram: perfil ou contagem de seguidores não encontrados.");
  }

  return {
    id: profile.id,
    username: profile.username,
    followersCount,
  };
}

export async function fetchInstagramFollowers({
  accountId,
  accessToken,
  expectedUsername,
  baseUrl = DEFAULT_GRAPH_BASE_URL,
  apiVersion = DEFAULT_GRAPH_VERSION,
}: {
  accountId: string;
  accessToken: string;
  expectedUsername?: string;
  baseUrl?: string;
  apiVersion?: string;
}) {
  const endpoint = new URL(`${baseUrl.replace(/\/$/, "")}/${apiVersion}/${encodeURIComponent(accountId)}`);
  endpoint.searchParams.set("fields", "id,username,followers_count");

  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const apiError = payload?.error && typeof payload.error === "object"
      ? (payload.error as Record<string, unknown>).message
      : null;
    throw new Error(`Instagram: ${typeof apiError === "string" ? apiError : `consulta indisponível (${response.status})`}.`);
  }

  const profile = parseInstagramProfile(payload);
  if (expectedUsername && profile.username.toLowerCase() !== expectedUsername.toLowerCase()) {
    throw new Error(`Instagram: a conta retornada (@${profile.username}) não corresponde ao perfil configurado.`);
  }
  return profile;
}
