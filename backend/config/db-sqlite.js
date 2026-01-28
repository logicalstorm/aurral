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

  -- Dead Letter Queue table for permanently failed downloads
  CREATE TABLE IF NOT EXISTS dead_letter_queue (
    id TEXT PRIMARY KEY,
    original_download_id TEXT NOT NULL,
    type TEXT NOT NULL,
    artist_id TEXT,
    album_id TEXT,
    track_id TEXT,
    artist_name TEXT,
    album_name TEXT,
    track_name TEXT,
    error_type TEXT,
    last_error TEXT,
    retry_count INTEGER DEFAULT 0,
    requeue_count INTEGER DEFAULT 0,
    failed_at TEXT NOT NULL,
    moved_to_dlq_at TEXT NOT NULL,
    events TEXT,
    can_retry INTEGER DEFAULT 1,
    retry_after TEXT
  );

  -- Blocked Sources table for tracking bad peers
  CREATE TABLE IF NOT EXISTS blocked_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    blocked_at TEXT NOT NULL,
    reason TEXT,
    failure_count INTEGER DEFAULT 1,
    last_failure_at TEXT NOT NULL,
    unblock_after TEXT,
    permanent INTEGER DEFAULT 0,
    UNIQUE(username)
  );

  -- Download Attempts table for tracking each download attempt
  CREATE TABLE IF NOT EXISTS download_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    download_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    username TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_ms INTEGER,
    status TEXT NOT NULL,
    error_type TEXT,
    error_message TEXT,
    bytes_transferred INTEGER DEFAULT 0,
    transfer_speed_bps INTEGER,
    file_path TEXT,
    FOREIGN KEY (download_id) REFERENCES downloads(id) ON DELETE CASCADE
  );

  -- Download Metrics table for success/failure rates
  CREATE TABLE IF NOT EXISTS download_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at TEXT NOT NULL,
    metric_type TEXT NOT NULL,
    metric_value REAL NOT NULL,
    metadata TEXT
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
  CREATE INDEX IF NOT EXISTS idx_dead_letter_queue_type ON dead_letter_queue(type);
  CREATE INDEX IF NOT EXISTS idx_dead_letter_queue_failed_at ON dead_letter_queue(failed_at);
  CREATE INDEX IF NOT EXISTS idx_blocked_sources_username ON blocked_sources(username);
  CREATE INDEX IF NOT EXISTS idx_download_attempts_download ON download_attempts(download_id);
  CREATE INDEX IF NOT EXISTS idx_download_metrics_type ON download_metrics(metric_type);
  CREATE INDEX IF NOT EXISTS idx_download_metrics_recorded ON download_metrics(recorded_at);
`);

// Add missing columns to downloads table if they don't exist (migration)
try {
  // Get existing columns
  const existingColumns = db.pragma('table_info(downloads)').map(col => col.name);
  
  // Add missing columns for session tracking and file paths
  const missingColumns = [
    { name: 'temp_file_path', type: 'TEXT' },
    { name: 'track_title', type: 'TEXT' },
    { name: 'track_position', type: 'INTEGER' },
    { name: 'slskd_download_id', type: 'TEXT' },
    { name: 'username', type: 'TEXT' },
    { name: 'download_session_id', type: 'TEXT' },
    { name: 'parent_download_id', type: 'TEXT' },
    { name: 'is_parent', type: 'INTEGER DEFAULT 0' },
    { name: 'stale', type: 'INTEGER DEFAULT 0' },
    { name: 'tried_usernames', type: 'TEXT' }, // JSON array
    { name: 'slskd_file_path', type: 'TEXT' },
    { name: 'error_type', type: 'TEXT' },
    { name: 'last_requeue_attempt', type: 'TEXT' },
  ];
  
  for (const col of missingColumns) {
    if (!existingColumns.includes(col.name)) {
      try {
        db.prepare(`ALTER TABLE downloads ADD COLUMN ${col.name} ${col.type}`).run();
        console.log(`✓ Added column ${col.name} to downloads table`);
      } catch (err) {
        console.warn(`Could not add column ${col.name}:`, err.message);
      }
    }
  }
} catch (err) {
  console.warn('Database migration warning:', err.message);
}

try {
  const tableInfo = db.pragma('table_info(dead_letter_queue)');
  if (tableInfo.length > 0) {
    const fkList = db.pragma('foreign_key_list(dead_letter_queue)');
    if (fkList.length > 0) {
      console.log('Migrating dead_letter_queue to remove foreign key constraint...');
      db.exec(`
        ALTER TABLE dead_letter_queue RENAME TO dead_letter_queue_old;
        CREATE TABLE dead_letter_queue (
          id TEXT PRIMARY KEY,
          original_download_id TEXT NOT NULL,
          type TEXT NOT NULL,
          artist_id TEXT,
          album_id TEXT,
          track_id TEXT,
          artist_name TEXT,
          album_name TEXT,
          track_name TEXT,
          error_type TEXT,
          last_error TEXT,
          retry_count INTEGER DEFAULT 0,
          requeue_count INTEGER DEFAULT 0,
          failed_at TEXT NOT NULL,
          moved_to_dlq_at TEXT NOT NULL,
          events TEXT,
          can_retry INTEGER DEFAULT 1,
          retry_after TEXT
        );
        INSERT INTO dead_letter_queue SELECT * FROM dead_letter_queue_old;
        DROP TABLE dead_letter_queue_old;
      `);
      console.log('✓ Migrated dead_letter_queue table');
    }
  }
} catch (err) {
  console.warn('DLQ migration warning:', err.message);
}

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
