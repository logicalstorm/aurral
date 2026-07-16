import test from "node:test";
import assert from "node:assert/strict";

import {
  getActivityPollIntervalMs,
  shouldPollDiscoveryHealth,
  shouldPollSocketFallback,
} from "../../frontend/src/utils/requestScheduling.js";

test("connected sockets suppress provider-backed fallback polling", () => {
  assert.equal(
    shouldPollSocketFallback({
      isConnected: true,
      hasTrackedItems: true,
      documentHidden: false,
    }),
    false,
  );
  assert.equal(
    shouldPollSocketFallback({
      isConnected: false,
      hasTrackedItems: true,
      documentHidden: false,
    }),
    true,
  );
});

test("socket fallback polling stays idle when there is no work or the page is hidden", () => {
  assert.equal(
    shouldPollSocketFallback({
      isConnected: false,
      hasTrackedItems: false,
      documentHidden: false,
    }),
    false,
  );
  assert.equal(
    shouldPollSocketFallback({
      isConnected: false,
      hasTrackedItems: true,
      documentHidden: true,
    }),
    false,
  );
});

test("activity uses a slower reconciliation interval while its sockets are connected", () => {
  assert.equal(
    getActivityPollIntervalMs({ isConnected: false, isListLikeView: true }),
    15_000,
  );
  assert.equal(
    getActivityPollIntervalMs({ isConnected: true, isListLikeView: true }),
    60_000,
  );
  assert.equal(
    getActivityPollIntervalMs({ isConnected: true, isListLikeView: false }),
    300_000,
  );
});

test("discovery health polling is only a disconnected socket fallback", () => {
  assert.equal(shouldPollDiscoveryHealth({ isConnected: true }), false);
  assert.equal(shouldPollDiscoveryHealth({ isConnected: false }), true);
});
