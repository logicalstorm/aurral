import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "..", "data");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, "aurral.db");

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS discovery_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    last_updated TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS images_cache (
    mbid TEXT PRIMARY KEY,
    image_url TEXT,
    cache_age INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS weekly_flow_jobs (
    id TEXT PRIMARY KEY,
    artist_name TEXT NOT NULL,
    track_name TEXT NOT NULL,
    playlist_type TEXT NOT NULL,
    status TEXT NOT NULL,
    staging_path TEXT,
    final_path TEXT,
    error TEXT,
    started_at INTEGER,
    completed_at INTEGER,
    created_at INTEGER NOT NULL
  );
`);

export const dbHelpers = {
  parseJSON: (text) => {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  },

  stringifyJSON: (obj) => {
    if (!obj) return null;
    try {
      return JSON.stringify(obj);
    } catch {
      return null;
    }
  },
};

export { db };
