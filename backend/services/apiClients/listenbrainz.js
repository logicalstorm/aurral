import axios from "axios";
import createRateLimiter from "./rateLimiter.js";
import createCache from "./simpleCache.js";
import { logger } from "../logger.js";
import { LISTENBRAINZ_API } from "../../config/constants.js";

const listenbrainzCache = createCache(300);

const listenbrainzLimiter = createRateLimiter(250);

const LISTENBRAINZ_TIMEOUT_MS = 6000;
const LISTENBRAINZ_MAX_RETRIES = 2;

const listenbrainzInflightRequests = new Map();
const listenbrainzErrorLogAt = new Map();

const shouldEmitThrottledLog = (logMap, key, throttleMs = 15000) => {
  const now = Date.now();
  const last = logMap.get(key) || 0;
  if (now - last < throttleMs) return false;
  logMap.set(key, now);
  return true;
};

export const listenbrainzRequest = listenbrainzLimiter.wrap(
  async (path, params = {}) => {
    const cacheKey = `lb:${path}:${JSON.stringify(params)}`;
    const cached = listenbrainzCache.get(cacheKey);
    if (cached) return cached;
    const inflight = listenbrainzInflightRequests.get(cacheKey);
    if (inflight) return inflight;

    const requestPromise = (async () => {
      const isRetryable = (error) => {
        const status = error.response?.status;
        const code = error.code;
        return (
          code === "ECONNABORTED" ||
          code === "ETIMEDOUT" ||
          code === "ECONNRESET" ||
          code === "ENOTFOUND" ||
          code === "EAI_AGAIN" ||
          [408, 425, 429, 500, 502, 503, 504].includes(status)
        );
      };
      const getLogKey = (details) =>
        `${details.path}:${details.status || "none"}:${details.code || "none"}`;
      const logError = (message, details) => {
        const key = getLogKey(details);
        const now = Date.now();
        const last = listenbrainzErrorLogAt.get(key) || 0;
        if (now - last < 15000) return;
        listenbrainzErrorLogAt.set(key, now);
        logger.error("api", message, details);
      };

      let lastError = null;
      for (
        let retryCount = 0;
        retryCount <= LISTENBRAINZ_MAX_RETRIES;
        retryCount++
      ) {
        try {
          const response = await axios.get(`${LISTENBRAINZ_API}${path}`, {
            params,
            timeout: LISTENBRAINZ_TIMEOUT_MS,
            validateStatus: (status) =>
              (status >= 200 && status < 300) || status === 204,
          });
          const payload = response.status === 204 ? null : response.data;
          listenbrainzCache.set(cacheKey, payload);
          return payload;
        } catch (error) {
          lastError = error;
          if (retryCount < LISTENBRAINZ_MAX_RETRIES && isRetryable(error)) {
            const backoffMs = 300 * Math.pow(2, retryCount) + retryCount * 200;
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }
          break;
        }
      }

      const details = {
        path,
        status: lastError?.response?.status || null,
        code: lastError?.code || null,
        message: lastError?.message || "Unknown ListenBrainz error",
        error:
          lastError?.response?.data?.error ||
          lastError?.response?.data?.message ||
          null,
      };
      logError("ListenBrainz API error:", details);
      throw lastError;
    })();

    listenbrainzInflightRequests.set(cacheKey, requestPromise);
    try {
      return await requestPromise;
    } finally {
      listenbrainzInflightRequests.delete(cacheKey);
    }
  },
);

export const clearListenbrainzCache = () => {
  listenbrainzCache.flushAll();
};

export { listenbrainzCache };