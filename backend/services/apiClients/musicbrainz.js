import axios from "../../../lib/axiosFetch.js";
import createRateLimiter from "./rateLimiter.js";
import createCache from "./simpleCache.js";
import { logger } from "../logger.js";
import { dbOps } from "../../db/helpers/index.js";
import {
  MUSICBRAINZ_API,
  APP_NAME,
  APP_VERSION,
} from "../../config/constants.js";
import {
  getAlbumByMbid as getMetadataAlbumByMbid,
  getArtistNameByMbid as getMetadataArtistNameByMbid,
  getMetadataBaseUrl,
  legacyMusicbrainzRequest,
  listArtistAlbums as listMetadataArtistAlbums,
  resolveAlbumByArtistAndTitle,
  resolveArtistByName as resolveMetadataArtistByName,
} from "../providers/brainzmashProvider.js";
import { selectBestAlbumImage } from "../imageService.js";
import { getMusicBrainzContact } from "./config.js";

const mbCache = createCache(300);
const musicbrainzArtistNameCache = createCache(3600);
const musicbrainzReleaseGroupsCache = createCache(300);
const PRIMARY_RELEASE_TYPES = ["Album", "EP", "Single"];
const SECONDARY_RELEASE_TYPES = [
  "Live",
  "Remix",
  "Compilation",
  "Demo",
  "Broadcast",
  "Soundtrack",
  "Spokenword",
  "Other",
];
const itunesAlbumArtCache = createCache(24 * 60 * 60);

const shouldEmitThrottledLog = (logMap, key, throttleMs = 15000) => {
  const now = Date.now();
  const last = logMap.get(key) || 0;
  if (now - last < throttleMs) return false;
  logMap.set(key, now);
  return true;
};

let musicbrainzLast503Log = 0;
const musicbrainzInflightRequests = new Map();
const musicbrainzRetryLogAt = new Map();
const musicbrainzErrorLogAt = new Map();

const requestMusicbrainz = async (
  baseUrl,
  endpoint,
  queryParams,
  userAgent,
  forceIpv4 = false,
) =>
  axios.get(`${baseUrl}${endpoint}?${queryParams}`, {
    headers: { "User-Agent": userAgent },
    timeout: 5000,
    ...(forceIpv4 ? { family: 4 } : {}),
  });

const mbLimiter = createRateLimiter(1000);

