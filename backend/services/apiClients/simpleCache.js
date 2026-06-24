export default function createCache(defaultTtlSeconds = 300) {
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
      cache.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
    },
    flushAll() {
      cache.clear();
    },
  };
}
