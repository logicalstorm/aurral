import axios from "axios";
import Bottleneck from "bottleneck";
import { dbOps } from "../config/db-helpers.js";
import { MUSICBRAINZ_API, LASTFM_API, APP_NAME, APP_VERSION } from "../config/constants.js";

export const getLastfmApiKey = () => {
  const settings = dbOps.getSettings();
  return settings.integrations?.lastfm?.apiKey || process.env.LASTFM_API_KEY;
};

export const getMusicBrainzContact = () => {
  const settings = dbOps.getSettings();
  return settings.integrations?.musicbrainz?.email || process.env.CONTACT_EMAIL || "user@example.com";
};

export const getSpotifyClientId = () => {
  const settings = dbOps.getSettings();
  return settings.integrations?.spotify?.clientId || process.env.SPOTIFY_CLIENT_ID;
};

export const getSpotifyClientSecret = () => {
  const settings = dbOps.getSettings();
  return settings.integrations?.spotify?.clientSecret || process.env.SPOTIFY_CLIENT_SECRET;
};

const mbLimiter = new Bottleneck({
  maxConcurrent: 3,
  minTime: 350,
});

const lastfmLimiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 200,
});

const spotifyLimiter = new Bottleneck({
  maxConcurrent: 10,
  minTime: 100,
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

// Spotify API token cache
let spotifyTokenCache = {
  token: null,
  expiresAt: 0,
};

const getSpotifyAccessToken = async () => {
  const clientId = getSpotifyClientId();
  const clientSecret = getSpotifyClientSecret();

  // If no credentials, return null (will gracefully degrade)
  if (!clientId || !clientSecret) {
    return null;
  }

  // Return cached token if still valid
  if (spotifyTokenCache.token && Date.now() < spotifyTokenCache.expiresAt) {
    return spotifyTokenCache.token;
  }

  try {
    const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await axios.post(
      'https://accounts.spotify.com/api/token',
      'grant_type=client_credentials',
      {
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 5000,
      }
    );

    if (response.data?.access_token) {
      // Cache token with 50 minute expiry (tokens last 1 hour)
      spotifyTokenCache = {
        token: response.data.access_token,
        expiresAt: Date.now() + (response.data.expires_in - 600) * 1000,
      };
      return spotifyTokenCache.token;
    }
    return null;
  } catch (error) {
    console.warn('Spotify token request failed:', error.message);
    return null;
  }
};

export const spotifySearchArtist = spotifyLimiter.wrap(async (artistName) => {
  const token = await getSpotifyAccessToken();
  if (!token) {
    // Don't log - credentials might not be configured (this is expected)
    return null;
  }

  try {
    const response = await axios.get('https://api.spotify.com/v1/search', {
      params: {
        q: artistName,
        type: 'artist',
        limit: 1,
      },
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      timeout: 2000,
    });

    if (response.data?.artists?.items?.[0]) {
      return response.data.artists.items[0];
    }
    return null;
  } catch (error) {
    if (error.response?.status === 401) {
      // Token expired, clear cache and retry once
      spotifyTokenCache = { token: null, expiresAt: 0 };
      const newToken = await getSpotifyAccessToken();
      if (newToken) {
        try {
          const retryResponse = await axios.get('https://api.spotify.com/v1/search', {
            params: {
              q: artistName,
              type: 'artist',
              limit: 1,
            },
            headers: {
              'Authorization': `Bearer ${newToken}`,
            },
            timeout: 2000,
          });
          if (retryResponse.data?.artists?.items?.[0]) {
            return retryResponse.data.artists.items[0];
          }
        } catch (retryError) {
          // Ignore retry errors
        }
      }
    }
    if (error.code !== 'ECONNABORTED' && error.response?.status !== 401) {
      console.warn(`Spotify API error (search):`, error.message);
    }
    return null;
  }
});

export const spotifyGetArtist = spotifyLimiter.wrap(async (spotifyId) => {
  const token = await getSpotifyAccessToken();
  if (!token) return null;

  try {
    const response = await axios.get(`https://api.spotify.com/v1/artists/${spotifyId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      timeout: 2000,
    });
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      // Token expired, clear cache and retry once
      spotifyTokenCache = { token: null, expiresAt: 0 };
      const newToken = await getSpotifyAccessToken();
      if (newToken) {
        try {
          const retryResponse = await axios.get(`https://api.spotify.com/v1/artists/${spotifyId}`, {
            headers: {
              'Authorization': `Bearer ${newToken}`,
            },
            timeout: 2000,
          });
          return retryResponse.data;
        } catch (retryError) {
          // Ignore retry errors
        }
      }
    }
    if (error.code !== 'ECONNABORTED' && error.response?.status !== 401) {
      console.warn(`Spotify API error (getArtist):`, error.message);
    }
    return null;
  }
});
