import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const callbackPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../frontend/public/spotify-oauth-callback.js",
);

test("spotify oauth callback forwards search to opener", () => {
  let captured = null;
  let closed = false;
  const previous = globalThis.window;
  globalThis.window = {
    location: { search: "?access_token=a&refresh_token=b&expires_in=3600" },
    opener: {
      onCompleteOauth(query, onComplete) {
        captured = query;
        onComplete();
      },
    },
    close() {
      closed = true;
    },
  };
  try {
    const code = readFileSync(callbackPath, "utf8");
    new Function(code)();
    assert.equal(captured, "?access_token=a&refresh_token=b&expires_in=3600");
    assert.equal(closed, true);
  } finally {
    globalThis.window = previous;
  }
});
