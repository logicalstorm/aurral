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
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const previousSetTimeout = globalThis.setTimeout;
  globalThis.window = env;
  globalThis.location = env.location;
  globalThis.localStorage = env.localStorage;
  globalThis.BroadcastChannel = env.BroadcastChannel;
  globalThis.setTimeout = env.setTimeout || ((fn) => {
    fn();
    return 0;
  });
  try {
    new Function(readFileSync(callbackPath, "utf8"))();
  } finally {
    globalThis.window = previousWindow;
    globalThis.location = previousLocation;
    globalThis.localStorage = previousLocalStorage;
    globalThis.BroadcastChannel = previousBroadcastChannel;
    globalThis.setTimeout = previousSetTimeout;
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

test("spotify oauth callback broadcasts tokens when opener is missing", () => {
  const messages = [];
  runCallback({
    location: { search: "?access_token=a&refresh_token=b&expires_in=3600", hash: "" },
    opener: null,
    close() {},
    localStorage: {
      setItem() {
        throw new Error("denied");
      },
    },
    BroadcastChannel: class {
      postMessage(message) {
        messages.push(message);
      }
      close() {}
    },
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "ready");
  assert.equal(messages[0].payload.access_token, "a");
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
    BroadcastChannel: class {
      postMessage() {}
      close() {}
    },
  });
  assert.equal(storage.has("aurral:spotify-oauth-pending"), true);
});
