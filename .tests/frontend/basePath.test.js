import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeBasePath,
  normalizeBasePathWithTrailingSlash,
  stripBasePath,
} from "../../frontend/src/utils/basePath.js";

test("normalizeBasePath returns / for root and empty", () => {
  assert.equal(normalizeBasePath("/"), "/");
  assert.equal(normalizeBasePath(""), "/");
});

test("normalizeBasePath strips trailing slash and adds leading slash", () => {
  assert.equal(normalizeBasePath("/app/"), "/app");
  assert.equal(normalizeBasePath("app"), "/app");
});

test("normalizeBasePathWithTrailingSlash", () => {
  assert.equal(normalizeBasePathWithTrailingSlash("/"), "/");
  assert.equal(normalizeBasePathWithTrailingSlash("/app"), "/app/");
});

test("stripBasePath", () => {
  assert.equal(stripBasePath("/some/page", "/"), "/some/page");
  assert.equal(stripBasePath("/app/page", "/app"), "/page");
  assert.equal(stripBasePath("/app", "/app"), "/");
  assert.equal(stripBasePath("/other/page", "/app"), "/other/page");
});
