const INSTAGRAM_ORIGIN = "https://www.instagram.com";
const INSTAGRAM_WEB_APP_ID = "936619743392459";
const DEFAULT_TIMEOUT_MS = 8_000;

type InstagramProfileSource = "public-json" | "public-html" | "public-embed" | "browser-dom" | "screenshot-vision";

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
  source: Extract<InstagramProfileSource, "public-html" | "public-embed" | "browser-dom"> = "public-html",
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
  source: Extract<InstagramProfileSource, "public-json" | "public-html" | "public-embed">;
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

function outputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof response.output_text === "string") return response.output_text;
  return (response.output || []).flatMap((item) => item.content || []).filter((item) => item.type === "output_text").map((item) => item.text || "").join("");
}

export async function fetchInstagramFollowersFromScreenshot(username = "terralotusurbanismo") {
  const [{ default: chromium }, { default: puppeteer }] = await Promise.all([
    import("@sparticuz/chromium"),
    import("puppeteer-core"),
  ]);
  chromium.setGraphicsMode = false;
  const executablePath = process.env.CHROME_EXECUTABLE_PATH || await chromium.executablePath();
  if (!executablePath) throw new Error("Instagram: Chromium indisponível para captura de tela.");
  const browser = await puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: [...chromium.args, "--lang=pt-BR"], headless: "shell" }),
    defaultViewport: { width: 1365, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: true },
    executablePath,
    headless: "shell",
  });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" });
    await page.goto(`${INSTAGRAM_ORIGIN}/${encodeURIComponent(username)}/`, { waitUntil: "networkidle2", timeout: 40_000 });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const screenshot = await page.screenshot({ type: "jpeg", quality: 78, fullPage: false, encoding: "base64" });
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.OPENAI_VISION_MODEL || "gpt-5.6",
          instructions: "Leia a captura do perfil do Instagram. Retorne somente a quantidade inteira de seguidores do perfil, sem texto. Converta abreviações como mil, k, mi ou m para número inteiro. Se a contagem não estiver visível, retorne NOT_FOUND.",
          input: [{ role: "user", content: [{ type: "input_text", text: `Perfil esperado: @${username}` }, { type: "input_image", image_url: `data:image/jpeg;base64,${screenshot}`, detail: "high" }] }],
          max_output_tokens: 80,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) {
        const raw = outputText(await response.json()).trim();
        const numeric = raw.match(/[0-9][0-9.,\s]*(?:mil|mi|k|m)?/i)?.[0];
        if (numeric) return { username, followersCount: normalizeCompactCount(numeric), source: "screenshot-vision" as const };
      }
    }
    return parseInstagramPublicHtml(await page.content(), username, "browser-dom");
  } finally {
    await browser.close();
  }
}
