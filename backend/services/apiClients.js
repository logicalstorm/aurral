import axios from "axios";
import Bottleneck from "bottleneck";
import { db } from "../config/db.js";
import { MUSICBRAINZ_API, LASTFM_API, APP_NAME, APP_VERSION } from "../config/constants.js";

export const getLastfmApiKey = () => {
  return db.data.settings.integrations?.lastfm?.apiKey || process.env.LASTFM_API_KEY;
};

export const getMusicBrainzContact = () => {
  return db.data.settings.integrations?.musicbrainz?.email || process.env.CONTACT_EMAIL || "user@example.com";
};

const mbLimiter = new Bottleneck({
  maxConcurrent: 3,
  minTime: 350,
});

const lastfmLimiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 200,
});

const musicbrainzRequestWithRetry = async (endpoint, params = {}, retryCount = 0) => {
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
    ];
    return (
      connectionErrors.some((err) => error.code === err || error.message.includes(err)) ||
      (error.code && error.code.startsWith("E"))
    );
  };

  try {
    const response = await axios.get(
      `${MUSICBRAINZ_API}${endpoint}?${queryParams}`,
      {
        headers: {
          "User-Agent": `${APP_NAME}/${APP_VERSION} ( ${getMusicBrainzContact()} )`,
        },
        timeout: 20000,
      },
    );
    return response.data;
  } catch (error) {
    if (isConnectionError(error) && retryCount < MAX_RETRIES) {
      const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
      console.warn(
        `MusicBrainz connection error (${error.code || error.message}), retrying in ${delay}ms... (attempt ${retryCount + 1}/${MAX_RETRIES})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return musicbrainzRequestWithRetry(endpoint, params, retryCount + 1);
    }

    if (error.response && error.response.status === 503) {
      console.warn(
        "MusicBrainz 503 Service Unavailable (Rate Limit), retrying...",
      );
      throw error;
    }

    console.error("MusicBrainz API error:", error.message);
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
    if (error.code !== 'ECONNABORTED') {
      console.error(`Last.fm API error (${method}):`, error.message);
    }
    return null;
  }
});
