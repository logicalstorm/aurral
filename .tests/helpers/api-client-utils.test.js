import assert from "node:assert/strict";
import test from "node:test";
import createCache from "../../backend/services/apiClients/simpleCache.js";
import createRateLimiter from "../../backend/services/apiClients/rateLimiter.js";

test("rate limiter spaces concurrent request starts", async () => {
  const limiter = createRateLimiter(30);
  const starts = [];
  await Promise.all(
    [1, 2, 3].map(() =>
      limiter.schedule(() => {
        starts.push(Date.now());
      }),
    ),
  );
  assert.ok(starts[1] - starts[0] >= 20);
  assert.ok(starts[2] - starts[1] >= 20);
});

test("TTL cache evicts its oldest entry at the size limit", () => {
  const cache = createCache(300, 2);
  cache.set("first", 1);
  cache.set("second", 2);
  cache.set("third", 3);
  assert.equal(cache.get("first"), undefined);
  assert.equal(cache.get("second"), 2);
  assert.equal(cache.get("third"), 3);
});
