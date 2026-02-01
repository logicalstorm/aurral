import axios from "axios";
import Bottleneck from "bottleneck";
import { dbOps } from "../config/db-helpers.js";
import {
  MUSICBRAINZ_API,
  LASTFM_API,
  APP_NAME,
  APP_VERSION,
} from "../config/constants.js";

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
  retryCount = 0,
) => {
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
        (err) => error.code === err || error.message.includes(err),
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
      },
    );
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
        `MusicBrainz error (${errorType}), retrying in ${delay}ms... (attempt ${retryCount + 1}/${MAX_RETRIES})`,
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
          `MusicBrainz ${status} (suppressing further logs for 15s)`,
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
    return response.data;
  } catch (error) {
    if (error.code !== "ECONNABORTED") {
      console.error(`Last.fm API error (${method}):`, error.message);
    }
    return null;
  }
});

export async function deezerSearchArtist(artistName) {
  try {
    const searchRes = await axios.get(
      "https://api.deezer.com/search/artist",
      {
        params: { q: artistName, limit: 1 },
        timeout: 3000,
      },
    );
    const artists = searchRes.data?.data;
    if (!artists?.length || !artists[0]?.id) return null;
    const a = artists[0];
    const imageUrl = a.picture_big || a.picture_medium || a.picture || null;
    return imageUrl ? { id: a.id, name: a.name, imageUrl } : null;
  } catch (e) {
    return null;
  }
}

export async function deezerGetArtistTopTracks(artistName) {
  try {
    const searchRes = await axios.get(
      "https://api.deezer.com/search/artist",
      {
        params: { q: artistName, limit: 1 },
        timeout: 3000,
      },
    );
    const artists = searchRes.data?.data;
    if (!artists?.length || !artists[0]?.id) return [];
    const artist = artists[0];
    const topRes = await axios.get(
      `https://api.deezer.com/artist/${artist.id}/top`,
      { params: { limit: 5 }, timeout: 3000 },
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
