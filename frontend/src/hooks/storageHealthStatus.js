import { getStorageHealth } from "../utils/api";

let cache = {
  ok: true,
  hasFailure: false,
  checkedAt: null,
  result: null,
};
const listeners = new Set();
let inflight = null;

function notify() {
  for (const listener of listeners) {
    listener(cache);
  }
}

export function getStorageHealthCache() {
  return cache;
}

export function subscribeStorageHealth(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setStorageHealthResult(result) {
  cache = {
    ok: result?.ok !== false,
    hasFailure: result?.ok === false,
    checkedAt: result?.checkedAt || new Date().toISOString(),
    result: result || null,
  };
  notify();
}

export async function refreshStorageHealth({ force = false } = {}) {
  if (inflight && !force) return inflight;
  inflight = getStorageHealth({ force })
    .then((result) => {
      setStorageHealthResult(result);
      return result;
    })
    .catch((error) => {
      throw error;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
