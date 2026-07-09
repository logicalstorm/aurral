import { normalizeBasePathWithTrailingSlash } from "./basePath.js";

export const PROXY_AUTH_KEY = "aurral:proxy-auth";
export const AUTH_RECOVERY_RELOAD_KEY = "aurral:auth-recovery-reload";
export const PROXY_RELOAD_TS_KEY = "aurral:proxy-reload-ts";

export const isProxyAuthActive = () =>
  globalThis?.sessionStorage?.getItem(PROXY_AUTH_KEY) === "1";

export const resetClientCache = async () => {
  const registrations = globalThis?.navigator?.serviceWorker
    ? await globalThis.navigator.serviceWorker.getRegistrations()
    : [];
  const cacheKeys = globalThis?.caches ? await globalThis.caches.keys() : [];

  await Promise.allSettled(registrations.map((registration) => registration.unregister()));
  await Promise.allSettled(cacheKeys.map((cacheKey) => globalThis.caches.delete(cacheKey)));

  return registrations.length > 0 || cacheKeys.length > 0;
};

export const hardNavigateHome = (basePath = "/") => {
  if (typeof window === "undefined") return;
  const path = normalizeBasePathWithTrailingSlash(basePath);
  window.location.href = `${window.location.origin}${path}`;
};

export const clearAuthRecoveryFlags = () => {
  globalThis?.sessionStorage?.removeItem(AUTH_RECOVERY_RELOAD_KEY);
  globalThis?.sessionStorage?.removeItem(PROXY_RELOAD_TS_KEY);
  globalThis?.sessionStorage?.removeItem(PROXY_AUTH_KEY);
};
