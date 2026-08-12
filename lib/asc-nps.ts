import { Buffer } from "node:buffer";

const ASC_BASE_URL = "https://sac-terralotus.ascbrazil.com.br";

export type NpsMonthResult = {
  referenceMonth: string;
  average: number | null;
  responseCount: number;
  distribution: Record<string, number>;
};

type AscCredentials = {
  username: string;
  password: string;
  surveyId: string;
};

function normalizeText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function extractJsonAssignment(html: string, variableName: string) {
  const assignment = new RegExp(`(?:var|let|const)\\s+${variableName}\\s*=`, "i").exec(html);
  if (!assignment) throw new Error(`ASCSAC: variável ${variableName} não encontrada no relatório.`);
  const start = html.indexOf("[", assignment.index + assignment[0].length);
  if (start < 0) throw new Error(`ASCSAC: início de ${variableName} não encontrado.`);

  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "[") depth += 1;
    else if (character === "]") {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }
  throw new Error(`ASCSAC: fim de ${variableName} não encontrado.`);
}

function recommendationQuestionIndex(html: string) {
  const headings = [...html.matchAll(/<h3\b[^>]*class=["'][^"']*panel-title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/gi)]
    .map((match) => normalizeText(match[1]));
  const index = headings.findIndex((heading) => heading.includes("indicaria"));
  if (index < 0) throw new Error("ASCSAC: pergunta de recomendação não encontrada no relatório.");
  return index;
}

export function parseNpsReportHtml(html: string, referenceMonth: string): NpsMonthResult {
  const chartData = JSON.parse(extractJsonAssignment(html, "atendPorStatus")) as Array<Array<{
    data?: string | number;
    label?: string;
  }>>;
  if (chartData.length === 0) {
    return { referenceMonth, average: null, responseCount: 0, distribution: {} };
  }

  const questionIndex = recommendationQuestionIndex(html);
  const answerCounts = chartData[questionIndex];
  if (!Array.isArray(answerCounts)) throw new Error("ASCSAC: distribuição da pergunta de recomendação não encontrada.");

  const distribution: Record<string, number> = {};
  for (const item of answerCounts) {
    const noteMatch = String(item.label || "").match(/(-?\d+(?:[.,]\d+)?)\s*$/);
    const note = noteMatch ? Number(noteMatch[1].replace(",", ".")) : Number.NaN;
    const count = Number(item.data);
    if (!Number.isFinite(note) || note < 0 || note > 5 || !Number.isFinite(count) || count < 0) continue;
    distribution[String(note)] = (distribution[String(note)] || 0) + count;
  }

  const entries = Object.entries(distribution);
  const responseCount = entries.reduce((sum, [, count]) => sum + count, 0);
  const weightedTotal = entries.reduce((sum, [note, count]) => sum + Number(note) * count, 0);
  return {
    referenceMonth,
    average: responseCount ? Math.round(weightedTotal / responseCount * 10_000) / 10_000 : null,
    responseCount,
    distribution,
  };
}

function formatDate(date: Date) {
  return [
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    date.getUTCFullYear(),
  ].join("-");
}

export function buildMonthlyReportPath(surveyId: string, year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  const filter = `cod_pesquisa/${surveyId}/dat_inicio/${formatDate(start)}/dat_fim/${formatDate(end)}`;
  return `/relatorios-pesquisa/detalhamento/datastr/${encodeURIComponent(Buffer.from(filter).toString("base64"))}`;
}

function updateCookies(response: Response, jar: Map<string, string>) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headers.getSetCookie?.() || (headers.get("set-cookie") ? [headers.get("set-cookie")!] : []);
  for (const cookie of setCookies) {
    const firstPart = cookie.split(";", 1)[0];
    const separator = firstPart.indexOf("=");
    if (separator > 0) jar.set(firstPart.slice(0, separator).trim(), firstPart.slice(separator + 1).trim());
  }
}

function cookieHeader(jar: Map<string, string>) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function sessionRequest(
  path: string,
  jar: Map<string, string>,
  init: RequestInit = {},
): Promise<{ response: Response; body: Uint8Array; url: string }> {
  let url = new URL(path, ASC_BASE_URL).toString();
  let method = init.method || "GET";
  let body = init.body;

  for (let redirects = 0; redirects < 6; redirects += 1) {
    const headers = new Headers(init.headers);
    headers.set("Accept", "text/html,application/xhtml+xml");
    headers.set("User-Agent", "TerraLotus-Indicators/1.0");
    const cookies = cookieHeader(jar);
    if (cookies) headers.set("Cookie", cookies);
    const response = await fetch(url, { ...init, method, body, headers, redirect: "manual", cache: "no-store" });
    updateCookies(response, jar);
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, body: new Uint8Array(await response.arrayBuffer()), url };
    }
    const location = response.headers.get("location");
    if (!location) throw new Error("ASCSAC: redirecionamento sem destino.");
    url = new URL(location, url).toString();
    if (![307, 308].includes(response.status)) {
      method = "GET";
      body = undefined;
    }
  }
  throw new Error("ASCSAC: excesso de redirecionamentos durante a autenticação.");
}

function decodeHtml(body: Uint8Array) {
  return new TextDecoder("windows-1252").decode(body);
}

function formToken(html: string) {
  const match = html.match(/<input\b[^>]*name=["']form_token["'][^>]*value=["']([^"']+)["']/i)
    || html.match(/<input\b[^>]*value=["']([^"']+)["'][^>]*name=["']form_token["']/i);
  if (!match) throw new Error("ASCSAC: token do formulário de login não encontrado.");
  return match[1];
}

async function authenticate(credentials: AscCredentials) {
  const jar = new Map<string, string>();
  const loginPage = await sessionRequest("/login", jar);
  if (!loginPage.response.ok) throw new Error(`ASCSAC: login indisponível (${loginPage.response.status}).`);
  const form = new URLSearchParams({
    form_token: formToken(decodeHtml(loginPage.body)),
    f_nom_login: credentials.username,
    f_nom_senha: credentials.password,
    language_user: "",
  });
  const authenticated = await sessionRequest("/login/autenticar", jar, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: `${ASC_BASE_URL}/login` },
    body: form.toString(),
  });
  const html = decodeHtml(authenticated.body);
  if (authenticated.url.includes("/login") || html.includes('id="login-password"')) {
    throw new Error("ASCSAC: usuário ou senha inválidos.");
  }
  return jar;
}

export async function scrapeNpsYear(credentials: AscCredentials, year: number) {
  const jar = await authenticate(credentials);
  const results: NpsMonthResult[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const report = await sessionRequest(buildMonthlyReportPath(credentials.surveyId, year, month), jar);
    const html = decodeHtml(report.body);
    if (!report.response.ok) throw new Error(`ASCSAC: relatório ${month}/${year} indisponível (${report.response.status}).`);
    if (report.url.includes("/login") || html.includes('id="login-password"')) {
      throw new Error("ASCSAC: sessão expirada durante a leitura dos relatórios.");
    }
    const monthKey = `${year}-${String(month).padStart(2, "0")}-01`;
    results.push(parseNpsReportHtml(html, monthKey));
  }
  return results;
}
