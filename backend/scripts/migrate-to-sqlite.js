import { readFileSync, existsSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, dbHelpers } from '../config/db-sqlite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JSON_DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

async function migrate() {
  console.log('Starting migration from JSON to SQLite...');
  
  if (!existsSync(JSON_DB_PATH)) {
    console.log('No existing JSON database found. Starting fresh with SQLite.');
    console.log('Migration complete!');
    return;
  }
  
  console.log(`Reading JSON database from ${JSON_DB_PATH}...`);
  const jsonData = JSON.parse(readFileSync(JSON_DB_PATH, 'utf8'));
  
  // Disable foreign keys during migration
  db.pragma('foreign_keys = OFF');
  
  // Start transaction
  const transaction = db.transaction(() => {
    let migrated = 0;
    
    // Migrate artists
    if (jsonData.library?.artists && jsonData.library.artists.length > 0) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO artists 
        (id, mbid, foreign_artist_id, artist_name, path, added_at, monitored, 
         monitor_option, quality, album_folders, statistics, add_options)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      for (const artist of jsonData.library.artists) {
        stmt.run(
          artist.id,
          artist.mbid,
          artist.foreignArtistId || artist.mbid,
          artist.artistName,
          artist.path,
          artist.addedAt,
          artist.monitored ? 1 : 0,
          artist.monitorOption || 'none',
          artist.quality || 'standard',
          artist.albumFolders !== false ? 1 : 0,
          dbHelpers.stringifyJSON(artist.statistics),
          dbHelpers.stringifyJSON(artist.addOptions)
        );
      }
      migrated = jsonData.library.artists.length;
      console.log(`✓ Migrated ${migrated} artists`);
    } else {
      console.log('  No artists to migrate');
    }
    
    // Migrate albums
    if (jsonData.library?.albums && jsonData.library.albums.length > 0) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO albums 
        (id, artist_id, mbid, foreign_album_id, album_name, path, added_at, 
         release_date, monitored, statistics)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      for (const album of jsonData.library.albums) {
        stmt.run(
          album.id,
          album.artistId,
          album.mbid,
          album.foreignAlbumId || album.mbid,
          album.albumName,
          album.path,
          album.addedAt,
          album.releaseDate,
          album.monitored ? 1 : 0,
          dbHelpers.stringifyJSON(album.statistics)
        );
      }
      migrated = jsonData.library.albums.length;
      console.log(`✓ Migrated ${migrated} albums`);
    } else {
      console.log('  No albums to migrate');
    }
    
    // Migrate tracks
    if (jsonData.library?.tracks && jsonData.library.tracks.length > 0) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO tracks 
        (id, album_id, artist_id, mbid, track_name, track_number, path, 
         has_file, size, quality, added_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      for (const track of jsonData.library.tracks) {
        stmt.run(
          track.id,
          track.albumId,
          track.artistId,
          track.mbid,
          track.trackName,
          track.trackNumber || 0,
          track.path,
          track.hasFile ? 1 : 0,
          track.size || 0,
          track.quality,
          track.addedAt
        );
      }
      migrated = jsonData.library.tracks.length;
      console.log(`✓ Migrated ${migrated} tracks`);
    } else {
      console.log('  No tracks to migrate');
    }
    
    // Migrate downloads
    if (jsonData.downloads && jsonData.downloads.length > 0) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO downloads 
        (id, type, artist_id, album_id, track_id, artist_mbid, album_mbid,
         artist_name, album_name, track_name, status, requested_at, queued_at,
         started_at, completed_at, failed_at, cancelled_at, retry_count,
         requeue_count, last_error, last_failure_at, progress, 
         last_progress_update, events, destination_path, filename,
         queue_cleaned, queue_cleaned_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      for (const download of jsonData.downloads) {
        stmt.run(
          download.id,
          download.type,
          download.artistId,
          download.albumId,
          download.trackId,
          download.artistMbid,
          download.albumMbid,
          download.artistName,
          download.albumName,
          download.trackName,
          download.status,
          download.requestedAt,
          download.queuedAt,
          download.startedAt,
          download.completedAt,
          download.failedAt,
          download.cancelledAt,
          download.retryCount || 0,
          download.requeueCount || 0,
          download.lastError,
          download.lastFailureAt,
          download.progress || 0,
          download.lastProgressUpdate,
          dbHelpers.stringifyJSON(download.events),
          download.destinationPath,
          download.filename,
          download.queueCleaned ? 1 : 0,
          download.queueCleanedAt
        );
      }
      migrated = jsonData.downloads.length;
      console.log(`✓ Migrated ${migrated} downloads`);
    } else {
      console.log('  No downloads to migrate');
    }
    
    // Migrate album requests
    if (jsonData.albumRequests && jsonData.albumRequests.length > 0) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO album_requests 
        (id, artist_id, artist_mbid, artist_name, album_id, album_mbid, 
         album_name, status, requested_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      for (const req of jsonData.albumRequests) {
        stmt.run(
          req.id,
          req.artistId,
          req.artistMbid,
          req.artistName,
          req.albumId,
          req.albumMbid,
          req.albumName,
          req.status,
          req.requestedAt
        );
      }
      migrated = jsonData.albumRequests.length;
      console.log(`✓ Migrated ${migrated} album requests`);
    } else {
      console.log('  No album requests to migrate');
    }
    
    // Migrate settings
    if (jsonData.settings) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)
      `);
      
      if (jsonData.settings.integrations) {
        stmt.run('integrations', dbHelpers.stringifyJSON(jsonData.settings.integrations));
      }
      if (jsonData.settings.quality) {
        stmt.run('quality', jsonData.settings.quality);
      }
      if (jsonData.settings.queueCleaner) {
        stmt.run('queueCleaner', dbHelpers.stringifyJSON(jsonData.settings.queueCleaner));
      }
      if (jsonData.settings.rootFolderPath) {
        stmt.run('rootFolderPath', jsonData.settings.rootFolderPath);
      }
      if (jsonData.settings.releaseTypes) {
        stmt.run('releaseTypes', dbHelpers.stringifyJSON(jsonData.settings.releaseTypes));
      }
      console.log('✓ Migrated settings');
    } else {
      console.log('  No settings to migrate');
    }
    
    // Migrate blocklist
    if (jsonData.blocklist && jsonData.blocklist.length > 0) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO blocklist 
        (album_id, album_name, artist_id, artist_name, blocklisted_at, reason, download_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      for (const item of jsonData.blocklist) {
        stmt.run(
          item.albumId,
          item.albumName,
          item.artistId,
          item.artistName,
          item.blocklistedAt,
          item.reason,
          item.downloadId
        );
      }
      migrated = jsonData.blocklist.length;
      console.log(`✓ Migrated ${migrated} blocklist entries`);
    } else {
      console.log('  No blocklist entries to migrate');
    }
    
    // Migrate activity log (keep only last 1000)
    if (jsonData.activityLog && jsonData.activityLog.length > 0) {
      const stmt = db.prepare(`
        INSERT INTO activity_log (timestamp, level, category, message, data)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      const logs = jsonData.activityLog.slice(-1000); // Keep last 1000
      for (const log of logs) {
        stmt.run(
          log.timestamp,
          log.level,
          log.category,
          log.message,
          dbHelpers.stringifyJSON(log.data)
        );
      }
      migrated = logs.length;
      console.log(`✓ Migrated ${migrated} activity log entries (last 1000)`);
    } else {
      console.log('  No activity log entries to migrate');
    }
    
    // Migrate discovery cache
    if (jsonData.discovery) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO discovery_cache (key, value, last_updated)
        VALUES (?, ?, ?)
      `);
      
      if (jsonData.discovery.recommendations) {
        stmt.run('recommendations', dbHelpers.stringifyJSON(jsonData.discovery.recommendations), jsonData.discovery.lastUpdated || new Date().toISOString());
      }
      if (jsonData.discovery.globalTop) {
        stmt.run('globalTop', dbHelpers.stringifyJSON(jsonData.discovery.globalTop), jsonData.discovery.lastUpdated || new Date().toISOString());
      }
      if (jsonData.discovery.basedOn) {
        stmt.run('basedOn', dbHelpers.stringifyJSON(jsonData.discovery.basedOn), jsonData.discovery.lastUpdated || new Date().toISOString());
      }
      if (jsonData.discovery.topTags) {
        stmt.run('topTags', dbHelpers.stringifyJSON(jsonData.discovery.topTags), jsonData.discovery.lastUpdated || new Date().toISOString());
      }
      if (jsonData.discovery.topGenres) {
        stmt.run('topGenres', dbHelpers.stringifyJSON(jsonData.discovery.topGenres), jsonData.discovery.lastUpdated || new Date().toISOString());
      }
      console.log('✓ Migrated discovery cache');
    } else {
      console.log('  No discovery cache to migrate');
    }
    
    // Migrate images cache
    if (jsonData.images && Object.keys(jsonData.images).length > 0) {
      const stmt = db.prepare('INSERT OR REPLACE INTO images_cache (mbid, image_url, cache_age, created_at) VALUES (?, ?, ?, ?)');
      let imageCount = 0;
      for (const [mbid, imageUrl] of Object.entries(jsonData.images)) {
        if (imageUrl && imageUrl !== "NOT_FOUND") {
          const cacheAge = jsonData.imageCacheAge?.[mbid] || Date.now();
          stmt.run(mbid, imageUrl, cacheAge, new Date().toISOString());
          imageCount++;
        }
      }
      console.log(`✓ Migrated ${imageCount} image cache entries`);
    } else {
      console.log('  No images cache to migrate');
    }
    
    // Migrate weekly flow (if exists in flows structure)
    if (jsonData.flows?.weekly?.items && jsonData.flows.weekly.items.length > 0) {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO weekly_flow 
        (id, artist_mbid, artist_name, track_name, added_at, downloaded)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      for (const item of jsonData.flows.weekly.items) {
        stmt.run(
          item.id || `${item.artistMbid}-${item.trackName}`,
          item.artistMbid,
          item.artistName,
          item.trackName,
          item.addedAt || new Date().toISOString(),
          item.downloaded ? 1 : 0
        );
      }
      migrated = jsonData.flows.weekly.items.length;
      console.log(`✓ Migrated ${migrated} weekly flow items`);
    } else {
      console.log('  No weekly flow items to migrate');
    }
  });
  
  transaction();
  
  // Re-enable foreign keys after migration
  db.pragma('foreign_keys = ON');
  
  console.log('\n✅ Migration complete!');
  console.log(`\nDatabase created at: ${path.join(__dirname, '..', 'data', 'aurral.db')}`);
  console.log('\n⚠️  IMPORTANT: Backup your old db.json file before removing it:');
  console.log(`   cp ${JSON_DB_PATH} ${JSON_DB_PATH}.backup`);
  console.log('\nYou can now update your code to use SQLite. The old db.json will be kept as backup.');
}

migrate().catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
