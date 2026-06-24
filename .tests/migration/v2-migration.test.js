import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import Database from "better-sqlite3";

function createPreMigrationDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aurral-v2-"));
  const dbPath = path.join(tempDir, "aurral.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE weekly_flow_jobs (
      id TEXT PRIMARY KEY,
      artist_name TEXT NOT NULL,
      track_name TEXT NOT NULL,
      playlist_type TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    INSERT INTO settings (key, value) VALUES ('weeklyFlows', '[]');
    INSERT INTO settings (key, value) VALUES ('sharedFlowPlaylists', '[]');
    INSERT INTO settings (key, value) VALUES ('weeklyFlowWorker', '{"concurrency":2,"preferredFormat":"flac","retryCycleMinutes":15,"existingFileMode":"reuse"}');
    INSERT INTO weekly_flow_jobs (id, artist_name, track_name, playlist_type, status, created_at)
    VALUES ('job-1', 'Artist', 'Track', 'discover', 'pending', 1);
  `);
  db.close();
  return { tempDir, dbPath };
}

const dbHelpers = {
  parseJSON: (text) => {
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  },
  stringifyJSON: (obj) => obj === undefined ? null : JSON.stringify(obj),
};

test("v2 migration creates playlist_download_jobs table and stores schema version", async () => {
  const { dbPath } = createPreMigrationDb();
  const { applyV2Migration } = await import("../../backend/config/schema-migration-v2.js");
  const db = new Database(dbPath);

  const result = applyV2Migration(db, dbHelpers);
  assert.equal(result.schemaVersion, 2);

  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('weekly_flow_jobs', 'playlist_download_jobs')",
  ).all().map((row) => row.name);
  assert.ok(tables.includes("playlist_download_jobs"));

  const version = db.prepare("SELECT value FROM settings WHERE key = 'schemaVersion'").get()?.value;
  assert.equal(version, "2");

  db.close();
});

test("v2 migration is idempotent", async () => {
  const { dbPath } = createPreMigrationDb();
  const { applyV2Migration } = await import("../../backend/config/schema-migration-v2.js");
  const db = new Database(dbPath);

  applyV2Migration(db, dbHelpers);
  const secondResult = applyV2Migration(db, dbHelpers);

  assert.equal(secondResult.migrated, false);
  assert.equal(secondResult.schemaVersion, 2);

  db.close();
});

test("v2 migration renames settings keys", async () => {
  const { dbPath } = createPreMigrationDb();
  const { applyV2Migration } = await import("../../backend/config/schema-migration-v2.js");
  const db = new Database(dbPath);

  applyV2Migration(db, dbHelpers);

  const flows = db.prepare("SELECT value FROM settings WHERE key = 'flows'").get()?.value;
  assert.equal(flows, "[]");
  assert.equal(
    db.prepare("SELECT value FROM settings WHERE key = 'weeklyFlows'").get()?.value,
    "[]",
  );

  db.close();
});

test("v2 migration splits weeklyFlowWorker settings into playlistWorker and weeklyFlowWorker", async () => {
  const { dbPath } = createPreMigrationDb();
  const { applyV2Migration } = await import("../../backend/config/schema-migration-v2.js");
  const db = new Database(dbPath);

  applyV2Migration(db, dbHelpers);

  const playlistWorker = JSON.parse(
    db.prepare("SELECT value FROM settings WHERE key = 'playlistWorker'").get()?.value || "{}",
  );
  assert.equal(playlistWorker.concurrency, 2);
  assert.equal(playlistWorker.existingFileMode, "reuse");
  assert.equal(playlistWorker.preferredFormat, undefined);

  const weeklyFlowWorker = JSON.parse(
    db.prepare("SELECT value FROM settings WHERE key = 'weeklyFlowWorker'").get()?.value || "{}",
  );
  assert.equal(weeklyFlowWorker.concurrency, 2);
  assert.equal(weeklyFlowWorker.existingFileMode, "reuse");
  assert.equal(weeklyFlowWorker.preferredFormat, "flac");

  db.close();
});

test("v2 migration copies existing jobs from weekly_flow_jobs to playlist_download_jobs", async () => {
  const { dbPath } = createPreMigrationDb();
  const { applyV2Migration } = await import("../../backend/config/schema-migration-v2.js");
  const db = new Database(dbPath);

  applyV2Migration(db, dbHelpers);

  const copiedJob = db.prepare("SELECT * FROM playlist_download_jobs WHERE id = 'job-1'").get();
  assert.equal(copiedJob.artist_name, "Artist");
  assert.equal(copiedJob.playlist_id, "discover");

  db.close();
});

test("v2 migration backward-compat triggers mirror INSERT, UPDATE, and DELETE to weekly_flow_jobs", async () => {
  const { dbPath } = createPreMigrationDb();
  const { applyV2Migration } = await import("../../backend/config/schema-migration-v2.js");
  const db = new Database(dbPath);

  applyV2Migration(db, dbHelpers);

  db.prepare(`
    INSERT INTO playlist_download_jobs (
      id, artist_name, track_name, playlist_id, playlist_type, status, created_at
    )
    VALUES ('job-2', 'Artist 2', 'Track 2', 'discover', 'discover', 'pending', 2)
  `).run();
  assert.equal(
    db.prepare("SELECT track_name FROM weekly_flow_jobs WHERE id = 'job-2'").get()?.track_name,
    "Track 2",
  );

  db.prepare("UPDATE playlist_download_jobs SET status = 'done', final_path = '/tmp/track.flac' WHERE id = 'job-2'").run();
  const mirroredJob = db.prepare("SELECT status, final_path FROM weekly_flow_jobs WHERE id = 'job-2'").get();
  assert.equal(mirroredJob.status, "done");
  assert.equal(mirroredJob.final_path, "/tmp/track.flac");

  db.prepare("DELETE FROM playlist_download_jobs WHERE id = 'job-2'").run();
  assert.equal(
    db.prepare("SELECT id FROM weekly_flow_jobs WHERE id = 'job-2'").get(),
    undefined,
  );

  db.close();
});
