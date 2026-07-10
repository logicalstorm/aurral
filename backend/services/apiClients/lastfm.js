import axios from "../../../lib/axiosFetch.js";
import https from "https";
import createRateLimiter from "./rateLimiter.js";
import createCache from "./simpleCache.js";
import { logger } from "../logger.js";
import { LASTFM_API } from "../../config/constants.js";
import { getLastfmApiKey } from "./config.js";

const lastfmCache = createCache(300);

const lastfmLimiter = createRateLimiter(200);

const lastfmHttpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 16,
  maxFreeSockets: 8,
  timeout: 15000,
});

const LASTFM_TIMEOUT_MS =
  Math.max(3000, parseInt(process.env.AURRAL_LASTFM_TIMEOUT_MS, 10) || 0) || 15000;
const LASTFM_MAX_RETRIES = 2;

const lastfmInflightRequests = new Map();
const lastfmErrorLogAt = new Map();

export const lastfmRequest = lastfmLimiter.wrap(
  async (method, params = {}, options = {}) => {
    const apiKey = getLastfmApiKey();
    if (!apiKey) return null;

    const cacheKey = `lfm:${method}:${JSON.stringify(params)}`;
    const cached = lastfmCache.get(cacheKey);
    if (cached) return cached;
    const inflight = lastfmInflightRequests.get(cacheKey);
    if (inflight) return inflight;
    const timeoutMs = Number.isFinite(Number(options?.timeoutMs))
      ? Math.max(500, Math.floor(Number(options.timeoutMs)))
      : LASTFM_TIMEOUT_MS;
    const maxRetries = Number.isFinite(Number(options?.maxRetries))
      ? Math.max(0, Math.floor(Number(options.maxRetries)))
      : LASTFM_MAX_RETRIES;

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
        `${details.method}:${details.status || "none"}:${details.code || "none"}`;
      const logError = (message, details) => {
        const key = getLogKey(details);
        const now = Date.now();
        const last = lastfmErrorLogAt.get(key) || 0;
        if (now - last < 15000) return;
        lastfmErrorLogAt.set(key, now);
        logger.error("api", message, details);
      };
      let lastError = null;
      for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
        try {
          const response = await axios.get(LASTFM_API, {
            params: {
              method,
              api_key: apiKey,
              format: "json",
              ...params,
            },
            timeout: timeoutMs,
            httpsAgent: lastfmHttpsAgent,
          });
          lastfmCache.set(cacheKey, response.data);
          return response.data;
        } catch (error) {
          lastError = error;
          if (retryCount < maxRetries && isRetryable(error)) {
            const backoffMs = 300 * Math.pow(2, retryCount) + retryCount * 200;
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }
          break;
        }
      }
      const status = lastError?.response?.status || null;
      const payloadError =
        lastError?.response?.data?.message ||
        lastError?.response?.data?.error ||
        null;
      const details = {
        method,
        status,
        code: lastError?.code || null,
        message: lastError?.message || "Unknown Last.fm error",
        error: payloadError,
      };
      if (details.code === "ECONNABORTED") {
        logError(`Last.fm API timeout (${method})`, details);
      } else {
        logError(`Last.fm API error (${method})`, details);
      }
      return null;
    })();
    lastfmInflightRequests.set(cacheKey, requestPromise);
    try {
      return await requestPromise;
    } finally {
      lastfmInflightRequests.delete(cacheKey);
    }
  },
);

export { lastfmCache };
