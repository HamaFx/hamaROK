interface CacheEntry {
  value: unknown;
  expiresAt: number;
  tags: string[];
  createdAt: number;
  lastAccessedAt: number;
}

interface ServerCacheStore {
  entries: Map<string, CacheEntry>;
  tags: Map<string, Set<string>>;
  inflight: Map<string, Promise<unknown>>;
}

interface ServerCacheGlobal {
  __hamaServerCache?: ServerCacheStore;
}

const DEFAULT_MAX_ENTRIES = 1200;
const globalForServerCache = globalThis as typeof globalThis & ServerCacheGlobal;

const cacheStore: ServerCacheStore = globalForServerCache.__hamaServerCache || {
  entries: new Map<string, CacheEntry>(),
  tags: new Map<string, Set<string>>(),
  inflight: new Map<string, Promise<unknown>>(),
};

globalForServerCache.__hamaServerCache = cacheStore;

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags || tags.length === 0) return [];
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

function removeTagReference(tag: string, key: string) {
  const indexed = cacheStore.tags.get(tag);
  if (!indexed) return;
  indexed.delete(key);
  if (indexed.size === 0) {
    cacheStore.tags.delete(tag);
  }
}

function evictCacheKey(key: string) {
  const existing = cacheStore.entries.get(key);
  if (!existing) return;
  cacheStore.entries.delete(key);
  for (const tag of existing.tags) {
    removeTagReference(tag, key);
  }
}

function pruneExpiredEntries(now: number) {
  for (const [key, entry] of cacheStore.entries.entries()) {
    if (entry.expiresAt <= now) {
      evictCacheKey(key);
    }
  }
}

function pruneToLimit(limit: number) {
  if (cacheStore.entries.size <= limit) return;

  const ordered = [...cacheStore.entries.entries()].sort(
    (a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt
  );
  const overflow = cacheStore.entries.size - limit;
  for (let index = 0; index < overflow; index += 1) {
    evictCacheKey(ordered[index][0]);
  }
}

function writeEntry(
  key: string,
  value: unknown,
  options: {
    tags: string[];
    ttlMs: number;
    maxEntries: number;
  }
) {
  const now = Date.now();
  evictCacheKey(key);

  const entry: CacheEntry = {
    value,
    tags: options.tags,
    createdAt: now,
    lastAccessedAt: now,
    expiresAt: now + options.ttlMs,
  };
  cacheStore.entries.set(key, entry);

  for (const tag of options.tags) {
    const keys = cacheStore.tags.get(tag);
    if (keys) {
      keys.add(key);
    } else {
      cacheStore.tags.set(tag, new Set([key]));
    }
  }

  pruneExpiredEntries(now);
  pruneToLimit(options.maxEntries);
}

function readEntry<T>(key: string): T | undefined {
  const now = Date.now();
  const entry = cacheStore.entries.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    evictCacheKey(key);
    return undefined;
  }
  entry.lastAccessedAt = now;
  return entry.value as T;
}

export function makeServerCacheKey(namespace: string, input?: unknown): string {
  if (input === undefined) return namespace;
  return `${namespace}:${stableSerialize(input)}`;
}

export async function withServerCache<T>(
  key: string,
  options: {
    ttlMs: number;
    tags?: string[];
    maxEntries?: number;
  },
  loader: () => Promise<T>
): Promise<T> {
  if (options.ttlMs <= 0) {
    return loader();
  }

  const cached = readEntry<T>(key);
  if (cached !== undefined) {
    return cached;
  }

  const inflight = cacheStore.inflight.get(key) as Promise<T> | undefined;
  if (inflight) {
    return inflight;
  }

  const tags = normalizeTags(options.tags);
  const maxEntries = Math.max(100, options.maxEntries ?? DEFAULT_MAX_ENTRIES);

  const promise = loader()
    .then((value) => {
      writeEntry(key, value, {
        ttlMs: options.ttlMs,
        tags,
        maxEntries,
      });
      return value;
    })
    .finally(() => {
      cacheStore.inflight.delete(key);
    });

  cacheStore.inflight.set(key, promise as Promise<unknown>);
  return promise;
}

export function invalidateServerCacheTag(tag: string) {
  const trimmed = tag.trim();
  if (!trimmed) return 0;

  const keys = cacheStore.tags.get(trimmed);
  if (!keys || keys.size === 0) return 0;

  const candidates = [...keys];
  cacheStore.tags.delete(trimmed);
  for (const key of candidates) {
    evictCacheKey(key);
  }
  return candidates.length;
}

export function invalidateServerCacheTags(tags: string[]) {
  let total = 0;
  for (const tag of normalizeTags(tags)) {
    total += invalidateServerCacheTag(tag);
  }
  return total;
}

export function clearServerCache() {
  cacheStore.entries.clear();
  cacheStore.tags.clear();
  cacheStore.inflight.clear();
}

export function getServerCacheStats() {
  const now = Date.now();
  const oldest = [...cacheStore.entries.values()].reduce<number | null>((acc, entry) => {
    if (entry.expiresAt <= now) return acc;
    if (acc == null) return entry.createdAt;
    return Math.min(acc, entry.createdAt);
  }, null);

  return {
    entries: cacheStore.entries.size,
    tags: cacheStore.tags.size,
    inflight: cacheStore.inflight.size,
    oldestEntryAgeMs: oldest == null ? 0 : now - oldest,
  };
}

function stableSerialize(value: unknown): string {
  if (value === null) return 'null';

  const valueType = typeof value;
  if (valueType === 'string') return JSON.stringify(value);
  if (valueType === 'number' || valueType === 'boolean') return JSON.stringify(value);
  if (valueType === 'bigint') return JSON.stringify(`${String(value)}n`);
  if (valueType === 'undefined') return '"__undefined__"';

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  if (valueType === 'object') {
    const objectValue = value as Record<string, unknown>;
    const keys = Object.keys(objectValue).sort();
    const encoded = keys
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(objectValue[key])}`)
      .join(',');
    return `{${encoded}}`;
  }

  return JSON.stringify(String(value));
}
