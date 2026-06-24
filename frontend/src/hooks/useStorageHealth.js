import { useCallback, useEffect, useState } from "react";
import {
  getStorageHealthCache,
  refreshStorageHealth,
  subscribeStorageHealth,
} from "./storageHealthStatus";

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
