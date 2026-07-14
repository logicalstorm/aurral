export default function createCache(defaultTtlSeconds = 300, maxEntries = 1000) {
  const cache = new Map();

  return {
    get(key) {
      const entry = cache.get(key);
      if (entry === undefined) return undefined;
      if (entry.expires < Date.now()) {
        cache.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value, ttlSeconds = defaultTtlSeconds) {
      if (cache.has(key)) cache.delete(key);
      cache.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
      // ponytail: FIFO cap; switch to measured LRU only if cache churn becomes material.
      if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    },
    flushAll() {
      cache.clear();
    },
  };
}
