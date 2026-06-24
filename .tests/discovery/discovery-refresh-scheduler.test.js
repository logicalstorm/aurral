import test from "node:test";
import assert from "node:assert/strict";
import {
  createIsolatedStateDir,
  applyIsolatedBackendEnv,
  cleanupIsolatedState,
  importFromRepo,
} from "../helpers/backendTestHarness.js";

const isolatedState = await createIsolatedStateDir("discovery-refresh-scheduler");
applyIsolatedBackendEnv(isolatedState);

const honkerDbModule = await importFromRepo("backend/services/honkerDb.js");
const {
  discoveryNeedsRefresh,
  enqueueDiscoveryRefresh,
  markDiscoveryRefreshDequeued,
  scheduleNextDiscoveryRefresh,
} = await importFromRepo("backend/services/discovery/refreshScheduler.js");
const { getDiscoveryCache } = await importFromRepo("backend/services/discovery/index.js");

let heldGlobalRefreshLock = null;

function holdGlobalRefreshLock() {
  heldGlobalRefreshLock = honkerDbModule.getHonkerDb().tryLock(
    "discovery-global-refresh",
    "discovery-refresh-scheduler-test",
    3600,
  );
  assert.ok(heldGlobalRefreshLock);
}

function releaseHeldGlobalRefreshLock() {
  if (!heldGlobalRefreshLock) return;
  try {
    heldGlobalRefreshLock.release();
  } catch {}
  heldGlobalRefreshLock = null;
}

function clearDiscoveryRefreshJobs() {
  const tx = honkerDbModule.getHonkerDb().transaction();
  try {
    tx.execute("DELETE FROM _honker_live WHERE queue = ?", [
      "discovery-refresh",
    ]);
    tx.execute("DELETE FROM _honker_dead WHERE queue = ?", [
      "discovery-refresh",
    ]);
    tx.commit();
  } catch (error) {
    try {
      tx.rollback();
    } catch {}
    throw error;
  }
}

function countDiscoveryRefreshJobs() {
  return Number(
    honkerDbModule.getHonkerDb().query(
      "SELECT COUNT(*) AS count FROM _honker_live WHERE queue = ?",
      ["discovery-refresh"],
    )[0]?.count || 0,
  );
}

test.beforeEach(() => {
  markDiscoveryRefreshDequeued();
  getDiscoveryCache().isUpdating = false;
  releaseHeldGlobalRefreshLock();
});

test.after(async () => {
  releaseHeldGlobalRefreshLock();
  markDiscoveryRefreshDequeued();
  await cleanupIsolatedState(isolatedState);
});

test("discoveryNeedsRefresh returns true when cache is empty", () => {
  assert.equal(
    discoveryNeedsRefresh({
      recommendations: [],
      topGenres: [],
      lastUpdated: null,
    }),
    true,
  );
});

test("discoveryNeedsRefresh returns false for fresh populated cache", () => {
  assert.equal(
    discoveryNeedsRefresh({
      recommendations: [{ id: "rec-1" }],
      topGenres: ["rock"],
      lastUpdated: new Date().toISOString(),
    }),
    false,
  );
});

test("enqueueDiscoveryRefresh deduplicates active refresh requests", () => {
  holdGlobalRefreshLock();
  const result = enqueueDiscoveryRefresh({ reason: "manual" });
  assert.equal(result.enqueued, false);
  assert.equal(result.reason, "updating");
});

test("enqueueDiscoveryRefresh returns a plain result object", () => {
  const cache = getDiscoveryCache();
  cache.isUpdating = false;
  const result = enqueueDiscoveryRefresh({ reason: "manual", force: true });
  assert.equal(typeof result?.enqueued, "boolean");
  assert.equal(result?.then, undefined);
});

test("enqueueDiscoveryRefresh treats force as success when already updating", () => {
  holdGlobalRefreshLock();
  const result = enqueueDiscoveryRefresh({ reason: "manual", force: true });
  assert.equal(result.enqueued, true);
  assert.equal(result.reason, "already_updating");
});

test("enqueueDiscoveryRefresh deduplicates when refresh queue lock is held", () => {
  const first = enqueueDiscoveryRefresh({ reason: "manual" });
  assert.equal(first.enqueued, true);

  const second = enqueueDiscoveryRefresh({ reason: "manual" });
  assert.equal(second.enqueued, false);
  assert.equal(second.reason, "queued");
});

test("enqueueDiscoveryRefresh does not treat cache.isUpdating alone as in-progress", () => {
  const cache = getDiscoveryCache();
  cache.isUpdating = true;

  const result = enqueueDiscoveryRefresh({ reason: "manual" });
  assert.equal(result.enqueued, true);
  assert.equal(result.reason, "manual");
});

test("enqueueDiscoveryRefresh queues immediate refresh", () => {
  const cache = getDiscoveryCache();
  markDiscoveryRefreshDequeued();
  cache.isUpdating = false;
  const result = enqueueDiscoveryRefresh({ reason: "manual" });
  assert.equal(result.enqueued, true);
  assert.equal(cache.isUpdating, true);
});

test("scheduleNextDiscoveryRefresh enqueues future job without marking updating", () => {
  const cache = getDiscoveryCache();
  cache.isUpdating = false;
  cache.lastUpdated = new Date().toISOString();
  const result = scheduleNextDiscoveryRefresh();
  assert.equal(result.enqueued, true);
  assert.equal(cache.isUpdating, false);
});

test("scheduleNextDiscoveryRefresh deduplicates existing future refresh", () => {
  clearDiscoveryRefreshJobs();
  const cache = getDiscoveryCache();
  cache.isUpdating = false;
  cache.lastUpdated = new Date().toISOString();

  const first = scheduleNextDiscoveryRefresh();
  const second = scheduleNextDiscoveryRefresh();

  assert.equal(first.enqueued, true);
  assert.equal(second.enqueued, false);
  assert.equal(second.reason, "already_scheduled");
  assert.equal(countDiscoveryRefreshJobs(), 1);
});

test("pruneDuplicateScheduledDiscoveryRefreshes collapses stacked future refreshes", async () => {
  clearDiscoveryRefreshJobs();
  const { pruneDuplicateScheduledDiscoveryRefreshes } = await importFromRepo(
    "backend/services/discovery/refreshScheduler.js",
  );
  const queue = honkerDbModule.getDiscoveryRefreshQueue();
  const runAt = Math.floor(Date.now() / 1000) + 3600;
  for (let index = 0; index < 3; index += 1) {
    queue.enqueue(
      {
        reason: "scheduled",
        requestedAt: Date.now() + index,
        scheduleOnly: true,
      },
      { runAt: runAt + index * 120 },
    );
  }
  assert.equal(countDiscoveryRefreshJobs(), 3);
  assert.equal(pruneDuplicateScheduledDiscoveryRefreshes(), 2);
  assert.equal(countDiscoveryRefreshJobs(), 1);
});
