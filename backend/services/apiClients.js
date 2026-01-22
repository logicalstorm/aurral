import axios from "axios";
import Bottleneck from "bottleneck";
import { db } from "../config/db.js";
import { MUSICBRAINZ_API, LASTFM_API, APP_NAME, APP_VERSION } from "../config/constants.js";

let lidarrBasepathDetected = false;

export const getLidarrConfig = () => {
  const dbConfig = db.data.settings.integrations?.lidarr || {};
  return {
    url: (dbConfig.url || process.env.LIDARR_URL || "http://localhost:8686").replace(/\/+$/, ''),
    apiKey: dbConfig.apiKey || process.env.LIDARR_API_KEY || ""
  };
};

export const probeLidarrUrl = async () => {
  const { url, apiKey } = getLidarrConfig();
  if (!apiKey) return;

  let currentUrl = url;
  const basePaths = ['', '/lidarr'];
  
  for (const basePath of basePaths) {
    const testUrl = basePath ? `${currentUrl}${basePath}` : currentUrl;
    try {
      const response = await axios.get(`${testUrl}/api/v1/system/status`, {
        headers: { 'X-Api-Key': apiKey },
        timeout: 5000,
      });

      if (response.data?.appName === 'Lidarr') {
        if (basePath) {
          console.log(`Lidarr basepath auto-detected: ${basePath}`);
          lidarrBasepathDetected = true;
        }
        return true;
      }
    } catch (error) {
    }
  }

  console.warn('WARNING: Could not connect to Lidarr at configured URL or with /lidarr basepath');
  return false;
};

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

export const lidarrRequest = async (endpoint, method = "GET", data = null, silent = false) => {
  const { url, apiKey } = getLidarrConfig();
  
  if (!apiKey) {
    throw new Error("Lidarr API key not configured");
  }

  let finalUrl = url;
  if (lidarrBasepathDetected && !finalUrl.endsWith('/lidarr')) {
    finalUrl += '/lidarr';
  }

  try {
    const config = {
      method,
      url: `${finalUrl}/api/v1${endpoint}`,
      headers: {
        "X-Api-Key": apiKey,
      },
    };

    if (data) {
      config.data = data;
    }

    const response = await axios(config);

    if (typeof response.data === 'string' && response.data.includes('<!doctype html>')) {
      const error = new Error(
        'Lidarr returned HTML instead of JSON. ' +
        'If Lidarr is behind a basepath, add it to LIDARR_URL (e.g., http://host:8686/lidarr)'
      );
      error.isBasepathError = true;
      throw error;
    }

    return response.data;
  } catch (error) {
    if (!silent) {
      console.error("Lidarr API error:", error.response?.data || error.message);
    }
    throw error;
  }
};

export const getLidarrBasepathDetected = () => lidarrBasepathDetected;
