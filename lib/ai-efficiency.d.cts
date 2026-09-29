export function fingerprint(value: unknown): string;
export function openAIFetch(url: string, options: RequestInit & {body: string}, context: {scope: string; system: string; operation: string; ownerId?: string | null; input?: unknown; ttlMs?: number; validate?: (payload: Record<string, unknown>) => boolean}): Promise<Response>;
export function cacheKey(scope: string, purpose: string, input: unknown): string;
export function stable(value: unknown): unknown;
export function readMany(keys: string[]): Promise<Map<string, unknown>>;
export function writeMany(entries: {key: string; value: unknown}[], options: {ownerId?: string | null; purpose: string; ttlMs?: number}): Promise<void>;
export function cachedJson<T>(options: {scope: string; purpose: string; input: unknown; ownerId?: string | null; ttlMs?: number; validate?: (value: unknown) => boolean}, produce: () => Promise<T>): Promise<{value: T; cacheHit: boolean}>;
export function recordUsage(options: {system: string; operation: string; ownerId?: string | null; response?: unknown; cacheHit?: boolean}): Promise<void>;
