import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'aurral.db');

// Create database connection
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency and crash recovery
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON'); // Enable foreign key constraints

// Create tables
db.exec(`
  -- Artists table
  CREATE TABLE IF NOT EXISTS artists (
    id TEXT PRIMARY KEY,
    mbid TEXT UNIQUE,
    foreign_artist_id TEXT,
    artist_name TEXT NOT NULL,
    path TEXT,
    added_at TEXT,
    monitored INTEGER DEFAULT 0,
    monitor_option TEXT DEFAULT 'none',
    quality TEXT DEFAULT 'standard',
    album_folders INTEGER DEFAULT 1,
    statistics TEXT, -- JSON: {albumCount, trackCount, sizeOnDisk}
    add_options TEXT -- JSON
  );

  -- Albums table
  CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    artist_id TEXT NOT NULL,
    mbid TEXT,
    foreign_album_id TEXT,
    album_name TEXT NOT NULL,
    path TEXT,
    added_at TEXT,
    release_date TEXT,
    monitored INTEGER DEFAULT 0,
    statistics TEXT, -- JSON: {trackCount, sizeOnDisk, percentOfTracks}
    FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
  );

  -- Tracks table
  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    album_id TEXT NOT NULL,
    artist_id TEXT NOT NULL,
    mbid TEXT,
    track_name TEXT NOT NULL,
    track_number INTEGER DEFAULT 0,
    path TEXT,
    has_file INTEGER DEFAULT 0,
    size INTEGER DEFAULT 0,
    quality TEXT,
    added_at TEXT,
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
    FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
  );

  -- Downloads table
  CREATE TABLE IF NOT EXISTS downloads (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL, -- 'album', 'track', 'weekly-flow'
    artist_id TEXT,
    album_id TEXT,
    track_id TEXT,
    artist_mbid TEXT,
    album_mbid TEXT,
    artist_name TEXT,
    album_name TEXT,
    track_name TEXT,
    status TEXT NOT NULL, -- 'requested', 'queued', 'downloading', 'completed', 'failed', 'cancelled'
    requested_at TEXT,
    queued_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    failed_at TEXT,
    cancelled_at TEXT,
    retry_count INTEGER DEFAULT 0,
    requeue_count INTEGER DEFAULT 0,
    last_error TEXT,
    last_failure_at TEXT,
    progress INTEGER DEFAULT 0,
    last_progress_update TEXT,
    events TEXT, -- JSON array of events
    destination_path TEXT,
    filename TEXT,
    queue_cleaned INTEGER DEFAULT 0,
    queue_cleaned_at TEXT,
    FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE SET NULL
  );

  -- Album Requests table
  CREATE TABLE IF NOT EXISTS album_requests (
    id TEXT PRIMARY KEY,
    artist_id TEXT NOT NULL,
    artist_mbid TEXT,
    artist_name TEXT,
    album_id TEXT NOT NULL,
    album_mbid TEXT,
    album_name TEXT NOT NULL,
    status TEXT NOT NULL, -- 'processing', 'available'
    requested_at TEXT NOT NULL,
    FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE,
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
  );

  -- Settings table (key-value store)
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL -- JSON
  );

  -- Activity Log table
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    level TEXT NOT NULL, -- 'info', 'warn', 'error', 'debug'
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    data TEXT -- JSON
  );

  -- Blocklist table
  CREATE TABLE IF NOT EXISTS blocklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id TEXT,
    album_name TEXT,
    artist_id TEXT,
    artist_name TEXT,
    blocklisted_at TEXT NOT NULL,
    reason TEXT,
    download_id TEXT
  );

  -- Weekly Flow table
  CREATE TABLE IF NOT EXISTS weekly_flow (
    id TEXT PRIMARY KEY,
    artist_mbid TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    track_name TEXT NOT NULL,
    added_at TEXT NOT NULL,
    downloaded INTEGER DEFAULT 0
  );

  -- Weekly Flow History table
  CREATE TABLE IF NOT EXISTS weekly_flow_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artist_mbid TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    track_name TEXT NOT NULL,
    added_at TEXT NOT NULL,
    removed_at TEXT NOT NULL
  );

  -- Discovery cache table
  CREATE TABLE IF NOT EXISTS discovery_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL, -- JSON
    last_updated TEXT NOT NULL
  );

  -- Images cache table
  CREATE TABLE IF NOT EXISTS images_cache (
    mbid TEXT PRIMARY KEY,
    image_url TEXT,
    cache_age INTEGER, -- Timestamp
    created_at TEXT NOT NULL
  );

  -- Create indexes for performance
  CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist_id);
  CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id);
  CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist_id);
  CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
  CREATE INDEX IF NOT EXISTS idx_downloads_artist ON downloads(artist_id);
  CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON activity_log(timestamp);
  CREATE INDEX IF NOT EXISTS idx_activity_log_category ON activity_log(category);
  CREATE INDEX IF NOT EXISTS idx_album_requests_album ON album_requests(album_id);
  CREATE INDEX IF NOT EXISTS idx_album_requests_artist ON album_requests(artist_id);
`);

// Helper functions for JSON handling
export const dbHelpers = {
  // Parse JSON from database
  parseJSON: (text) => {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  },
  
  // Stringify JSON for database
  stringifyJSON: (obj) => {
    if (!obj) return null;
    try {
      return JSON.stringify(obj);
    } catch {
      return null;
    }
  },
};

// Export database instance
export { db };
