const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const PLAYLIST_FIELDS =
  "name,tracks.total,public,owner(display_name),external_urls.spotify";
const PLAYLIST_ITEMS_FIELDS =
  "items(is_local,track(name,type,artists(name),album(name))),next";

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
    },
  });
}

function parsePlaylistId(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const decoded = decodeURIComponent(raw);
  const directIdMatch = decoded.match(/^[A-Za-z0-9]{22}$/);
  if (directIdMatch) {
    return decoded;
  }

  const uriMatch = decoded.match(/^spotify:playlist:([A-Za-z0-9]{22})$/i);
  if (uriMatch) {
    return uriMatch[1];
  }

  const urlMatch = decoded.match(
    /spotify\.com\/playlist\/([A-Za-z0-9]{22})(?:\?|$|\/)/i,
  );
  if (urlMatch) {
    return urlMatch[1];
  }

  return null;
}

async function getAccessToken(env) {
  const clientId = String(env.SPOTIFY_CLIENT_ID || "").trim();
  const clientSecret = String(env.SPOTIFY_CLIENT_SECRET || "").trim();

  if (!clientId || !clientSecret) {
    throw Object.assign(
      new Error(
        "Spotify API credentials are missing. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in Cloudflare Pages.",
      ),
      { status: 500 },
    );
  }

  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt) {
    return cachedAccessToken;
  }

  const authHeader = btoa(`${clientId}:${clientSecret}`);
  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${authHeader}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const details = await response.text();
    throw Object.assign(
      new Error(`Spotify token request failed (${response.status}): ${details}`),
      { status: 502 },
    );
  }

  const payload = await response.json();
  const expiresInSeconds = Number(payload.expires_in || 3600);

  cachedAccessToken = payload.access_token;
  cachedAccessTokenExpiresAt =
    Date.now() + Math.max(0, expiresInSeconds - 60) * 1000;

  return cachedAccessToken;
}

async function spotifyFetch(path, accessToken) {
  const response = await fetch(`${SPOTIFY_API_BASE}${path}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.ok) {
    return response.json();
  }

  const details = await response.text();
  let message = "Spotify request failed.";

  if (response.status === 404) {
    message =
      "Playlist not found. Make sure the playlist ID is correct and the playlist is public.";
  } else if (response.status === 401) {
    message = "Spotify authorization failed. Check your configured credentials.";
  } else if (response.status === 403) {
    message =
      "Spotify denied access to that playlist. Private or collaborative playlists still need a user-authorized export flow.";
  }

  throw Object.assign(new Error(`${message} (${response.status}) ${details}`), {
    status: response.status >= 500 ? 502 : response.status,
  });
}

function toTrackEntry(item) {
  const track = item?.track;
  if (!track || track.type !== "track") {
    return null;
  }

  const trackName = String(track.name || "").trim();
  const artistName = Array.isArray(track.artists)
    ? track.artists
        .map((artist) => String(artist?.name || "").trim())
        .filter(Boolean)
        .join(", ")
    : "";
  const albumName = String(track.album?.name || "").trim();

  if (!trackName || !artistName) {
    return null;
  }

  return {
    artistName,
    albumName,
    trackName,
  };
}

async function getPlaylistPayload(playlistId, env) {
  const accessToken = await getAccessToken(env);
  const metadata = await spotifyFetch(
    `/playlists/${playlistId}?fields=${encodeURIComponent(PLAYLIST_FIELDS)}`,
    accessToken,
  );

  let nextPath = `/playlists/${playlistId}/tracks?limit=100&fields=${encodeURIComponent(PLAYLIST_ITEMS_FIELDS)}`;
  const tracks = [];
  let skippedCount = 0;

  while (nextPath) {
    const page = await spotifyFetch(nextPath, accessToken);
    for (const item of page.items || []) {
      const entry = toTrackEntry(item);
      if (entry) {
        tracks.push(entry);
      } else {
        skippedCount += 1;
      }
    }

    if (!page.next) {
      nextPath = null;
      continue;
    }

    const nextUrl = new URL(page.next);
    nextPath = `${nextUrl.pathname}${nextUrl.search}`;
  }

  if (!tracks.length) {
    throw Object.assign(
      new Error(
        "Spotify returned the playlist, but none of its items could be converted into track entries.",
      ),
      { status: 422 },
    );
  }

  return {
    playlist: {
      name: String(metadata.name || "Spotify Playlist").trim() || "Spotify Playlist",
      tracks,
    },
    meta: {
      playlistId,
      trackCount: tracks.length,
      skippedCount,
      public: metadata.public ?? null,
      owner: metadata.owner?.display_name || null,
      spotifyUrl: metadata.external_urls?.spotify || null,
      totalItems: Number(metadata.tracks?.total || tracks.length),
    },
  };
}

export async function onRequestPost(context) {
  try {
    const contentType = context.request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return jsonResponse(
        { error: "Expected application/json request body." },
        415,
      );
    }

    const body = await context.request.json();
    const playlistId = parsePlaylistId(body?.playlistInput || body?.playlistId);

    if (!playlistId) {
      return jsonResponse(
        {
          error:
            "Enter a valid Spotify playlist ID, playlist URL, or spotify:playlist URI.",
        },
        400,
      );
    }

    const payload = await getPlaylistPayload(playlistId, context.env);
    return jsonResponse(payload);
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to fetch that Spotify playlist right now.",
      },
      Number(error?.status) || 500,
    );
  }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const playlistId = parsePlaylistId(
    url.searchParams.get("id") || url.searchParams.get("playlist"),
  );

  if (!playlistId) {
    return jsonResponse(
      {
        error:
          "Pass ?id=<spotify playlist id> or use POST with { playlistInput }.",
      },
      400,
    );
  }

  try {
    const payload = await getPlaylistPayload(playlistId, context.env);
    return jsonResponse(payload);
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to fetch that Spotify playlist right now.",
      },
      Number(error?.status) || 500,
    );
  }
}
