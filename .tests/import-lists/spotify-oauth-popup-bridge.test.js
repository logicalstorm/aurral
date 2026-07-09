import test from "node:test";
import assert from "node:assert/strict";

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
