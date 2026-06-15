import test from "node:test";
import assert from "node:assert/strict";

import {
  createIsolatedStateDir,
  applyIsolatedBackendEnv,
  cleanupIsolatedState,
  importFromRepo,
  resetDatabase,
} from "../helpers/backendTestHarness.js";

const isolatedState = await createIsolatedStateDir("slskd-transfer-history");
applyIsolatedBackendEnv(isolatedState);

const [
  {
    buildSlskdRankingHistoryOptions,
    getSlskdCleanupTargets,
    recordSlskdTransferOutcome,
  },
  { db },
] = await Promise.all([
  importFromRepo("backend/services/slskdTransferHistory.js"),
  importFromRepo("backend/config/db-sqlite.js"),
]);

test.beforeEach(() => {
  resetDatabase(db);
});

test.after(async () => {
  await cleanupIsolatedState(isolatedState);
});

function recordOutcome(username, status, overrides = {}) {
  recordSlskdTransferOutcome({
    job: {
      id: `${username}-${status}`,
      artistName: "Artist",
      trackName: "Track",
      albumName: "Album",
    },
    candidate: {
      raw: {
        user: username,
        file: "Artist/Album/01 - Track.flac",
      },
    },
    transferId: overrides.transferId || null,
    status,
  });
}

test("buildSlskdRankingHistoryOptions penalizes repeated failed peers", () => {
  for (let index = 0; index < 5; index += 1) {
    recordOutcome("fragilePeer", "transfer_failed");
  }

  const options = buildSlskdRankingHistoryOptions();

  assert.equal(options.isUserBlacklisted("fragilePeer"), true);
  assert.ok(options.getUserQueuePenalty("fragilePeer") > 0);
});

test("buildSlskdRankingHistoryOptions keeps successful peers eligible", () => {
  for (let index = 0; index < 5; index += 1) {
    recordOutcome("recoveredPeer", "transfer_failed");
  }
  recordOutcome("recoveredPeer", "success");

  const options = buildSlskdRankingHistoryOptions();

  assert.equal(options.isUserBlacklisted("recoveredPeer"), false);
  assert.ok(options.getUserQueuePenalty("recoveredPeer") > 0);
});

test("getSlskdCleanupTargets only removes files for failed transfer outcomes", () => {
  recordOutcome("successPeer", "success", { transferId: "success-transfer" });
  recordOutcome("failedPeer", "transfer_failed", {
    transferId: "failed-transfer",
  });

  const targets = getSlskdCleanupTargets();

  assert.deepEqual(
    targets.transfers
      .map((entry) => ({
        username: entry.username,
        transferId: entry.transferId,
        removeFiles: entry.removeFiles,
      }))
      .sort((left, right) => left.username.localeCompare(right.username)),
    [
      {
        username: "failedPeer",
        transferId: "failed-transfer",
        removeFiles: true,
      },
      {
        username: "successPeer",
        transferId: "success-transfer",
        removeFiles: false,
      },
    ],
  );
});
