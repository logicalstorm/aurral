import axios from "axios";
import Bottleneck from "bottleneck";
import NodeCache from "node-cache";
import { dbOps } from "../config/db-helpers.js";
import {
  MUSICBRAINZ_API,
  LASTFM_API,
  APP_NAME,
  APP_VERSION,
} from "../config/constants.js";

const mbCache = new NodeCache({ stdTTL: 300, checkperiod: 60, maxKeys: 500 });
const lastfmCache = new NodeCache({
  stdTTL: 300,
  checkperiod: 60,
  maxKeys: 500,
});
const deezerArtistCache = new NodeCache({
  stdTTL: 3600,
  checkperiod: 120,
  maxKeys: 1000,
});

export const getLastfmApiKey = () => {
  const settings = dbOps.getSettings();
  return settings.integrations?.lastfm?.apiKey || process.env.LASTFM_API_KEY;
};

export const getMusicBrainzContact = () => {
  const settings = dbOps.getSettings();
  return (
    settings.integrations?.musicbrainz?.email ||
    process.env.CONTACT_EMAIL ||
    "user@example.com"
  );
};

const mbLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000,
});

const lastfmLimiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 200,
});

let musicbrainzLast503Log = 0;

const musicbrainzRequestWithRetry = async (
  endpoint,
  params = {},
  retryCount = 0
) => {
  const cacheKey = `mb:${endpoint}:${JSON.stringify(params)}`;
  const cached = mbCache.get(cacheKey);
  if (cached) return cached;

  const MAX_RETRIES = 1;
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
        (err) => error.code === err || error.message.includes(err)
      ) ||
      (error.code &&
        (error.code.startsWith("E") || error.code.startsWith("ERR_")))
    );
  };

  const isServerUnavailable = (error) =>
    error.response && [502, 503, 504].includes(error.response.status);

  const contact =
    (getMusicBrainzContact() || "").trim() || "https://github.com/aurral";
  const userAgent = `${APP_NAME}/${APP_VERSION} ( ${contact} )`;
  try {
    const response = await axios.get(
      `${MUSICBRAINZ_API}${endpoint}?${queryParams}`,
      {
        headers: { "User-Agent": userAgent },
        timeout: 3000,
      }
    );
    mbCache.set(cacheKey, response.data);
    return response.data;
  } catch (error) {
    const shouldRetry =
      retryCount < MAX_RETRIES &&
      !isServerUnavailable(error) &&
      (isConnectionError(error) ||
        (error.response && [429, 500].includes(error.response.status)));

    if (shouldRetry) {
      const delay = 300;
      const errorType = error.response
        ? `HTTP ${error.response.status}`
        : error.code || error.message;
      console.warn(
        `MusicBrainz error (${errorType}), retrying in ${delay}ms... (attempt ${
          retryCount + 1
        }/${MAX_RETRIES})`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return musicbrainzRequestWithRetry(endpoint, params, retryCount + 1);
    }

    if (error.response && error.response.status === 404) {
      console.warn(`MusicBrainz 404 Not Found for ${endpoint}`);
      throw error;
    }

    const status = error.response?.status;
    if (status === 502 || status === 503 || status === 504) {
      if (
        !musicbrainzLast503Log ||
        Date.now() - musicbrainzLast503Log > 15000
      ) {
        musicbrainzLast503Log = Date.now();
        console.warn(
          `MusicBrainz ${status} (suppressing further logs for 15s)`
        );
      }
    } else {
      console.error("MusicBrainz API error:", error.message);
    }
    throw error;
  }
};

export const musicbrainzRequest = mbLimiter.wrap(musicbrainzRequestWithRetry);

export const lastfmRequest = lastfmLimiter.wrap(async (method, params = {}) => {
  const apiKey = getLastfmApiKey();
  if (!apiKey) return null;

  const cacheKey = `lfm:${method}:${JSON.stringify(params)}`;
  const cached = lastfmCache.get(cacheKey);
  if (cached) return cached;

  try {
    const response = await axios.get(LASTFM_API, {
      params: {
        method,
        api_key: apiKey,
        format: "json",
        ...params,
      },
      timeout: 3000,
    });
    lastfmCache.set(cacheKey, response.data);
    return response.data;
  } catch (error) {
    if (error.code !== "ECONNABORTED") {
      console.error(`Last.fm API error (${method}):`, error.message);
    }
    return null;
  }
});

async function getDeezerArtist(artistName) {
  const normalizedName = artistName.toLowerCase().trim();
  const cached = deezerArtistCache.get(normalizedName);
  if (cached !== undefined) return cached;

  try {
    const searchRes = await axios.get("https://api.deezer.com/search/artist", {
      params: { q: artistName, limit: 5 },
      timeout: 3000,
    });
    const artists = searchRes.data?.data;
    if (!artists?.length) {
      deezerArtistCache.set(normalizedName, null);
      return null;
    }

    const searchLower = normalizedName.replace(/^the\s+/i, "");
    let bestMatch = null;

    for (const a of artists) {
      if (!a?.id) continue;
      const aNameLower = (a.name || "").toLowerCase().replace(/^the\s+/i, "");
      if (aNameLower === searchLower || aNameLower === normalizedName) {
        bestMatch = a;
        break;
      }
      if (!bestMatch && aNameLower.includes(searchLower)) {
        bestMatch = a;
      }
    }

    if (!bestMatch) {
      bestMatch = artists[0];
    }

    if (!bestMatch?.id) {
      deezerArtistCache.set(normalizedName, null);
      return null;
    }

    const result = {
      id: bestMatch.id,
      name: bestMatch.name,
      imageUrl:
        bestMatch.picture_big ||
        bestMatch.picture_medium ||
        bestMatch.picture ||
        null,
    };
    deezerArtistCache.set(normalizedName, result);
    return result;
  } catch (e) {
    return null;
  }
}

export async function deezerSearchArtist(artistName) {
  const artist = await getDeezerArtist(artistName);
  if (!artist || !artist.imageUrl) return null;
  return artist;
}

export async function deezerGetArtistTopTracks(artistName) {
  try {
    const artist = await getDeezerArtist(artistName);
    if (!artist) return [];

    const topRes = await axios.get(
      `https://api.deezer.com/artist/${artist.id}/top`,
      { params: { limit: 5 }, timeout: 3000 }
    );
    const tracks = topRes.data?.data || [];
    return tracks
      .filter((t) => t.preview)
      .slice(0, 5)
      .map((t) => ({
        id: String(t.id),
        title: t.title,
        album: t.album?.title ?? null,
        preview_url: t.preview,
        duration_ms: (t.duration || 0) * 1000,
      }));
  } catch (e) {
    return [];
  }
}

export function clearApiCaches() {
  mbCache.flushAll();
  lastfmCache.flushAll();
  deezerArtistCache.flushAll();
}
