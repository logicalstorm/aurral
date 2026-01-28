// Database configuration - SQLite with LowDB compatibility layer
// This allows gradual migration from LowDB to SQLite

import { db as sqliteDb, dbHelpers } from './db-sqlite.js';
import { dbOps } from './db-helpers.js';
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { defaultData } from "./constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const JSON_DB_PATH = path.join(DATA_DIR, "db.json");
const SQLITE_DB_PATH = path.join(DATA_DIR, "aurral.db");

// Check if SQLite database exists (migration has been run)
const USE_SQLITE = fs.existsSync(SQLITE_DB_PATH);

// Check if JSON database exists and SQLite doesn't (needs migration)
const NEEDS_MIGRATION = fs.existsSync(JSON_DB_PATH) && !USE_SQLITE;

if (NEEDS_MIGRATION) {
  console.warn('⚠️  SQLite database not found but JSON database exists.');
  console.warn('   Run: node backend/scripts/migrate-to-sqlite.js');
  console.warn('   Falling back to LowDB for now.');
}

// Create database interface
let db;

if (USE_SQLITE) {
  // Use SQLite - create compatibility wrapper
  console.log('✓ Using SQLite database');
  
  // Create a compatibility layer that mimics LowDB interface
  db = {
    data: {
      // Lazy-load data from SQLite when accessed
      get library() {
        return {
          artists: sqliteDb.prepare('SELECT * FROM artists').all().map(row => ({
            id: row.id,
            mbid: row.mbid,
            foreignArtistId: row.foreign_artist_id,
            artistName: row.artist_name,
            path: row.path,
            addedAt: row.added_at,
            monitored: row.monitored === 1,
            monitorOption: row.monitor_option,
            quality: row.quality,
            albumFolders: row.album_folders === 1,
            statistics: dbHelpers.parseJSON(row.statistics) || { albumCount: 0, trackCount: 0, sizeOnDisk: 0 },
            addOptions: dbHelpers.parseJSON(row.add_options) || {},
          })),
          albums: sqliteDb.prepare('SELECT * FROM albums').all().map(row => ({
            id: row.id,
            artistId: row.artist_id,
            mbid: row.mbid,
            foreignAlbumId: row.foreign_album_id,
            albumName: row.album_name,
            path: row.path,
            addedAt: row.added_at,
            releaseDate: row.release_date,
            monitored: row.monitored === 1,
            statistics: dbHelpers.parseJSON(row.statistics) || { trackCount: 0, sizeOnDisk: 0, percentOfTracks: 0 },
          })),
          tracks: sqliteDb.prepare('SELECT * FROM tracks').all().map(row => ({
            id: row.id,
            albumId: row.album_id,
            artistId: row.artist_id,
            mbid: row.mbid,
            trackName: row.track_name,
            trackNumber: row.track_number,
            path: row.path,
            hasFile: row.has_file === 1,
            size: row.size,
            quality: row.quality,
            addedAt: row.added_at,
          })),
          rootFolder: null,
          lastScan: null,
        };
      },
      get downloads() {
        return sqliteDb.prepare('SELECT * FROM downloads').all().map(row => ({
          id: row.id,
          type: row.type,
          artistId: row.artist_id,
          albumId: row.album_id,
          trackId: row.track_id,
          artistMbid: row.artist_mbid,
          albumMbid: row.album_mbid,
          artistName: row.artist_name,
          albumName: row.album_name,
          trackName: row.track_name,
          status: row.status,
          requestedAt: row.requested_at,
          queuedAt: row.queued_at,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          failedAt: row.failed_at,
          cancelledAt: row.cancelled_at,
          retryCount: row.retry_count,
          requeueCount: row.requeue_count,
          lastError: row.last_error,
          lastFailureAt: row.last_failure_at,
          progress: row.progress,
          lastProgressUpdate: row.last_progress_update,
          events: dbHelpers.parseJSON(row.events) || [],
          destinationPath: row.destination_path,
          filename: row.filename,
          queueCleaned: row.queue_cleaned === 1,
          queueCleanedAt: row.queue_cleaned_at,
          // New fields for session tracking and file paths
          tempFilePath: row.temp_file_path,
          trackTitle: row.track_title,
          trackPosition: row.track_position,
          slskdDownloadId: row.slskd_download_id,
          username: row.username,
          downloadSessionId: row.download_session_id,
          parentDownloadId: row.parent_download_id,
          isParent: row.is_parent === 1,
          stale: row.stale === 1,
          triedUsernames: dbHelpers.parseJSON(row.tried_usernames) || [],
          slskdFilePath: row.slskd_file_path,
          errorType: row.error_type,
          lastRequeueAttempt: row.last_requeue_attempt,
        }));
      },
      get albumRequests() {
        return sqliteDb.prepare('SELECT * FROM album_requests ORDER BY requested_at DESC').all().map(row => ({
          id: row.id,
          artistId: row.artist_id,
          artistMbid: row.artist_mbid,
          artistName: row.artist_name,
          albumId: row.album_id,
          albumMbid: row.album_mbid,
          albumName: row.album_name,
          status: row.status,
          requestedAt: row.requested_at,
        }));
      },
      get settings() {
        return dbOps.getSettings();
      },
      get blocklist() {
        return dbOps.getBlocklist();
      },
      get activityLog() {
        return dbOps.getActivityLog(1000);
      },
      get discovery() {
        return dbOps.getDiscoveryCache();
      },
      get images() {
        // Return images as object for compatibility
        const allImages = sqliteDb.prepare('SELECT mbid, image_url FROM images_cache').all();
        const imagesObj = {};
        for (const row of allImages) {
          imagesObj[row.mbid] = row.image_url;
        }
        return imagesObj;
      },
    },
    
    // Write function - for now, this is a no-op as we'll migrate services to use SQLite directly
    // Eventually all services should use SQLite directly instead of this compatibility layer
    async write() {
      // No-op - services should use SQLite directly
      console.warn('db.write() called - consider migrating to direct SQLite usage');
    },
    
    // Read function - no-op for SQLite
    async read() {
      // No-op for SQLite
    },
  };
} else {
  // Fall back to LowDB if SQLite not available
  console.log('Using LowDB (JSON) - run migration to switch to SQLite');
  
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const adapter = new JSONFile(JSON_DB_PATH);
  db = new Low(adapter, defaultData);

  try {
    await db.read();
  } catch (error) {
    console.error("Error reading database, using defaults:", error.message);
    db.data = defaultData;
  }

  if (!db.data) {
    db.data = defaultData;
  }

  if (!db.data.settings) {
    db.data.settings = defaultData.settings;
  }

  if (!db.data.settings.integrations) {
    db.data.settings.integrations = {
      navidrome: { url: "", username: "", password: "" },
      lastfm: { username: "" },
      slskd: { url: "", apiKey: "" },
      musicbrainz: { email: "" },
      general: { authUser: "", authPassword: "" }
    };
    try {
      await db.write();
    } catch (error) {
      console.error("Error writing database:", error.message);
    }
  }

  if (db.data.settings.integrations && !db.data.settings.integrations.musicbrainz) {
    db.data.settings.integrations.musicbrainz = { email: "" };
    try {
      await db.write();
    } catch (error) {
      console.error("Error writing database:", error.message);
    }
  }
}

// Export SQLite database for direct use (if using SQLite)
export { sqliteDb as dbSqlite };

export { db };
