"use strict";
// Shared Node.js CommonJS utility; also used by serverless CommonJS applications.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createHash } = require("node:crypto");
const pending = new Map();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function fingerprint(value) { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function cacheKey(scope, purpose, input) {
  if (!scope || !purpose) throw new Error("AI cache requires an authorized scope and purpose.");
  return fingerprint({ version: 1, scope, purpose, input });
}
function credentials() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
async function database(path, options = {}) {
  const config = credentials();
  if (!config) return null;
  try {
    const response = await globalThis.fetch(config.url + "/rest/v1/" + path, {
      ...options, cache: "no-store", signal: AbortSignal.timeout(2500),
      headers: { apikey: config.key, Authorization: "Bearer " + config.key,
        "Content-Type": "application/json", "Accept-Profile": "public", "Content-Profile": "public",
        Prefer: "resolution=merge-duplicates,return=minimal", ...(options.headers || {}) }
    });
    if (!response.ok) return null;
    return response.status === 204 ? true : await response.json().catch(() => true);
  } catch { return null; } // Cache/metrics outages must not break the business operation.
}
async function readMany(keys) {
  const found = new Map();
  for (let offset = 0; offset < keys.length; offset += 80) {
    const group = keys.slice(offset, offset + 80).filter(key => /^[a-f0-9]{64}$/.test(key));
    if (!group.length) continue;
    const rows = await database("ai_result_cache?select=cache_key,value&cache_key=in.(" + group.join(",") + ")&expires_at=gt." + encodeURIComponent(new Date().toISOString()));
    if (Array.isArray(rows)) for (const row of rows) if (group.includes(row.cache_key)) found.set(row.cache_key, row.value);
  }
  return found;
}
async function writeMany(entries, { ownerId = null, purpose, ttlMs = 86400000 } = {}) {
  if (!entries.length || !purpose) return;
  const expires = new Date(Date.now() + Math.min(Math.max(ttlMs, 60000), 30 * 86400000)).toISOString();
  const rows = entries.filter(entry => /^[a-f0-9]{64}$/.test(entry.key) && JSON.stringify(entry.value).length <= 2000000)
    .map(entry => ({ cache_key: entry.key, purpose, actor_id: UUID.test(ownerId || "") ? ownerId : null, value: entry.value, expires_at: expires }));
  for (let offset = 0; offset < rows.length; offset += 48) {
    await database("ai_result_cache?on_conflict=cache_key", { method: "POST", body: JSON.stringify(rows.slice(offset, offset + 48)) });
  }
}
async function cachedJson({ scope, purpose, input, ownerId = null, ttlMs = 86400000, validate = () => true }, produce) {
  const key = cacheKey(scope, purpose, input);
  if (pending.has(key)) { const result = await pending.get(key); return { ...result, cacheHit: validate(result.value) }; }
  const operation = (async () => {
    const saved = (await readMany([key])).get(key);
    if (saved !== undefined && validate(saved)) return { value: saved, cacheHit: true };
    const value = await produce();
    if (validate(value)) await writeMany([{ key, value }], { ownerId, purpose, ttlMs });
    return { value, cacheHit: false };
  })();
  pending.set(key, operation);
  try { return await operation; } finally { pending.delete(key); }
}
async function recordUsage({ system, operation, ownerId = null, response = {}, cacheHit = false }) {
  const usage = response.usage || {};
  const count = value => Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
  const row = {
    system_name: system, operation, actor_id: UUID.test(ownerId || "") ? ownerId : null,
    response_id: typeof response.id === "string" ? response.id : null,
    model: typeof response.model === "string" ? response.model : null,
    input_tokens: cacheHit ? 0 : count(usage.input_tokens ?? usage.prompt_tokens),
    output_tokens: cacheHit ? 0 : count(usage.output_tokens ?? usage.completion_tokens),
    cached_input_tokens: cacheHit ? 0 : count(usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens),
    reasoning_tokens: cacheHit ? 0 : count(usage.output_tokens_details?.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens),
    cache_hit: cacheHit
  };
  // No prompts, source documents, outputs, credentials or personal data in logs.
  console.info("ai_usage", JSON.stringify({ ...row, actor_id: undefined }));
  await database("ai_usage_events", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(row) });
}
module.exports = { stable, fingerprint, cacheKey, readMany, writeMany, cachedJson, recordUsage };
function matchesSchema(value, schema) {
  if (!schema) return true;
  if (schema.anyOf) return schema.anyOf.some(item => matchesSchema(value, item));
  if (Array.isArray(schema.type)) return schema.type.some(type => matchesSchema(value, { ...schema, type }));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === "null") return value === null;
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    if ((schema.required || []).some(key => !Object.hasOwn(value, key))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties || {}, key))) return false;
    return Object.entries(schema.properties || {}).every(([key, rule]) => !Object.hasOwn(value, key) || matchesSchema(value[key], rule));
  }
  if (schema.type === "array") return Array.isArray(value) && value.length >= (schema.minItems || 0) && value.length <= (schema.maxItems ?? Infinity) && value.every(item => matchesSchema(item, schema.items));
  if (schema.type === "string") return typeof value === "string" && value.length >= (schema.minLength || 0) && value.length <= (schema.maxLength ?? Infinity) && (!schema.pattern || new RegExp(schema.pattern).test(value));
  if (schema.type === "boolean") return typeof value === "boolean";
  if (["number", "integer"].includes(schema.type)) return typeof value === "number" && Number.isFinite(value) && (schema.type !== "integer" || Number.isInteger(value)) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity);
  return true;
}
async function openAIFetch(url, options, context) {
  const request = JSON.parse(options.body);
  const validate = entry => {
    if (!entry || entry.status !== 200 || !entry.payload || entry.payload.error) return false;
    const payload = entry.payload;
    if (["failed", "incomplete", "cancelled", "queued", "in_progress"].includes(payload.status)) return false;
    if (payload.choices?.some(choice => choice.finish_reason === "length" || choice.finish_reason === "content_filter")) return false;
    const text = payload.output_text || (payload.output || []).flatMap(item => item.content || []).filter(item => item.type === "output_text").map(item => item.text || "").join("")
      || payload.choices?.[0]?.message?.content;
    if (!text) return false;
    const schema = request.text?.format?.schema;
    if (schema || url.endsWith('/chat/completions') || request.response_format) {
      try {
        const parsed = JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/g, ''));
        if (!matchesSchema(parsed, schema)) return false;
      } catch { return false; }
    }
    return context.validate ? context.validate(payload) : true;
  };
  const result = await cachedJson({
    scope: context.scope, purpose: context.operation, ownerId: context.ownerId,
    input: context.input ?? { url, request }, ttlMs: context.ttlMs || 86400000, validate
  }, async () => {
    const response = await globalThis.fetch(url, options);
    return { status: response.status, requestId: response.headers?.get?.('x-request-id') || '', payload: await response.json().catch(() => ({})) };
  });
  await recordUsage({ ...context, response: result.value.payload, cacheHit: result.cacheHit });
  return new Response(JSON.stringify(result.value.payload), {
    status: result.value.status, headers: { "Content-Type": "application/json", "X-AI-Cache": result.cacheHit ? "hit" : "miss", "x-request-id": result.value.requestId || '' }
  });
}
module.exports.openAIFetch = openAIFetch;
