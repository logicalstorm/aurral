import test from "node:test";
import assert from "node:assert/strict";

import { isPrivateHostname } from "../backend/services/imageProxyService.js";

test("isPrivateHostname blocks bracketed IPv6 loopback from URL hostnames", () => {
  assert.equal(isPrivateHostname(new URL("http://[::1]/x.jpg").hostname), true);
  assert.equal(isPrivateHostname("[::1]"), true);
  assert.equal(isPrivateHostname("example.com"), false);
});
