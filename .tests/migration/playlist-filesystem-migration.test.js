import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";

import {
  createIsolatedStateDir,
  applyIsolatedBackendEnv,
  cleanupIsolatedState,
  importFromRepo,
} from "../helpers/backendTestHarness.js";

const isolatedState = await createIsolatedStateDir("playlist-filesystem-migration");
applyIsolatedBackendEnv(isolatedState);

const { ensurePlaylistFilesystemLayout } = await importFromRepo(
  "backend/services/playlistFilesystemMigration.js",
);

const root = process.env.WEEKLY_FLOW_FOLDER;

test.beforeEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test.after(async () => {
  await cleanupIsolatedState(isolatedState);
});

test("renames aurral-weekly-flow to aurral-playlists", async () => {
  const legacyDir = path.join(root, "aurral-weekly-flow");
  const trackPath = path.join(legacyDir, "playlist-id", "Artist", "Track.flac");
  await fs.mkdir(path.dirname(trackPath), { recursive: true });
  await fs.writeFile(trackPath, "audio");

  const result = ensurePlaylistFilesystemLayout({ root });

  assert.equal(result.renamed, true);
  await assert.doesNotReject(() =>
    fs.access(path.join(root, "aurral-playlists", "playlist-id", "Artist", "Track.flac")),
  );
  await assert.rejects(() => fs.access(legacyDir));
});

test("merges legacy playlist files when aurral-playlists already exists", async () => {
  const legacyDir = path.join(root, "aurral-weekly-flow");
  const nextDir = path.join(root, "aurral-playlists");
  const legacyTrack = path.join(legacyDir, "legacy-playlist", "Song.flac");
  const existingTrack = path.join(nextDir, "existing-playlist", "Other.flac");
  await fs.mkdir(path.dirname(legacyTrack), { recursive: true });
  await fs.mkdir(path.dirname(existingTrack), { recursive: true });
  await fs.writeFile(legacyTrack, "legacy");
  await fs.writeFile(existingTrack, "existing");

  const result = ensurePlaylistFilesystemLayout({ root });

  assert.ok(result.merged > 0);
  await assert.doesNotReject(() =>
    fs.access(path.join(nextDir, "legacy-playlist", "Song.flac")),
  );
  await assert.rejects(() => fs.access(legacyDir));
});

test("moves playlist sidecars into _playlists", async () => {
  const playlistRoot = path.join(root, "aurral-playlists");
  await fs.mkdir(playlistRoot, { recursive: true });
  await fs.writeFile(path.join(playlistRoot, "[AS] Test.m3u"), "#EXTM3U\n");

  const result = ensurePlaylistFilesystemLayout({ root });

  assert.equal(result.sidecarsMoved, 1);
  await assert.doesNotReject(() =>
    fs.access(path.join(playlistRoot, "_playlists", "[AS] Test.m3u")),
  );
});
