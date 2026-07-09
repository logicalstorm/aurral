import {
  SPOTIFY_API_BASE,
  SPOTIFY_RENEW_URI,
} from "./spotifyConfig.js";
import { spotifyConnectionStore } from "./spotifyConnectionStore.js";

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

async function renewAccessToken(refreshToken) {
  const url = new URL(SPOTIFY_RENEW_URI);
  url.searchParams.set("refresh_token", refreshToken);
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `Spotify token refresh failed (${response.status})`);
  }
  const payload = await response.json();
  const accessToken = String(payload?.access_token || payload?.accessToken || "").trim();
  const nextRefreshToken = String(
    payload?.refresh_token || payload?.refreshToken || refreshToken,
  ).trim();
  const expiresIn = Number(payload?.expires_in ?? payload?.expiresIn ?? 3600);
  if (!accessToken) {
    throw new Error("Spotify token refresh returned no access token");
  }
  return {
    accessToken,
    refreshToken: nextRefreshToken,
    expiresAt: Date.now() + Math.max(expiresIn, 60) * 1000,
  };
}

async function getValidConnection(userId) {
  let connection = spotifyConnectionStore.getConnection(userId);
  if (!connection) {
    const error = new Error("Spotify is not connected");
    error.statusCode = 401;
    throw error;
  }
  if (connection.expiresAt - TOKEN_REFRESH_BUFFER_MS > Date.now()) {
    return connection;
  }
  const renewed = await renewAccessToken(connection.refreshToken);
  connection = spotifyConnectionStore.updateTokens(userId, renewed);
  return connection;
}

async function spotifyRequest(userId, path, { searchParams, url: absoluteUrl } = {}) {
  const connection = await getValidConnection(userId);
  const url = absoluteUrl ? new URL(absoluteUrl) : new URL(`${SPOTIFY_API_BASE}${path}`);
  if (!absoluteUrl && searchParams && typeof searchParams === "object") {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value == null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  let response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      Accept: "application/json",
    },
  });
  if (response.status === 401) {
    const renewed = await renewAccessToken(connection.refreshToken);
    const nextConnection = spotifyConnectionStore.updateTokens(userId, renewed);
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${nextConnection.accessToken}`,
        Accept: "application/json",
      },
    });
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(body || `Spotify request failed (${response.status})`);
    error.statusCode = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

async function fetchAllPages(userId, path, { searchParams, itemsKey = "items" } = {}) {
  const items = [];
  let nextUrl = null;
  while (true) {
    const payload = nextUrl
      ? await spotifyRequest(userId, null, { url: nextUrl })
      : await spotifyRequest(userId, path, { searchParams });
    const pageItems = Array.isArray(payload?.[itemsKey]) ? payload[itemsKey] : [];
    items.push(...pageItems);
    nextUrl = payload?.next || null;
    if (!nextUrl) break;
  }
  return items;
}

export const spotifyClient = {
  getProfile(userId) {
    return spotifyRequest(userId, "/me");
  },

  async listPlaylists(userId) {
    const profile = await this.getProfile(userId);
    const playlists = await fetchAllPages(userId, `/users/${encodeURIComponent(profile.id)}/playlists`, {
      searchParams: { limit: 50 },
    });
    return {
      user: profile.display_name || profile.id,
      playlists: playlists
        .map((playlist) => ({
          id: String(playlist?.id || "").trim(),
          name: String(playlist?.name || "").trim(),
          trackCount: Number(playlist?.tracks?.total || 0),
        }))
        .filter((playlist) => playlist.id && playlist.name)
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  },

  listPlaylistTracks(userId, playlistId) {
    return fetchAllPages(
      userId,
      `/playlists/${encodeURIComponent(playlistId)}/tracks`,
      {
        searchParams: {
          limit: 100,
          fields:
            "items(track(name,artists(name),album(name))),next",
        },
      },
    );
  },
};
