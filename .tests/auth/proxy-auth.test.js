import test from "node:test";
import assert from "node:assert/strict";

import {
  setupIsolatedBackend,
  cleanupIsolatedState,
  resetDatabase,
} from "../helpers/backendTestHarness.js";

const [isolatedState, { db }, { userOps }, authModule] = await setupIsolatedBackend(
  "proxy-auth",
  "backend/config/db-sqlite.js",
  "backend/db/helpers/index.js",
  "backend/middleware/auth.js",
);

const { resolveProxyUser } = authModule;

function proxyRequest(headers = {}, remoteAddress = "127.0.0.1") {
  return {
    headers,
    socket: { remoteAddress },
    connection: { remoteAddress },
    ip: remoteAddress,
    ips: [remoteAddress],
  };
}

function resetProxyEnv() {
  process.env.AUTH_PROXY_ENABLED = "true";
  delete process.env.AUTH_PROXY_HEADER;
  delete process.env.AUTH_PROXY_TRUSTED_IPS;
  delete process.env.AUTH_PROXY_DEFAULT_ROLE;
  delete process.env.AUTH_PROXY_ADMIN_USERS;
  delete process.env.AUTH_PROXY_ROLE_HEADER;
}

test.beforeEach(() => {
  resetDatabase(db);
  resetProxyEnv();
});

test.after(async () => {
  delete process.env.AUTH_PROXY_ENABLED;
  delete process.env.AUTH_PROXY_HEADER;
  delete process.env.AUTH_PROXY_TRUSTED_IPS;
  delete process.env.AUTH_PROXY_DEFAULT_ROLE;
  delete process.env.AUTH_PROXY_ADMIN_USERS;
  delete process.env.AUTH_PROXY_ROLE_HEADER;
  await cleanupIsolatedState(isolatedState);
});

test("proxy auth creates a persistent user for a new proxied identity", () => {
  const resolved = resolveProxyUser(
    proxyRequest({ "x-forwarded-user": "Alice@example.com" }),
  );

  assert.ok(resolved);
  assert.notEqual(resolved.id, -1);
  assert.equal(resolved.username, "alice@example.com");
  assert.equal(resolved.role, "user");
  assert.equal(resolved.permissions.addArtist, true);
  assert.equal(resolved.permissions.accessFlow, false);
  assert.equal(resolved.permissions.accessSettings, false);

  const stored = userOps.getUserByUsername("Alice@example.com");
  assert.equal(stored?.id, resolved.id);
  assert.equal(stored?.username, "alice@example.com");
  assert.ok(stored?.passwordHash);

  const secondResolve = resolveProxyUser(
    proxyRequest({ "x-forwarded-user": "alice@example.com" }),
  );
  assert.equal(secondResolve?.id, resolved.id);
  assert.equal(userOps.getAllUsers().length, 1);
});

test("proxy auth creates configured admin users as admins", () => {
  process.env.AUTH_PROXY_ADMIN_USERS = "sso-admin";

  const resolved = resolveProxyUser(
    proxyRequest({ "x-forwarded-user": "sso-admin" }),
  );

  assert.ok(resolved);
  assert.equal(resolved.role, "admin");
  assert.equal(resolved.permissions.accessSettings, true);
  assert.equal(userOps.getUserByUsername("sso-admin")?.role, "admin");
});

test("proxy auth does not create users from untrusted proxy IPs", () => {
  process.env.AUTH_PROXY_TRUSTED_IPS = "10.0.0.1";

  const resolved = resolveProxyUser(
    proxyRequest({ "x-forwarded-user": "mallory" }, "192.168.1.10"),
  );

  assert.equal(resolved, null);
  assert.equal(userOps.getAllUsers().length, 0);
});
