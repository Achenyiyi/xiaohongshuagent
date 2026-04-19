type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type XhsCacheStore = {
  noteDetails: Map<string, CacheEntry<Record<string, unknown>>>;
  searchResponses: Map<string, CacheEntry<unknown>>;
};

const globalForXhsCache = globalThis as typeof globalThis & {
  __xhsCacheStore?: XhsCacheStore;
};

function getStore(): XhsCacheStore {
  if (!globalForXhsCache.__xhsCacheStore) {
    globalForXhsCache.__xhsCacheStore = {
      noteDetails: new Map(),
      searchResponses: new Map(),
    };
  }

  return globalForXhsCache.__xhsCacheStore;
}

function getCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string) {
  const entry = cache.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function setCachedValue<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number
) {
  cache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  });

  if (cache.size > 300) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }
}

export function getCachedSearchResponse<T>(key: string) {
  return getCachedValue(getStore().searchResponses as Map<string, CacheEntry<T>>, key);
}

export function setCachedSearchResponse<T>(key: string, value: T, ttlMs: number) {
  setCachedValue(getStore().searchResponses as Map<string, CacheEntry<T>>, key, value, ttlMs);
}

export function getCachedNoteDetail(noteId: string) {
  return getCachedValue(getStore().noteDetails, noteId);
}

export function setCachedNoteDetail(
  noteId: string,
  noteDetail: Record<string, unknown>,
  ttlMs: number
) {
  setCachedValue(getStore().noteDetails, noteId, noteDetail, ttlMs);
}
