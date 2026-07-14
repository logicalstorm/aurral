import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const createStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
};

test("proxy-auth API 401 navigates the top-level page through the reauth route", async (t) => {
  const originalGlobals = {
    fetch: globalThis.fetch,
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    window: globalThis.window,
  };
  const vite = await createServer({
    root: "frontend",
    server: { middlewareMode: true },
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
  });

  t.after(async () => {
    await vite.close();
    Object.assign(globalThis, originalGlobals);
  });

  globalThis.sessionStorage = createStorage({ "aurral:proxy-auth": "1" });
  globalThis.localStorage = createStorage();
  globalThis.window = {
    location: {
      origin: "https://aurral.example.com",
      pathname: "/discover",
      search: "",
      href: "https://aurral.example.com/discover",
    },
  };
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "Unauthorized", message: "Authentication required" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });

  const { default: api } = await vite.ssrLoadModule("/src/utils/api/core.js");

  await assert.rejects(api.get("/discover"), /status code 401/);
  assert.equal(
    globalThis.window.location.href,
    "/api/auth/reauth?returnTo=%2Fdiscover",
  );
});

test("proxy-auth WebSocket 4401 navigates the top-level page through the reauth route", async (t) => {
  const originalGlobals = {
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    WebSocket: globalThis.WebSocket,
    window: globalThis.window,
  };
  const vite = await createServer({
    root: "frontend",
    server: { middlewareMode: true },
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
  });

  t.after(async () => {
    await vite.close();
    Object.assign(globalThis, originalGlobals);
  });

  globalThis.sessionStorage = createStorage({ "aurral:proxy-auth": "1" });
  globalThis.localStorage = createStorage();
  globalThis.window = {
    location: {
      origin: "https://aurral.example.com",
      pathname: "/discover",
      search: "",
      href: "https://aurral.example.com/discover",
    },
  };
  globalThis.WebSocket = { OPEN: 1, CONNECTING: 0, CLOSING: 2 };

  const { recoverProxyAuthFromWebSocketClose } = await vite.ssrLoadModule(
    "/src/hooks/useWebSocket.js",
  );

  assert.equal(recoverProxyAuthFromWebSocketClose({ code: 1006 }), false);
  assert.equal(
    globalThis.window.location.href,
    "https://aurral.example.com/discover",
  );
  assert.equal(recoverProxyAuthFromWebSocketClose({ code: 4401 }), true);
  assert.equal(
    globalThis.window.location.href,
    "/api/auth/reauth?returnTo=%2Fdiscover",
  );
});
