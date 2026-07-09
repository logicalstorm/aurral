import test from "node:test";
import assert from "node:assert/strict";

test("captureSpotifyOAuthFromLocation stores tokens and requests redirect", async () => {
  const previous = globalThis.window;
  const storage = new Map();
  let replaced = null;
  globalThis.window = {
    location: {
      pathname: "/oauth.html",
      search:
        "?access_token=access&refresh_token=refresh&expires_in=3600",
      hash: "",
      replace: (path) => {
        replaced = path;
      },
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
      removeItem: (key) => {
        storage.delete(key);
      },
    },
    sessionStorage: {
      getItem: (key) => storage.get(`session:${key}`) ?? null,
      setItem: (key, value) => {
        storage.set(`session:${key}`, value);
      },
      removeItem: (key) => {
        storage.delete(`session:${key}`);
      },
    },
  };
  try {
    const { captureSpotifyOAuthFromLocation, SPOTIFY_OAUTH_PENDING_KEY } =
      await import("../../frontend/src/utils/spotifyOAuthHandoff.js");
    const captured = captureSpotifyOAuthFromLocation();
    assert.equal(captured, true);
    assert.equal(replaced, "/playlists");
    const pending = JSON.parse(storage.get(SPOTIFY_OAUTH_PENDING_KEY));
    assert.equal(pending.access_token, "access");
    assert.equal(pending.refresh_token, "refresh");
  } finally {
    globalThis.window = previous;
  }
});

test("consumePendingSpotifyOAuth returns stored tokens once", async () => {
  const previous = globalThis.window;
  const storage = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
      removeItem: (key) => {
        storage.delete(key);
      },
    },
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  };
  try {
    const {
      SPOTIFY_OAUTH_PENDING_KEY,
      consumePendingSpotifyOAuth,
    } = await import("../../frontend/src/utils/spotifyOAuthHandoff.js");
    storage.set(
      SPOTIFY_OAUTH_PENDING_KEY,
      JSON.stringify({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: "3600",
        savedAt: Date.now(),
      }),
    );
    const first = consumePendingSpotifyOAuth();
    const second = consumePendingSpotifyOAuth();
    assert.deepEqual(first, {
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: "3600",
    });
    assert.equal(second, null);
  } finally {
    globalThis.window = previous;
  }
});
