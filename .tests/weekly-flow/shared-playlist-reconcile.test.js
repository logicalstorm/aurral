import test from "node:test";
import assert from "node:assert/strict";

import {
  createIsolatedStateDir,
  applyIsolatedBackendEnv,
  cleanupIsolatedState,
  importFromRepo,
  resetDatabase,
} from "../helpers/backendTestHarness.js";

const isolatedState = await createIsolatedStateDir("shared-playlist-reconcile");
applyIsolatedBackendEnv(isolatedState);

const [{ db }, { dbOps }, { flowPlaylistConfig }, operationsModule] =
  await Promise.all([
    importFromRepo("backend/config/db-sqlite.js"),
    importFromRepo("backend/db/helpers/index.js"),
    importFromRepo("../../backend/services/weeklyFlow/weeklyFlowPlaylistConfig.js"),
    importFromRepo("../../backend/services/weeklyFlow/weeklyFlowOperations.js"),
  ]);

const { reconcileSharedPlaylistJobs } = operationsModule;

test.beforeEach(() => {
  resetDatabase(db);
  dbOps.updateSettings({
    integrations: {},
    onboardingComplete: true,
    flows: [],
    sharedPlaylists: [],
  });
});

test.after(async () => {
  await cleanupIsolatedState(isolatedState);
});

test("reconcileSharedPlaylistJobs removes duplicate jobs and syncs track count", async () => {
  const { downloadTracker } = await importFromRepo(
    "../../backend/services/weeklyFlow/weeklyFlowDownloadTracker.js",
  );
  const playlist = flowPlaylistConfig.createSharedPlaylist({
    name: "Dupes",
    tracks: [
      { artistName: "Refused", trackName: "New Noise", albumName: "Deluxe" },
      { artistName: "Refused", trackName: "New Noise", albumName: "Standard" },
    ],
  });
  const firstJobId = downloadTracker.addJob(
    {
      artistName: "Refused",
      trackName: "New Noise",
      albumName: "Deluxe",
    },
    playlist.id,
  );
  const duplicateJobId = downloadTracker.addJob(
    {
      artistName: "Refused",
      trackName: "New Noise",
      albumName: "Standard",
    },
    playlist.id,
  );
  downloadTracker.setDone(firstJobId, "/tmp/refused-deluxe.flac", "Deluxe");
  downloadTracker.setDone(
    duplicateJobId,
    "/tmp/refused-standard.flac",
    "Standard",
  );

  const result = await reconcileSharedPlaylistJobs(playlist.id);

  assert.equal(result.changed, true);
  assert.equal(result.removedJobIds.length, 1);
  assert.equal(result.keptJobCount, 1);
  assert.equal(downloadTracker.getByPlaylistType(playlist.id).length, 1);
  assert.equal(
    flowPlaylistConfig.getSharedPlaylist(playlist.id).trackCount,
    1,
  );
});
