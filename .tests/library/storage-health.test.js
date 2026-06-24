import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";

import {
  createIsolatedStateDir,
  applyIsolatedBackendEnv,
  cleanupIsolatedState,
  importFromRepo,
  resetDatabase,
} from "../helpers/backendTestHarness.js";

const isolatedState = await createIsolatedStateDir("storage-health");
applyIsolatedBackendEnv(isolatedState);
const previousFileBrowseRoots = process.env.FILE_BROWSE_ROOTS;
const previousPathMappings = process.env.PATH_MAPPINGS;

const [{ db }, { dbOps }, { runStorageHealthCheck }, { resolvePlaylistRoot }] =
  await Promise.all([
    importFromRepo("backend/config/db-sqlite.js"),
    importFromRepo("backend/db/helpers/index.js"),
    importFromRepo("backend/services/storageHealthService.js"),
    importFromRepo("backend/services/playlistPaths.js"),
  ]);

test.beforeEach(async () => {
  await resetDatabase(db);
  const { downloadTracker } = await importFromRepo(
    "backend/services/weeklyFlowDownloadTracker.js",
  );
  downloadTracker.clearAll();
  const downloadFolder = process.env.DOWNLOAD_FOLDER;
  await fs.mkdir(downloadFolder, { recursive: true });
  process.env.FILE_BROWSE_ROOTS = downloadFolder;
  delete process.env.PATH_MAPPINGS;
  dbOps.updateSettings({
    ...dbOps.getSettings(),
    downloadFolderPath: downloadFolder,
  });
});

test.after(async () => {
  if (previousFileBrowseRoots === undefined) {
    delete process.env.FILE_BROWSE_ROOTS;
  } else {
    process.env.FILE_BROWSE_ROOTS = previousFileBrowseRoots;
  }
  if (previousPathMappings === undefined) {
    delete process.env.PATH_MAPPINGS;
  } else {
    process.env.PATH_MAPPINGS = previousPathMappings;
  }
  await cleanupIsolatedState(isolatedState);
});

test("runStorageHealthCheck passes when downloads folder is writable", async () => {
  const result = await runStorageHealthCheck();
  const downloads = result.sections.find((section) => section.id === "downloads");
  assert.ok(downloads);
  assert.equal(downloads.status, "pass");
  assert.equal(result.ok, true);
});

test("runStorageHealthCheck fails when completed playlist files are missing", async () => {
  const { downloadTracker } = await importFromRepo(
    "backend/services/weeklyFlowDownloadTracker.js",
  );
  const playlistRoot = resolvePlaylistRoot();
  const missingPath = path.join(
    playlistRoot,
    "aurral-weekly-flow",
    "health-playlist",
    "Artist",
    "Album",
    "missing-track.flac",
  );
  const jobId = downloadTracker.addJob(
    { artistName: "Artist", trackName: "Song" },
    "health-playlist",
  );
  downloadTracker.setDone(jobId, missingPath, "Album");

  const result = await runStorageHealthCheck();
  const playlists = result.sections.find((section) => section.id === "playlists");
  assert.ok(playlists);
  assert.equal(playlists.status, "fail");
  assert.equal(result.ok, false);
});

test("runStorageHealthCheck passes when completed playlist files exist", async () => {
  const { downloadTracker } = await importFromRepo(
    "backend/services/weeklyFlowDownloadTracker.js",
  );
  const playlistRoot = resolvePlaylistRoot();
  const trackPath = path.join(
    playlistRoot,
    "aurral-weekly-flow",
    "health-playlist-ok",
    "Artist",
    "Album",
    "present-track.flac",
  );
  await fs.mkdir(path.dirname(trackPath), { recursive: true });
  await fs.writeFile(trackPath, "audio");
  const jobId = downloadTracker.addJob(
    { artistName: "Artist", trackName: "Present" },
    "health-playlist-ok",
  );
  downloadTracker.setDone(jobId, trackPath, "Album");

  const result = await runStorageHealthCheck();
  const playlists = result.sections.find((section) => section.id === "playlists");
  assert.ok(playlists);
  assert.equal(playlists.status, "pass");
});

test("runStorageHealthCheck warns when completed playlist files are empty", async () => {
  const { downloadTracker } = await importFromRepo(
    "backend/services/weeklyFlowDownloadTracker.js",
  );
  const playlistRoot = resolvePlaylistRoot();
  const trackPath = path.join(
    playlistRoot,
    "aurral-weekly-flow",
    "health-playlist-empty",
    "Artist",
    "Album",
    "empty-track.flac",
  );
  await fs.mkdir(path.dirname(trackPath), { recursive: true });
  await fs.writeFile(trackPath, "");
  const jobId = downloadTracker.addJob(
    { artistName: "Artist", trackName: "Empty" },
    "health-playlist-empty",
  );
  downloadTracker.setDone(jobId, trackPath, "Album");

  const result = await runStorageHealthCheck();
  const playlists = result.sections.find((section) => section.id === "playlists");
  assert.ok(playlists);
  assert.equal(playlists.status, "warn");
  assert.equal(
    playlists.steps.some(
      (step) => step.id === "tracked-nonempty" && step.status === "warn",
    ),
    true,
  );
});

test("runStorageHealthCheck fails when a path mapping local folder is missing", async () => {
  dbOps.updateSettings({
    ...dbOps.getSettings(),
    pathMappings: [
      {
        source: "lidarr",
        remote: "/mnt/music",
        local: path.join(isolatedState.baseDir, "missing-mapped-music"),
      },
    ],
  });

  const result = await runStorageHealthCheck();
  const mappings = result.sections.find((section) => section.id === "path-mappings");
  assert.ok(mappings);
  assert.equal(mappings.status, "fail");
  assert.equal(result.ok, false);
});

test("runStorageHealthCheck skips optional integrations when unset", async () => {
  const result = await runStorageHealthCheck();
  const slskd = result.sections.find((section) => section.id === "slskd");
  const navidrome = result.sections.find((section) => section.id === "navidrome");
  assert.equal(slskd?.status, "skip");
  assert.equal(navidrome?.status, "skip");
});

test("runStorageHealthCheck passes shared volume when dedicated browse roots exist", async () => {
  const result = await runStorageHealthCheck();
  const volume = result.sections.find((section) => section.id === "volume");
  assert.ok(volume);
  const sharedMount = volume.steps.find((step) => step.id === "shared-mount");
  assert.ok(sharedMount);
  assert.equal(sharedMount.status, "pass");
});
