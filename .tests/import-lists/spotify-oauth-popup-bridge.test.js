import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const callbackPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../frontend/public/spotify-oauth-callback.js",
);

function runCallback(env) {
  const previousWindow = globalThis.window;
  const previousLocation = globalThis.location;
  const previousLocalStorage = globalThis.localStorage;
  globalThis.window = env;
  globalThis.location = env.location;
  globalThis.localStorage = env.localStorage;
  try {
    new Function(readFileSync(callbackPath, "utf8"))();
  } finally {
    globalThis.window = previousWindow;
    globalThis.location = previousLocation;
    globalThis.localStorage = previousLocalStorage;
  }
}

test("spotify oauth callback forwards search to opener", () => {
  let captured = null;
  let closed = false;
  runCallback({
    location: { search: "?access_token=a&refresh_token=b&expires_in=3600", hash: "" },
    opener: {
      onCompleteOauth(query, onComplete) {
        captured = query;
        onComplete();
      },
    },
    close() {
      closed = true;
    },
    localStorage: {
      setItem() {},
    },
  });
  assert.equal(captured, "?access_token=a&refresh_token=b&expires_in=3600");
  assert.equal(closed, true);
});

test("spotify oauth callback stores tokens when opener is missing", () => {
  const storage = new Map();
  runCallback({
    location: { search: "?access_token=a&refresh_token=b&expires_in=3600", hash: "" },
    opener: null,
    close() {},
    localStorage: {
      setItem(key, value) {
        storage.set(key, value);
      },
    },
  });
  assert.equal(storage.has("aurral:spotify-oauth-pending"), true);
  const parsed = JSON.parse(storage.get("aurral:spotify-oauth-pending"));
  assert.equal(parsed.access_token, "a");
  assert.equal(parsed.refresh_token, "b");
});
