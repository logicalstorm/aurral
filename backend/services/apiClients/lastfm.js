import axios from "axios";
import Bottleneck from "bottleneck";
import NodeCache from "node-cache";
import { logger } from "../logger.js";
import { LASTFM_API } from "../../config/constants.js";
import { getLastfmApiKey } from "./config.js";

const lastfmCache = new NodeCache({
  stdTTL: 300,
  checkperiod: 60,
  maxKeys: 5000,
});

const lastfmLimiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 200,
});

const LASTFM_TIMEOUT_MS = 6000;
const LASTFM_MAX_RETRIES = 2;

const lastfmInflightRequests = new Map();
const lastfmErrorLogAt = new Map();

let _lastfmApiCallCount = 0;
const _lastfmApiCallCountByMethod = new Map();

export const lastfmRequest = lastfmLimiter.wrap(
  async (method, params = {}, options = {}) => {
    const apiKey = getLastfmApiKey();
    if (!apiKey) return null;

    const cacheKey = `lfm:${method}:${JSON.stringify(params)}`;
    const cached = lastfmCache.get(cacheKey);
    if (cached) return cached;
    const inflight = lastfmInflightRequests.get(cacheKey);
    if (inflight) return inflight;
    _lastfmApiCallCount += 1;
    const currentByMethod = _lastfmApiCallCountByMethod.get(method) || 0;
    _lastfmApiCallCountByMethod.set(method, currentByMethod + 1);
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

export async function lastfmGetArtistNameByMbid(mbid) {
  const data = await lastfmRequest("artist.getInfo", { mbid });
  const name = data?.artist?.name;
  return name && typeof name === "string" ? name.trim() : null;
}

export async function lastfmGetArtistImageUrlByName(artistName) {
  const name = String(artistName || "").trim();
  if (!name) return null;
  try {
    const data = await lastfmRequest("artist.getInfo", { artist: name });
    const images = Array.isArray(data?.artist?.image) ? data.artist.image : [];
    for (let index = images.length - 1; index >= 0; index -= 1) {
      const url = String(images[index]?.["#text"] || "").trim();
      if (url) return url;
    }
    return null;
  } catch {
    return null;
  }
}

export async function lastfmSearchArtists(query, { limit = 5 } = {}) {
  const trimmed = String(query || "").trim();
  if (!trimmed || !getLastfmApiKey()) return [];
  const data = await lastfmRequest("artist.search", {
    artist: trimmed,
    limit: Math.min(30, Math.max(1, limit)),
  });
  const results = data?.results?.artistmatches?.artist;
  return results ? [].concat(results) : [];
}

export async function lastfmSearchAlbums(query, { limit = 5 } = {}) {
  const trimmed = String(query || "").trim();
  if (!trimmed || !getLastfmApiKey()) return [];
  const data = await lastfmRequest("album.search", {
    album: trimmed,
    limit: Math.min(30, Math.max(1, limit)),
  });
  const results = data?.results?.albummatches?.album;
  return results ? [].concat(results) : [];
}

export async function lastfmSearchTracks(query, { limit = 5 } = {}) {
  const trimmed = String(query || "").trim();
  if (!trimmed || !getLastfmApiKey()) return [];
  const data = await lastfmRequest("track.search", {
    track: trimmed,
    limit: Math.min(30, Math.max(1, limit)),
  });
  const results = data?.results?.trackmatches?.track;
  return results ? [].concat(results) : [];
}

function stripHtml(html) {
  if (typeof html !== "string") return "";
  return html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
}

export async function lastfmGetArtistBio(mbid) {
  if (!mbid) return null;
  try {
    const data = await lastfmRequest("artist.getInfo", { mbid });
    const bio = data?.artist?.bio;
    if (!bio) return null;
    const summary =
      typeof bio.summary === "string" && bio.summary.trim()
        ? stripHtml(bio.summary.trim())
        : null;
    const content =
      typeof bio.content === "string" && bio.content.trim()
        ? stripHtml(bio.content.trim())
        : null;
    return summary || content || null;
  } catch (e) {
    return null;
  }
}

export function getLastfmApiCallCount() {
  return _lastfmApiCallCount;
}

export function getLastfmApiCallCountByMethod() {
  return Object.fromEntries(_lastfmApiCallCountByMethod);
}

export function resetLastfmApiCallCount() {
  _lastfmApiCallCount = 0;
  _lastfmApiCallCountByMethod.clear();
}

export const clearLastfmCache = () => {
  lastfmCache.flushAll();
};

export { lastfmCache };