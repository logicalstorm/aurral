import { useCallback, useEffect, useState } from "react";
import { getStorageHealth } from "../utils/api/endpoints/settings.js";

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
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useStorageHealth({ enabled = true, pollMs = 120000 } = {}) {
  const [snapshot, setSnapshot] = useState(() => getStorageHealthCache());

  useEffect(() => {
    if (!enabled) return undefined;
    return subscribeStorageHealth(setSnapshot);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        await refreshStorageHealth();
      } catch {}
      if (cancelled) return;
    };
    load();
    if (!pollMs || pollMs <= 0)
      return () => {
        cancelled = true;
      };
    const interval = window.setInterval(load, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled, pollMs]);

  const refresh = useCallback(async () => {
    if (!enabled) return null;
    return refreshStorageHealth({ force: true });
  }, [enabled]);

  return {
    ...snapshot,
    refresh,
  };
}
