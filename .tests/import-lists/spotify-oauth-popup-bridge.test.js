import test from "node:test";
import assert from "node:assert/strict";

test("readSpotifyOAuthCallback reads tokens from oauth.html query", async () => {
  const previous = globalThis.window;
  globalThis.window = {
    location: {
      pathname: "/oauth.html",
      search:
        "?access_token=access&refresh_token=refresh&expires_in=3600",
      hash: "",
    },
  };
  try {
    const { readSpotifyOAuthCallback } = await import(
      "../../frontend/src/utils/spotifyOAuthPopupBridge.js"
    );
    const callback = readSpotifyOAuthCallback();
    assert.equal(callback?.access_token, "access");
    assert.equal(callback?.refresh_token, "refresh");
    assert.equal(callback?.expires_in, "3600");
    assert.equal(callback?.query.startsWith("?"), true);
  } finally {
    globalThis.window = previous;
  }
});
