import test from "node:test";
import assert from "node:assert/strict";

import {
  createIsolatedStateDir,
  applyIsolatedBackendEnv,
  cleanupIsolatedState,
  importFromRepo,
  resetDatabase,
} from "../helpers/backendTestHarness.js";

const isolatedState = await createIsolatedStateDir("playlist-mbid-enrichment");
applyIsolatedBackendEnv(isolatedState);

const [
  { db },
  { dbOps },
  { flowPlaylistConfig },
  { downloadTracker },
  { enrichSharedPlaylistMbids },
] = await Promise.all([
  importFromRepo("backend/config/db-sqlite.js"),
  importFromRepo("backend/db/helpers/index.js"),
  importFromRepo("backend/services/weeklyFlow/weeklyFlowPlaylistConfig.js"),
  importFromRepo("backend/services/weeklyFlow/weeklyFlowDownloadTracker.js"),
  importFromRepo("backend/services/playlistMbidEnrichmentService.js"),
]);

test.beforeEach(() => {
  downloadTracker.clearAll();
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

test("enrichSharedPlaylistMbids fills missing playlist and job MBIDs", async () => {
  const playlist = flowPlaylistConfig.createSharedPlaylist({
    name: "Imported",
    tracks: [
      {
        artistName: "Refused",
        trackName: "New Noise",
      },
    ],
  });
  const jobId = downloadTracker.addJob(
    {
      artistName: "Refused",
      trackName: "New Noise",
    },
    playlist.id,
  );

  const result = await enrichSharedPlaylistMbids(playlist.id, {
    resolveTrackContext: (track) => ({
      ...track,
      albumName: "The Shape of Punk to Come",
      artistMbid: "artist-refused",
      albumMbid: "album-shape",
      trackMbid: "track-new-noise",
      releaseYear: "1998",
      durationMs: 308000,
      artistAliases: ["Refused SE"],
      trackNumber: 1,
      albumTrackCount: 12,
      albumTrackTitles: ["Worms of the Senses", "New Noise"],
    }),
  });

  const storedTrack =
    flowPlaylistConfig.getSharedPlaylist(playlist.id)?.tracks?.[0];
  const storedJob = downloadTracker.getJob(jobId);

  assert.equal(result.changed, true);
  assert.equal(result.playlistTracksUpdated, 1);
  assert.equal(result.jobsUpdated, 1);
  assert.equal(storedTrack.artistMbid, "artist-refused");
  assert.equal(storedTrack.albumMbid, "album-shape");
  assert.equal(storedTrack.trackMbid, "track-new-noise");
  assert.equal(storedTrack.albumName, "The Shape of Punk to Come");
  assert.equal(storedJob.artistMbid, "artist-refused");
  assert.equal(storedJob.albumMbid, "album-shape");
  assert.equal(storedJob.trackMbid, "track-new-noise");
  assert.equal(storedJob.trackNumber, 1);
  assert.equal(storedJob.albumTrackCount, 12);
});
