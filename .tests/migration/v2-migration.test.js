import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import Database from "better-sqlite3";

test("applyV2Migration renames weekly_flow_jobs and sets schema version", async () => {
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

  const { applyV2Migration } = await import(
    "../../backend/config/schema-migration-v2.js"
  );
  const migratedDb = new Database(dbPath);
  const dbHelpers = {
    parseJSON: (text) => {
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
    stringifyJSON: (obj) => {
      if (obj === undefined) return null;
      return JSON.stringify(obj);
    },
  };
  const result = applyV2Migration(migratedDb, dbHelpers);
  assert.equal(result.schemaVersion, 2);

  const tables = migratedDb
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('weekly_flow_jobs', 'playlist_download_jobs')",
    )
    .all()
    .map((row) => row.name);
  assert.ok(tables.includes("playlist_download_jobs"));
  assert.ok(!tables.includes("weekly_flow_jobs"));

  const version = migratedDb
    .prepare("SELECT value FROM settings WHERE key = 'schemaVersion'")
    .get()?.value;
  assert.equal(version, "2");

  const flows = migratedDb
    .prepare("SELECT value FROM settings WHERE key = 'flows'")
    .get()?.value;
  assert.equal(flows, "[]");
  assert.equal(
    migratedDb.prepare("SELECT value FROM settings WHERE key = 'weeklyFlows'").get(),
    undefined,
  );

  const playlistWorker = JSON.parse(
    migratedDb
      .prepare("SELECT value FROM settings WHERE key = 'playlistWorker'")
      .get()?.value || "{}",
  );
  assert.equal(playlistWorker.concurrency, 2);
  assert.equal(playlistWorker.existingFileMode, "reuse");
  assert.equal(playlistWorker.preferredFormat, undefined);

  migratedDb.close();
});
