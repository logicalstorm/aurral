import test from "node:test";
import assert from "node:assert/strict";

import {
  createIsolatedStateDir,
  applyIsolatedBackendEnv,
  cleanupIsolatedState,
  importFromRepo,
  resetDatabase,
} from "../helpers/backendTestHarness.js";

const isolatedState = await createIsolatedStateDir("aurral-history");
applyIsolatedBackendEnv(isolatedState);

const [{ db }, historyModule] = await Promise.all([
  importFromRepo("backend/config/db-sqlite.js"),
  importFromRepo("backend/services/aurralHistoryService.js"),
]);

const { upsertAurralHistory, getAurralHistoryRequests } = historyModule;

test.beforeEach(() => {
  resetDatabase(db);
});

test.after(async () => {
  await cleanupIsolatedState(isolatedState);
});

test("upsertAurralHistory keeps timestamp for unchanged records", async () => {
  const baseTime = Date.now();
  upsertAurralHistory({
    referenceId: "job-1",
    kind: "track_download",
    title: "Searching slskd for Song",
    subtitle: "Artist · Playlist",
    status: "processing",
    statusLabel: "Searching",
    metadata: { jobId: "job-1", trackName: "Song", artistName: "Artist" },
    createdAt: baseTime - 4000,
  });

  upsertAurralHistory({
    referenceId: "job-1",
    kind: "track_download",
    title: "Searching slskd for Song",
    subtitle: "Artist · Playlist",
    status: "processing",
    statusLabel: "Searching",
    metadata: { jobId: "job-1", trackName: "Song", artistName: "Artist" },
    createdAt: baseTime,
  });

  const [entry] = await getAurralHistoryRequests();
  assert.equal(new Date(entry.requestedAt).getTime(), baseTime - 4000);
});

test("upsertAurralHistory moves changed records to the top", async () => {
  const baseTime = Date.now();
  upsertAurralHistory({
    referenceId: "job-1",
    kind: "track_download",
    title: "Searching slskd for Older Song",
    subtitle: "Artist · Playlist",
    status: "processing",
    statusLabel: "Searching",
    metadata: { jobId: "job-1", trackName: "Older Song", artistName: "Artist" },
    createdAt: baseTime - 4000,
  });
  upsertAurralHistory({
    referenceId: "job-2",
    kind: "track_download",
    title: "Searching slskd for Newer Song",
    subtitle: "Artist · Playlist",
    status: "processing",
    statusLabel: "Searching",
    metadata: { jobId: "job-2", trackName: "Newer Song", artistName: "Artist" },
    createdAt: baseTime - 2000,
  });

  upsertAurralHistory({
    referenceId: "job-1",
    kind: "track_download",
    title: "Failed to download Older Song",
    subtitle: "No suitable slskd search results",
    status: "failed",
    statusLabel: "Failed",
    metadata: { jobId: "job-1", trackName: "Older Song", artistName: "Artist" },
    createdAt: baseTime,
  });

  const entries = await getAurralHistoryRequests();
  assert.equal(entries[0]?.jobId, "job-1");
  assert.equal(entries[0]?.status, "failed");
  assert.equal(new Date(entries[0]?.requestedAt).getTime(), baseTime);
});

test("track download history separates NZBGet from slskd", async () => {
  upsertAurralHistory({
    referenceId: "job-slskd",
    kind: "track_download",
    title: "Searching slskd for Soulseek Song",
    subtitle: "Artist · Playlist",
    status: "processing",
    statusLabel: "Searching",
    metadata: {
      jobId: "job-slskd",
      trackName: "Soulseek Song",
      artistName: "Artist",
      downloadSource: "slskd",
    },
  });
  upsertAurralHistory({
    referenceId: "job-usenet",
    kind: "track_download",
    title: "Searching NZBGet for Usenet Song",
    subtitle: "Artist · Playlist",
    status: "processing",
    statusLabel: "Searching",
    metadata: {
      jobId: "job-usenet",
      trackName: "Usenet Song",
      artistName: "Artist",
      downloadSource: "usenet",
    },
  });

  const entries = await getAurralHistoryRequests();
  const slskdEntry = entries.find((entry) => entry.jobId === "job-slskd");
  const usenetEntry = entries.find((entry) => entry.jobId === "job-usenet");

  assert.equal(slskdEntry?.source, "slskd");
  assert.equal(usenetEntry?.source, "nzbget");
});
