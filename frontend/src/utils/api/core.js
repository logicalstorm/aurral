import { getAppBasePath } from "../basePath.js";
import { isProxyAuthActive } from "../authRecovery.js";

const getDefaultApiBaseUrl = () => {
  if (import.meta.env.DEV) return "/api";
  const basePath = getAppBasePath();
  if (basePath === "/") return "/api";
  return `${basePath}/api`;
};

const API_BASE_URL = import.meta.env.VITE_API_URL || getDefaultApiBaseUrl();

function joinUrl(baseURL, url) {
  if (!url) return baseURL;
  if (String(url).startsWith("http://") || String(url).startsWith("https://")) return url;
  return `${String(baseURL).replace(/\/+$/, "")}/${String(url).replace(/^\/+/, "")}`;
}

function appendParams(url, params) {
  if (!params || typeof params !== "object") return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  if (!query) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${query}`;
}

function createApiClient({ baseURL, timeout = 30000, headers = {} }) {
  const requestInterceptors = [];
  const responseInterceptors = [];

  async function runRequestInterceptors(config) {
    let next = { ...config, headers: { ...headers, ...config.headers } };
    for (const { fulfilled, rejected } of requestInterceptors) {
      try {
        next = await fulfilled(next);
      } catch (error) {
        if (rejected) return rejected(error);
        throw error;
      }
    }
    return next;
  }

  async function runResponseInterceptors(response) {
    let next = response;
    for (const { fulfilled } of responseInterceptors) {
      next = await fulfilled(next);
    }
    return next;
  }

  async function runResponseErrorInterceptors(error) {
    let next = error;
    for (const { rejected } of responseInterceptors) {
      if (!rejected) continue;
      next = await rejected(next);
    }
    return next;
  }

  async function request(config) {
    const cfg = await runRequestInterceptors(config);
    const method = String(cfg.method || "GET").toUpperCase();
    let url = appendParams(joinUrl(baseURL, cfg.url || ""), cfg.params);
    const controller = new AbortController();
    const timeoutMs = Number(cfg.timeout ?? timeout);
    const timer =
      timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const init = {
        method,
        headers: { ...cfg.headers },
        signal: controller.signal,
      };
      if (cfg.data != null && method !== "GET" && method !== "HEAD") {
        init.body = typeof cfg.data === "string" ? cfg.data : JSON.stringify(cfg.data);
        if (!init.headers["Content-Type"] && !init.headers["content-type"]) {
          init.headers["Content-Type"] = "application/json";
        }
      }

      const res = await fetch(url, init);
      const contentType = res.headers.get("content-type") || "";
      let data;
      if (contentType.includes("json")) {
        try {
          data = await res.json();
        } catch {
          data = null;
        }
      } else {
        data = await res.text();
      }

      const response = {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
        data,
      };

      if (!res.ok) {
        const error = new Error(`Request failed with status code ${res.status}`);
        error.response = response;
        throw await runResponseErrorInterceptors(error);
      }

      return runResponseInterceptors(response);
    } catch (error) {
      if (error?.response) throw error;
      throw await runResponseErrorInterceptors(error);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    interceptors: {
      request: {
        use: (fulfilled, rejected) => requestInterceptors.push({ fulfilled, rejected }),
      },
      response: {
        use: (fulfilled, rejected) => responseInterceptors.push({ fulfilled, rejected }),
      },
    },
    get: (url, config = {}) => request({ ...config, method: "GET", url }),
    post: (url, data, config = {}) => request({ ...config, method: "POST", url, data }),
    put: (url, data, config = {}) => request({ ...config, method: "PUT", url, data }),
    patch: (url, data, config = {}) => request({ ...config, method: "PATCH", url, data }),
    delete: (url, config = {}) => request({ ...config, method: "DELETE", url }),
  };
}

const api = createApiClient({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

export const AUTH_INVALID_EVENT = "aurral:auth-invalid";

const AUTH_TOKEN_KEY = "auth_token";
const AUTH_PASSWORD_KEY = "auth_password";
const AUTH_USER_KEY = "auth_user";

function readAuthFromStorage(storage) {
  if (!storage) return { token: "" };
  return {
    token: storage.getItem(AUTH_TOKEN_KEY) || "",
  };
}

export const getStoredAuth = () => {
  const localAuth = readAuthFromStorage(globalThis?.localStorage);
  if (localAuth.token) return localAuth;
  const sessionAuth = readAuthFromStorage(globalThis?.sessionStorage);
  if (sessionAuth.token && globalThis?.localStorage) {
    globalThis.localStorage.setItem(AUTH_TOKEN_KEY, sessionAuth.token);
    return sessionAuth;
  }
  return sessionAuth;
};

export const getRequestToken = () => {
  const { token } = getStoredAuth();
  return token && !isProxyAuthActive() ? token : "";
};

export const setStoredAuth = ({ token = "" } = {}) => {
  if (!token) {
    globalThis?.sessionStorage?.removeItem(AUTH_TOKEN_KEY);
    globalThis?.localStorage?.removeItem(AUTH_TOKEN_KEY);
    return;
  }
  globalThis?.sessionStorage?.setItem(AUTH_TOKEN_KEY, token);
  globalThis?.localStorage?.setItem(AUTH_TOKEN_KEY, token);
  globalThis.localStorage?.removeItem(AUTH_PASSWORD_KEY);
  globalThis.localStorage?.removeItem(AUTH_USER_KEY);
};

export const clearAuthStorage = () => {
  globalThis?.sessionStorage?.removeItem(AUTH_TOKEN_KEY);
  globalThis?.localStorage?.removeItem(AUTH_TOKEN_KEY);
  globalThis?.sessionStorage?.removeItem(AUTH_PASSWORD_KEY);
  globalThis?.localStorage?.removeItem(AUTH_PASSWORD_KEY);
  globalThis?.localStorage?.removeItem(AUTH_USER_KEY);
};

export const libraryLookupCache = new Map();
const MAX_LIBRARY_LOOKUP_CACHE_SIZE = 1000;
export const coverResponseCache = new Map();
export const coverInflightRequests = new Map();
const MAX_COVER_CACHE_SIZE = 1000;
const COVER_CACHE_TTL_MS = 30 * 60 * 1000;
const EMPTY_COVER_CACHE_TTL_MS = 60 * 1000;
export const searchInflightRequests = new Map();
export const bootstrapInflight = new Map();
export const flowStatusInflight = new Map();

export const setLibraryLookupCacheEntry = (id, value) => {
  if (id == null) return;
  if (libraryLookupCache.has(id)) {
    libraryLookupCache.delete(id);
  }
  libraryLookupCache.set(id, value);
  if (libraryLookupCache.size > MAX_LIBRARY_LOOKUP_CACHE_SIZE) {
    const oldestKey = libraryLookupCache.keys().next().value;
    if (oldestKey !== undefined) {
      libraryLookupCache.delete(oldestKey);
    }
  }
};

const setCoverCacheEntry = (key, value) => {
  if (!key) return;
  const images = Array.isArray(value?.images) ? value.images : [];
  const ttlMs = images.length > 0 ? COVER_CACHE_TTL_MS : EMPTY_COVER_CACHE_TTL_MS;
  if (coverResponseCache.has(key)) {
    coverResponseCache.delete(key);
  }
  coverResponseCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  if (coverResponseCache.size > MAX_COVER_CACHE_SIZE) {
    const oldestKey = coverResponseCache.keys().next().value;
    if (oldestKey !== undefined) {
      coverResponseCache.delete(oldestKey);
    }
  }
};

export const getCoverCacheEntry = (key) => {
  const entry = coverResponseCache.get(key);
  if (!entry) return null;
  if (Date.now() >= Number(entry.expiresAt || 0)) {
    coverResponseCache.delete(key);
    return null;
  }
  return entry.value;
};

export const fetchInflightOnce = async (store, key, requestFactory) => {
  if (store.has(key)) {
    return store.get(key);
  }

  const request = requestFactory().finally(() => {
    store.delete(key);
  });
  store.set(key, request);
  return request;
};

export const fetchCoverWithMemo = async (key, requestFactory, { bypassCache = false } = {}) => {
  if (!bypassCache) {
    const cached = getCoverCacheEntry(key);
    if (cached) {
      return cached;
    }
  }

  return fetchInflightOnce(coverInflightRequests, key, () =>
    requestFactory().then((response) => {
      setCoverCacheEntry(key, response);
      return response;
    }),
  );
};

const responseData = (request) => request.then((response) => response.data);
export const getData = (url, config) => responseData(api.get(url, config));
export const postData = (url, data, config) => responseData(api.post(url, data, config));
export const putData = (url, data, config) => responseData(api.put(url, data, config));
export const patchData = (url, data, config) => responseData(api.patch(url, data, config));
export const deleteData = (url, config) => responseData(api.delete(url, config));

export const lidarrCredentialParams = (url, apiKey, { trimUrl = false } = {}) => ({
  ...(url ? { url: trimUrl ? url.replace(/\/+$/, "") : url } : {}),
  ...(apiKey ? { apiKey } : {}),
});

const getApiBaseUrl = () => import.meta.env.VITE_API_URL || getDefaultApiBaseUrl();

export const buildAuthenticatedApiUrl = (path, params = {}) => {
  const normalizedPath = String(path || "").startsWith("/")
    ? String(path || "")
    : `/${String(path || "")}`;
  const query = new URLSearchParams();
  const token = getRequestToken();
  if (token) query.set("token", token);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") query.set(key, String(value));
  });
  const queryString = query.toString();
  const separator = normalizedPath.includes("?") ? "&" : "?";
  return `${getApiBaseUrl()}${normalizedPath}${
    queryString ? `${separator}${queryString}` : ""
  }`;
};

api.interceptors.request.use(
  (config) => {
    const token = getRequestToken();
    if (token) {
      config.headers["Authorization"] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    const status = error?.response?.status;
    const code = error?.response?.data?.code;
    if (status === 401 && code === "SESSION_INVALID") {
      clearAuthStorage();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(AUTH_INVALID_EVENT));
      }
    }
    return Promise.reject(error);
  },
);

export default api;
