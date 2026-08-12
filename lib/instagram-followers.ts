const INSTAGRAM_ORIGIN = "https://www.instagram.com";
const INSTAGRAM_WEB_APP_ID = "936619743392459";
const DEFAULT_TIMEOUT_MS = 8_000;

type InstagramProfileSource = "public-json" | "public-html" | "public-embed";

export type InstagramProfile = {
  username: string;
  followersCount: number;
  source: InstagramProfileSource;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function normalizeCompactCount(rawValue: string | number) {
  if (typeof rawValue === "number") {
    if (!Number.isInteger(rawValue) || rawValue < 0) throw new Error("contagem inválida");
    return rawValue;
  }

  const normalized = rawValue
    .trim()
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ");
  const match = normalized.match(/^([0-9][0-9.,\s]*?)\s*(mil|mi|k|m)?$/i);
  if (!match) throw new Error("contagem inválida");

  const suffix = match[2]?.toLowerCase();
  const numericPart = match[1].replace(/\s/g, "");
  let numericValue: number;

  if (suffix) {
    numericValue = Number(numericPart.replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", "."));
  } else {
    numericValue = Number(numericPart.replace(/[.,]/g, ""));
  }

  const multiplier = suffix === "mil" || suffix === "k"
    ? 1_000
    : suffix === "mi" || suffix === "m"
      ? 1_000_000
      : 1;
  const result = Math.round(numericValue * multiplier);
  if (!Number.isFinite(result) || result < 0) throw new Error("contagem inválida");
  return result;
}

function followerCountFromRecord(user: Record<string, unknown>) {
  const edge = asRecord(user.edge_followed_by);
  const candidate = user.followers_count ?? user.follower_count ?? edge?.count;
  if (typeof candidate !== "number" && typeof candidate !== "string") return null;
  try {
    return normalizeCompactCount(candidate);
  } catch {
    return null;
  }
}

export function parseInstagramPublicJson(payload: unknown, expectedUsername: string): InstagramProfile {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const user = asRecord(data?.user) || asRecord(root?.user) || root;
  if (!user) throw new Error("Instagram: resposta pública inválida.");

  const username = typeof user.username === "string" ? user.username : expectedUsername;
  if (username.toLowerCase() !== expectedUsername.toLowerCase()) {
    throw new Error(`Instagram: o perfil retornado (@${username}) não corresponde ao perfil esperado.`);
  }

  const followersCount = followerCountFromRecord(user);
  if (followersCount === null) {
    throw new Error("Instagram: contagem de seguidores ausente na resposta pública.");
  }

  return { username, followersCount, source: "public-json" };
}

function decodeHtml(value: string) {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:x27|39);/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function metaDescriptions(html: string) {
  return [...html.matchAll(/<meta\b[^>]*>/gi)].flatMap(([tag]) => {
    const property = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    return property === "og:description" || property === "description"
      ? [decodeHtml(content || "")]
      : [];
  });
}

export function parseInstagramPublicHtml(
  html: string,
  expectedUsername: string,
  source: Extract<InstagramProfileSource, "public-html" | "public-embed"> = "public-html",
): InstagramProfile {
  if (!html.trim()) throw new Error("Instagram: página pública vazia.");

  const jsonPatterns = [
    /["']followers_count["']\s*:\s*([0-9]+)/i,
    /["']follower_count["']\s*:\s*([0-9]+)/i,
    /["']edge_followed_by["']\s*:\s*\{\s*["']count["']\s*:\s*([0-9]+)/i,
  ];
  for (const pattern of jsonPatterns) {
    const match = html.match(pattern);
    if (match) {
      return { username: expectedUsername, followersCount: normalizeCompactCount(match[1]), source };
    }
  }

  for (const description of metaDescriptions(html)) {
    const match = description.match(/([0-9][0-9.,\s]*?(?:\s*(?:mil|mi|k|m))?)\s+(?:followers?|seguidores?)\b/i);
    if (match) {
      return { username: expectedUsername, followersCount: normalizeCompactCount(match[1]), source };
    }
  }

  throw new Error("Instagram: a página pública não expôs a contagem de seguidores.");
}

async function publicProfileAttempt({
  url,
  username,
  source,
  fetchImpl,
  timeoutMs,
}: {
  url: string;
  username: string;
  source: InstagramProfileSource;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}) {
  const wantsJson = source === "public-json";
  const response = await fetchImpl(url, {
    headers: {
      Accept: wantsJson ? "application/json" : "text/html,application/xhtml+xml",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      "User-Agent": "TerraLotusIndicators/1.0 (+https://www.terralotus.space)",
      ...(wantsJson ? { "X-IG-App-ID": INSTAGRAM_WEB_APP_ID } : {}),
    },
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Instagram: consulta pública indisponível (${response.status}).`);

  const body = await response.text();
  if (wantsJson) {
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new Error("Instagram: resposta pública não retornou JSON válido.");
    }
    return parseInstagramPublicJson(payload, username);
  }
  return parseInstagramPublicHtml(body, username, source);
}

export async function fetchInstagramFollowers({
  username = "terralotusurbanismo",
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  username?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}) {
  const normalizedUsername = username.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(normalizedUsername)) {
    throw new Error("Instagram: nome de perfil inválido.");
  }

  const encodedUsername = encodeURIComponent(normalizedUsername);
  const attempts = [
    {
      source: "public-json" as const,
      url: `${INSTAGRAM_ORIGIN}/api/v1/users/web_profile_info/?username=${encodedUsername}`,
    },
    {
      source: "public-html" as const,
      url: `${INSTAGRAM_ORIGIN}/${encodedUsername}/`,
    },
    {
      source: "public-embed" as const,
      url: `${INSTAGRAM_ORIGIN}/${encodedUsername}/embed/`,
    },
  ];

  const results = await Promise.allSettled(attempts.map((attempt) => publicProfileAttempt({
    ...attempt,
    username: normalizedUsername,
    fetchImpl,
    timeoutMs,
  })));
  const successful = results.find((result): result is PromiseFulfilledResult<InstagramProfile> => result.status === "fulfilled");
  if (successful) return successful.value;

  throw new Error("Instagram: o perfil público não disponibilizou a contagem nesta execução. O último valor válido foi preservado.");
}