const executeMusicbrainzRequest = async (
  endpoint,
  params = {},
  retryCount = 0,
  forceIpv4 = false,
) => {
  const cacheKey = `mb:${endpoint}:${JSON.stringify(params)}`;
  const cached = mbCache.get(cacheKey);
  if (cached) return cached;

  const MAX_RETRIES = 3;
  const queryParams = new URLSearchParams({
    fmt: "json",
    ...params,
  });

  const isConnectionError = (error) => {
    const connectionErrors = [
      "ECONNRESET",
      "ETIMEDOUT",
      "ECONNREFUSED",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ERR_BAD_RESPONSE",
      "ERR_NETWORK",
      "ERR_CONNECTION_REFUSED",
      "ERR_CONNECTION_TIMED_OUT",
      "ERR_INTERNET_DISCONNECTED",
    ];
    return (
      connectionErrors.some(
        (err) => error.code === err || error.message.includes(err),
      ) ||
      (error.code &&
        (error.code.startsWith("E") || error.code.startsWith("ERR_")))
    );
  };

  const contact =
    (getMusicBrainzContact() || "").trim() || "https://github.com/aurral";
  const userAgent = `${APP_NAME}/${APP_VERSION} ( ${contact} )`;

  const baseUrl = getMusicbrainzApiBaseUrl();
  let error;
  try {
    const response = await requestMusicbrainz(
      baseUrl,
      endpoint,
      queryParams,
      userAgent,
      forceIpv4,
    );
    const responseData = response.data;

    mbCache.set(cacheKey, responseData);
    return responseData;
  } catch (requestError) {
    error = requestError;
  }

  const connectionError = isConnectionError(error);
  const shouldRetry =
    retryCount < MAX_RETRIES &&
    (connectionError ||
      (error.response &&
        [429, 500, 502, 503, 504].includes(error.response.status)));

  if (shouldRetry) {
    const delay = 300 * Math.pow(2, retryCount);
    const errorType = error.response
      ? `HTTP ${error.response.status}`
      : error.code || error.message;
    const logKey = `${errorType}:retry:${retryCount + 1}`;
    if (shouldEmitThrottledLog(musicbrainzRetryLogAt, logKey, 5000)) {
      logger.warn(
        "api",
        `MusicBrainz error (${errorType}), retrying in ${delay}ms... (attempt ${
          retryCount + 1
        }/${MAX_RETRIES})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    return executeMusicbrainzRequest(
      endpoint,
      params,
      retryCount + 1,
      forceIpv4 || connectionError,
    );
  }

  if (error.response && error.response.status === 404) {
    logger.warn("api", `MusicBrainz 404 Not Found for ${endpoint}`);
    throw error;
  }

  const status = error.response?.status;
  if (status === 502 || status === 503 || status === 504) {
    if (!musicbrainzLast503Log || Date.now() - musicbrainzLast503Log > 15000) {
      musicbrainzLast503Log = Date.now();
      logger.warn("api", `MusicBrainz ${status} (suppressing further logs for 15s)`);
    }
  } else {
    const errorType = status ? `HTTP ${status}` : error.code || error.message;
    const logKey = `${errorType}:final`;
    if (shouldEmitThrottledLog(musicbrainzErrorLogAt, logKey)) {
      logger.error("api", "MusicBrainz API error:", error.message);
    }
  }
  throw error;
};

const musicbrainzRequestWithRetry = async (
  endpoint,
  params = {},
  retryCount = 0,
  forceIpv4 = false,
) => {
  if (retryCount > 0) {
    return executeMusicbrainzRequest(endpoint, params, retryCount, forceIpv4);
  }
  const cacheKey = `mb:${endpoint}:${JSON.stringify(params)}`;
  const cached = mbCache.get(cacheKey);
  if (cached) return cached;
  const inflight = musicbrainzInflightRequests.get(cacheKey);
  if (inflight) return inflight;
  const requestPromise = executeMusicbrainzRequest(endpoint, params, 0, forceIpv4);
  musicbrainzInflightRequests.set(cacheKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    musicbrainzInflightRequests.delete(cacheKey);
  }
};

export const musicbrainzRequest = async (endpoint, params = {}) =>
  legacyMusicbrainzRequest(endpoint, params);

const normalizeItunesArtworkUrl = (url) =>
  String(url || "")
    .trim()
    .replace(/\/100x100([a-z]+)(?=[/?#]|$)/i, "/600x600$1")
    .replace(/\/\d+x\d+([a-z]+)(?=[/?#]|$)/i, "/600x600$1");

export async function fetchCoverArtArchiveReleaseGroup(releaseGroupMbid) {
  if (!releaseGroupMbid) return null;
  try {
    const album = await getMetadataAlbumByMbid(releaseGroupMbid);
    const image = selectBestAlbumImage(album?.images);
    if (image?.url) {
      return {
        imageUrl: image.url,
        types: [image.kind || "Front"],
      };
    }
    return { imageUrl: null, types: [], notFound: true };
  } catch {
    return { imageUrl: null, types: [], transientError: true };
  }
}

const ALLOWED_PRIMARY_TYPES = new Set(["album", "ep", "single"]);

function normalizeArtistReleaseTypeSelection(selectedReleaseTypes = []) {
  const list = Array.isArray(selectedReleaseTypes) ? selectedReleaseTypes : [];
  const normalized = new Set(list.map((value) => String(value || "").trim()));
  const primaryTypes = PRIMARY_RELEASE_TYPES.filter((type) =>
    normalized.has(type),
  );
  const secondaryTypes = SECONDARY_RELEASE_TYPES.filter((type) =>
    normalized.has(type),
  );
  return {
    primaryTypes,
    secondaryTypes,
  };
}

function buildArtistReleaseGroupQuery(mbid, primaryTypes, secondaryTypes) {
  const clauses = [`arid:${mbid}`];

  if (Array.isArray(primaryTypes) && primaryTypes.length > 0) {
    if (primaryTypes.length === 1) {
      clauses.push(`primarytype:${primaryTypes[0].toLowerCase()}`);
    } else {
      clauses.push(
        `(${primaryTypes
          .map((type) => `primarytype:${type.toLowerCase()}`)
          .join(" OR ")})`,
      );
    }
  }

  if (Array.isArray(secondaryTypes) && secondaryTypes.length === 0) {
    clauses.push("-secondarytype:*");
  }

  return clauses.join(" AND ");
}

export async function musicbrainzGetArtistReleaseGroups(
  mbid,
  selectedReleaseTypes = null,
  { includeTrackCounts = true, hydrateLimit = includeTrackCounts ? 30 : 6 } = {},
) {
  const safeHydrateLimit =
    Number.isFinite(Number(hydrateLimit)) && Number(hydrateLimit) > 0
      ? Math.min(100, Math.floor(Number(hydrateLimit)))
      : includeTrackCounts
        ? 30
        : 6;
  const cacheKey = `full:${mbid}:${JSON.stringify(selectedReleaseTypes || [])}:${includeTrackCounts ? "rated" : "dated"}:${safeHydrateLimit}`;
  const cached = musicbrainzReleaseGroupsCache.get(cacheKey);
  if (cached) return cached;
  try {
    const items = await listMetadataArtistAlbums(mbid, {
      releaseTypes: selectedReleaseTypes || [],
      includeTrackCounts,
      hydrateLimit: safeHydrateLimit,
    });
    const mapped = items.map((item) => ({
      id: item.id,
      title: item.title || "",
      "first-release-date": item.firstReleaseDate || null,
      "primary-type": item.type || "Album",
      "secondary-types": Array.isArray(item.secondaryTypes)
        ? item.secondaryTypes
        : [],
      rating: item.rating || null,
      "artist-credit": item.artistName
        ? [
            {
              name: item.artistName,
              artist: item.artistId
                ? { id: item.artistId, name: item.artistName }
                : { name: item.artistName },
            },
          ]
        : [],
    }));
    musicbrainzReleaseGroupsCache.set(cacheKey, mapped);
    return mapped;
  } catch {
    return [];
  }
}

const artistCreditIncludesMbid = (artistCredit, mbid) => {
  const normalizedMbid = String(mbid || "")
    .trim()
    .toLowerCase();
  if (!normalizedMbid || !Array.isArray(artistCredit)) return false;
  return artistCredit.some(
    (credit) =>
      String(credit?.artist?.id || "")
        .trim()
        .toLowerCase() === normalizedMbid,
  );
};

const getReleaseGroupArtistId = (releaseGroup) => {
  const artistCredit = Array.isArray(releaseGroup?.["artist-credit"])
    ? releaseGroup["artist-credit"]
    : [];
  return String(artistCredit[0]?.artist?.id || "").trim() || null;
};

const officialMusicbrainzRecordingSearch = async (
  mbid,
  { limit = 100, offset = 0 } = {},
) => {
  const contact =
    (getMusicBrainzContact() || "").trim() || "https://github.com/aurral";
  const userAgent = `${APP_NAME}/${APP_VERSION} ( ${contact} )`;
  const safeLimit = Math.min(
    100,
    Math.max(1, Number.parseInt(limit, 10) || 100),
  );
  const safeOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
  return mbLimiter.schedule(async () => {
    const response = await axios.get(`${MUSICBRAINZ_API}/recording`, {
      params: {
        fmt: "json",
        query: `arid:${mbid}`,
        inc: "artist-credits+releases",
        limit: safeLimit,
        offset: safeOffset,
      },
      headers: { "User-Agent": userAgent },
      timeout: 8000,
    });
    return response.data;
  });
};

const mapAppearsOnReleaseGroup = (releaseGroup, release, recording, mbid) => {
  const artistCredit = Array.isArray(releaseGroup?.["artist-credit"])
    ? releaseGroup["artist-credit"]
    : Array.isArray(release?.["artist-credit"])
      ? release["artist-credit"]
      : [];
  return {
    id: releaseGroup?.id,
    title: releaseGroup?.title || release?.title || "Untitled release",
    "first-release-date":
      releaseGroup?.["first-release-date"] || release?.date || null,
    "primary-type": releaseGroup?.["primary-type"] || "Album",
    "secondary-types": Array.isArray(releaseGroup?.["secondary-types"])
      ? releaseGroup["secondary-types"]
      : [],
    rating: null,
    "artist-credit": artistCredit,
    _appearsOn: true,
    _appearsOnTrack: recording?.title || null,
    _appearsOnArtistMbid: mbid,
    releases: release?.id
      ? [
          {
            id: release.id,
            status: release.status || null,
            date: release.date || null,
            title: release.title || releaseGroup?.title || "Untitled release",
          },
        ]
      : [],
  };
};

export async function musicbrainzGetArtistAppearsOnReleaseGroups(
  mbid,
  directReleaseGroups = [],
  { limit = 24 } = {},
) {
  if (!mbid) return [];
  const safeLimit = Math.min(
    250,
    Math.max(1, Number.parseInt(limit, 10) || 24),
  );
  const cacheKey = `appears-on:${mbid}:${safeLimit}`;
  const cached = musicbrainzReleaseGroupsCache.get(cacheKey);
  if (cached) return cached;

  const directIds = new Set(
    (Array.isArray(directReleaseGroups) ? directReleaseGroups : [])
      .map((item) => String(item?.id || "").trim())
      .filter(Boolean),
  );

  try {
    const byReleaseGroupId = new Map();
    const pageSize = 100;
    const maxRecordingCount = Math.min(1000, Math.max(pageSize, safeLimit * 4));

    for (let offset = 0; offset < maxRecordingCount; offset += pageSize) {
      const data = await officialMusicbrainzRecordingSearch(mbid, {
        limit: pageSize,
        offset,
      });
      const recordings = Array.isArray(data?.recordings) ? data.recordings : [];

      for (const recording of recordings) {
        if (!artistCreditIncludesMbid(recording?.["artist-credit"], mbid)) {
          continue;
        }
        for (const release of Array.isArray(recording?.releases)
          ? recording.releases
          : []) {
          const releaseGroup = release?.["release-group"];
          const releaseGroupId = String(releaseGroup?.id || "").trim();
          if (!releaseGroupId || directIds.has(releaseGroupId)) continue;
          if (getReleaseGroupArtistId(releaseGroup) === mbid) continue;
          if (!byReleaseGroupId.has(releaseGroupId)) {
            byReleaseGroupId.set(
              releaseGroupId,
              mapAppearsOnReleaseGroup(releaseGroup, release, recording, mbid),
            );
          }
        }
      }

      if (byReleaseGroupId.size >= safeLimit || recordings.length < pageSize) {
        break;
      }
    }

    const mapped = [...byReleaseGroupId.values()]
      .sort((left, right) =>
        String(right["first-release-date"] || "").localeCompare(
          String(left["first-release-date"] || ""),
        ),
      )
      .slice(0, safeLimit);
    musicbrainzReleaseGroupsCache.set(cacheKey, mapped);
    return mapped;
  } catch {
    return [];
  }
}

export async function musicbrainzGetArtistReleaseGroupsPreview(
  mbid,
  limit = 50,
) {
  if (!mbid) return [];
  const parsedLimit = Number.parseInt(limit, 10);
  const safeLimit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(100, parsedLimit)
      : 50;
  const items = await musicbrainzGetArtistReleaseGroups(mbid);
  return items.slice(0, safeLimit);
}

export async function musicbrainzGetArtistNameByMbid(mbid) {
  if (!mbid) return null;
  const cached = musicbrainzArtistNameCache.get(mbid);
  if (cached !== undefined) return cached;
  try {
    const name = await getMetadataArtistNameByMbid(mbid);
    const normalized = name && typeof name === "string" ? name.trim() : null;
    musicbrainzArtistNameCache.set(mbid, normalized);
    return normalized;
  } catch (e) {
    musicbrainzArtistNameCache.set(mbid, null);
    return null;
  }
}

function normalizeArtistNameKey(artistName) {
  return String(artistName || "")
    .trim()
    .toLowerCase();
}

export function musicbrainzGetCachedArtistMbidByName(artistName) {
  const normalized = normalizeArtistNameKey(artistName);
  if (!normalized) return null;
  const cached = dbOps.getMusicbrainzArtistMbidCache(normalized);
  if (!cached?.updatedAt) return null;
  const ageMs = Date.now() - cached.updatedAt;
  const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const NEGATIVE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
  const cacheTtl = cached.mbid ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
  if (ageMs < 0 || ageMs >= cacheTtl) return null;
  return cached.mbid || null;
}

export async function musicbrainzResolveArtistMbidByName(artistName) {
  const rawName = String(artistName || "").trim();
  if (!rawName) return null;
  const normalized = normalizeArtistNameKey(rawName);
  const cached = dbOps.getMusicbrainzArtistMbidCache(normalized);
  const now = Date.now();
  const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const NEGATIVE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
  if (cached?.updatedAt) {
    const ageMs = now - cached.updatedAt;
    const cacheTtl = cached.mbid ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
    if (ageMs >= 0 && ageMs < cacheTtl) {
      return cached.mbid || null;
    }
  }
  try {
    const resolved = await resolveMetadataArtistByName(rawName);
    dbOps.setMusicbrainzArtistMbidCache(normalized, resolved);
    return resolved;
  } catch (e) {
    if (cached) {
      return cached.mbid || null;
    }
    return null;
  }
}

export async function searchMusicbrainzRecordings(query, { limit = 5 } = {}) {
  const trimmed = String(query || "").trim();
  if (!trimmed) return [];
  try {
    const data = await mbLimiter.schedule(() =>
      musicbrainzRequestWithRetry("/recording", {
        query: trimmed,
        limit: Math.min(25, Math.max(1, limit)),
        inc: "artist-credits+releases",
      }),
    );
    return Array.isArray(data?.recordings) ? data.recordings : [];
  } catch {
    return [];
  }
}

export const clearMusicbrainzCache = () => {
  mbCache.flushAll();
  musicbrainzArtistNameCache.flushAll();
  musicbrainzReleaseGroupsCache.flushAll();
};

export { PRIMARY_RELEASE_TYPES, SECONDARY_RELEASE_TYPES };
export { mbCache, musicbrainzArtistNameCache, musicbrainzReleaseGroupsCache };
