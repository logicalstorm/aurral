// SQLite database helper functions
// Provides convenient methods for common database operations

import { db, dbHelpers } from './db-sqlite.js';

export const dbOps = {
  // Artists
  getArtist(mbid) {
    const row = db.prepare('SELECT * FROM artists WHERE mbid = ?').get(mbid);
    if (!row) return null;
    return this.mapArtist(row);
  },

  getArtistById(id) {
    const row = db.prepare('SELECT * FROM artists WHERE id = ?').get(id);
    if (!row) return null;
    return this.mapArtist(row);
  },

  getAllArtists() {
    return db.prepare('SELECT * FROM artists').all().map(row => this.mapArtist(row));
  },

  insertArtist(artist) {
    const stmt = db.prepare(`
      INSERT INTO artists 
      (id, mbid, foreign_artist_id, artist_name, path, added_at, monitored, 
       monitor_option, quality, album_folders, statistics, add_options)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
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
    return artist;
  },

  updateArtist(mbid, updates) {
    const artist = this.getArtist(mbid);
    if (!artist) throw new Error('Artist not found');
    
    const updated = { ...artist, ...updates };
    const stmt = db.prepare(`
      UPDATE artists SET
        foreign_artist_id = ?,
        artist_name = ?,
        path = ?,
        monitored = ?,
        monitor_option = ?,
        quality = ?,
        album_folders = ?,
        statistics = ?,
        add_options = ?
      WHERE mbid = ?
    `);
    stmt.run(
      updated.foreignArtistId || updated.mbid,
      updated.artistName,
      updated.path,
      updated.monitored ? 1 : 0,
      updated.monitorOption || 'none',
      updated.quality || 'standard',
      updated.albumFolders !== false ? 1 : 0,
      dbHelpers.stringifyJSON(updated.statistics),
      dbHelpers.stringifyJSON(updated.addOptions),
      mbid
    );
    return this.getArtist(mbid);
  },

  deleteArtist(mbid) {
    // Foreign keys will cascade delete albums and tracks
    return db.prepare('DELETE FROM artists WHERE mbid = ?').run(mbid);
  },

  mapArtist(row) {
    return {
      id: row.id,
      mbid: row.mbid,
      foreignArtistId: row.foreign_artist_id || row.mbid,
      artistName: row.artist_name,
      path: row.path,
      addedAt: row.added_at,
      monitored: row.monitored === 1,
      monitorOption: row.monitor_option,
      quality: row.quality,
      albumFolders: row.album_folders === 1,
      statistics: dbHelpers.parseJSON(row.statistics) || { albumCount: 0, trackCount: 0, sizeOnDisk: 0 },
      addOptions: dbHelpers.parseJSON(row.add_options) || {},
    };
  },

  // Albums
  getAlbums(artistId) {
    return db.prepare('SELECT * FROM albums WHERE artist_id = ?').all(artistId)
      .map(row => this.mapAlbum(row));
  },

  getAlbumById(id) {
    const row = db.prepare('SELECT * FROM albums WHERE id = ?').get(id);
    if (!row) return null;
    return this.mapAlbum(row);
  },

  insertAlbum(album) {
    const stmt = db.prepare(`
      INSERT INTO albums 
      (id, artist_id, mbid, foreign_album_id, album_name, path, added_at, 
       release_date, monitored, statistics)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
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
    return album;
  },

  updateAlbum(id, updates) {
    const album = this.getAlbumById(id);
    if (!album) throw new Error('Album not found');
    
    const updated = { ...album, ...updates };
    const stmt = db.prepare(`
      UPDATE albums SET
        foreign_album_id = ?,
        album_name = ?,
        path = ?,
        release_date = ?,
        monitored = ?,
        statistics = ?
      WHERE id = ?
    `);
    stmt.run(
      updated.foreignAlbumId || updated.mbid,
      updated.albumName,
      updated.path,
      updated.releaseDate,
      updated.monitored ? 1 : 0,
      dbHelpers.stringifyJSON(updated.statistics),
      id
    );
    return this.getAlbumById(id);
  },

  deleteAlbum(id) {
    // Foreign keys will cascade delete tracks
    return db.prepare('DELETE FROM albums WHERE id = ?').run(id);
  },

  mapAlbum(row) {
    return {
      id: row.id,
      artistId: row.artist_id,
      mbid: row.mbid,
      foreignAlbumId: row.foreign_album_id || row.mbid,
      albumName: row.album_name,
      path: row.path,
      addedAt: row.added_at,
      releaseDate: row.release_date,
      monitored: row.monitored === 1,
      statistics: dbHelpers.parseJSON(row.statistics) || { trackCount: 0, sizeOnDisk: 0, percentOfTracks: 0 },
    };
  },

  // Tracks
  getTracks(albumId) {
    return db.prepare('SELECT * FROM tracks WHERE album_id = ?').all(albumId)
      .map(row => this.mapTrack(row));
  },

  getTrackById(id) {
    const row = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
    if (!row) return null;
    return this.mapTrack(row);
  },

  insertTrack(track) {
    const stmt = db.prepare(`
      INSERT INTO tracks 
      (id, album_id, artist_id, mbid, track_name, track_number, path, 
       has_file, size, quality, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
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
    return track;
  },

  updateTrack(id, updates) {
    const track = this.getTrackById(id);
    if (!track) throw new Error('Track not found');
    
    const updated = { ...track, ...updates };
    const stmt = db.prepare(`
      UPDATE tracks SET
        track_name = ?,
        track_number = ?,
        path = ?,
        has_file = ?,
        size = ?,
        quality = ?
      WHERE id = ?
    `);
    stmt.run(
      updated.trackName,
      updated.trackNumber || 0,
      updated.path,
      updated.hasFile ? 1 : 0,
      updated.size || 0,
      updated.quality,
      id
    );
    return this.getTrackById(id);
  },

  mapTrack(row) {
    return {
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
    };
  },

  // Downloads
  getDownloads(filters = {}) {
    let query = 'SELECT * FROM downloads WHERE 1=1';
    const params = [];
    
    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters.type) {
      query += ' AND type = ?';
      params.push(filters.type);
    }
    
    query += ' ORDER BY requested_at DESC';
    
    return db.prepare(query).all(...params).map(row => this.mapDownload(row));
  },

  getDownloadById(id) {
    const row = db.prepare('SELECT * FROM downloads WHERE id = ?').get(id);
    if (!row) return null;
    return this.mapDownload(row);
  },

  insertDownload(download) {
    const stmt = db.prepare(`
      INSERT INTO downloads 
      (id, type, artist_id, album_id, track_id, artist_mbid, album_mbid,
       artist_name, album_name, track_name, status, requested_at, queued_at,
       started_at, completed_at, failed_at, cancelled_at, retry_count,
       requeue_count, last_error, last_failure_at, progress, 
       last_progress_update, events, destination_path, filename,
       queue_cleaned, queue_cleaned_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
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
    return download;
  },

  updateDownload(id, updates) {
    const download = this.getDownloadById(id);
    if (!download) throw new Error('Download not found');
    
    const updated = { ...download, ...updates };
    const stmt = db.prepare(`
      UPDATE downloads SET
        status = ?,
        queued_at = ?,
        started_at = ?,
        completed_at = ?,
        failed_at = ?,
        cancelled_at = ?,
        retry_count = ?,
        requeue_count = ?,
        last_error = ?,
        last_failure_at = ?,
        progress = ?,
        last_progress_update = ?,
        events = ?,
        destination_path = ?,
        filename = ?,
        queue_cleaned = ?,
        queue_cleaned_at = ?
      WHERE id = ?
    `);
    stmt.run(
      updated.status,
      updated.queuedAt,
      updated.startedAt,
      updated.completedAt,
      updated.failedAt,
      updated.cancelledAt,
      updated.retryCount || 0,
      updated.requeueCount || 0,
      updated.lastError,
      updated.lastFailureAt,
      updated.progress || 0,
      updated.lastProgressUpdate,
      dbHelpers.stringifyJSON(updated.events),
      updated.destinationPath,
      updated.filename,
      updated.queueCleaned ? 1 : 0,
      updated.queueCleanedAt,
      id
    );
    return this.getDownloadById(id);
  },

  deleteDownload(id) {
    return db.prepare('DELETE FROM downloads WHERE id = ?').run(id);
  },

  mapDownload(row) {
    return {
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
    };
  },

  // Settings
  getSettings() {
    const integrations = dbHelpers.parseJSON(
      db.prepare('SELECT value FROM settings WHERE key = ?').get('integrations')?.value
    );
    const quality = db.prepare('SELECT value FROM settings WHERE key = ?').get('quality')?.value;
    const queueCleaner = dbHelpers.parseJSON(
      db.prepare('SELECT value FROM settings WHERE key = ?').get('queueCleaner')?.value
    );
    const rootFolderPath = db.prepare('SELECT value FROM settings WHERE key = ?').get('rootFolderPath')?.value;
    const releaseTypes = dbHelpers.parseJSON(
      db.prepare('SELECT value FROM settings WHERE key = ?').get('releaseTypes')?.value
    );
    
    return {
      integrations: integrations || {},
      quality: quality || 'standard',
      queueCleaner: queueCleaner || {},
      rootFolderPath: rootFolderPath || null,
      releaseTypes: releaseTypes || [],
    };
  },

  updateSettings(settings) {
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    
    if (settings.integrations) {
      stmt.run('integrations', dbHelpers.stringifyJSON(settings.integrations));
    }
    if (settings.quality) {
      stmt.run('quality', settings.quality);
    }
    if (settings.queueCleaner) {
      stmt.run('queueCleaner', dbHelpers.stringifyJSON(settings.queueCleaner));
    }
    if (settings.rootFolderPath !== undefined) {
      stmt.run('rootFolderPath', settings.rootFolderPath);
    }
    if (settings.releaseTypes) {
      stmt.run('releaseTypes', dbHelpers.stringifyJSON(settings.releaseTypes));
    }
  },

  // Album Requests
  getAlbumRequests() {
    return db.prepare('SELECT * FROM album_requests ORDER BY requested_at DESC').all()
      .map(row => ({
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

  insertAlbumRequest(request) {
    const stmt = db.prepare(`
      INSERT INTO album_requests 
      (id, artist_id, artist_mbid, artist_name, album_id, album_mbid, 
       album_name, status, requested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      request.id,
      request.artistId,
      request.artistMbid,
      request.artistName,
      request.albumId,
      request.albumMbid,
      request.albumName,
      request.status,
      request.requestedAt
    );
    return request;
  },

  updateAlbumRequest(albumId, updates) {
    const stmt = db.prepare(`
      UPDATE album_requests SET
        status = ?
      WHERE album_id = ?
    `);
    stmt.run(updates.status, albumId);
  },

  deleteAlbumRequest(albumId) {
    return db.prepare('DELETE FROM album_requests WHERE album_id = ?').run(albumId);
  },

  // Blocklist
  getBlocklist() {
    return db.prepare('SELECT * FROM blocklist').all().map(row => ({
      albumId: row.album_id,
      albumName: row.album_name,
      artistId: row.artist_id,
      artistName: row.artist_name,
      blocklistedAt: row.blocklisted_at,
      reason: row.reason,
      downloadId: row.download_id,
    }));
  },

  insertBlocklist(item) {
    const stmt = db.prepare(`
      INSERT INTO blocklist 
      (album_id, album_name, artist_id, artist_name, blocklisted_at, reason, download_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      item.albumId,
      item.albumName,
      item.artistId,
      item.artistName,
      item.blocklistedAt,
      item.reason,
      item.downloadId
    );
  },

  isBlocklisted(artistName, albumName) {
    const key = `${artistName}:${albumName}`.toLowerCase();
    const items = this.getBlocklist();
    return items.some(b => {
      const existingKey = `${b.artistName || ''}:${b.albumName || ''}`.toLowerCase();
      return existingKey === key;
    });
  },

  removeFromBlocklist(albumId) {
    return db.prepare('DELETE FROM blocklist WHERE album_id = ?').run(albumId);
  },

  // Activity Log
  insertActivityLog(entry) {
    const stmt = db.prepare(`
      INSERT INTO activity_log (timestamp, level, category, message, data)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      entry.timestamp,
      entry.level,
      entry.category,
      entry.message,
      dbHelpers.stringifyJSON(entry.data)
    );
    
    // Keep only last 1000 entries
    db.prepare(`
      DELETE FROM activity_log 
      WHERE id NOT IN (
        SELECT id FROM activity_log 
        ORDER BY timestamp DESC 
        LIMIT 1000
      )
    `).run();
  },

  getActivityLog(limit = 100, category = null, level = null) {
    let query = 'SELECT * FROM activity_log WHERE 1=1';
    const params = [];
    
    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    if (level) {
      query += ' AND level = ?';
      params.push(level);
    }
    
    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);
    
    return db.prepare(query).all(...params).map(row => ({
      timestamp: row.timestamp,
      level: row.level,
      category: row.category,
      message: row.message,
      data: dbHelpers.parseJSON(row.data) || {},
    }));
  },

  // Discovery Cache
  getDiscoveryCache() {
    const recommendations = dbHelpers.parseJSON(
      db.prepare('SELECT value, last_updated FROM discovery_cache WHERE key = ?').get('recommendations')?.value
    );
    const globalTop = dbHelpers.parseJSON(
      db.prepare('SELECT value, last_updated FROM discovery_cache WHERE key = ?').get('globalTop')?.value
    );
    const basedOn = dbHelpers.parseJSON(
      db.prepare('SELECT value, last_updated FROM discovery_cache WHERE key = ?').get('basedOn')?.value
    );
    const topTags = dbHelpers.parseJSON(
      db.prepare('SELECT value, last_updated FROM discovery_cache WHERE key = ?').get('topTags')?.value
    );
    const topGenres = dbHelpers.parseJSON(
      db.prepare('SELECT value, last_updated FROM discovery_cache WHERE key = ?').get('topGenres')?.value
    );
    const lastUpdated = db.prepare('SELECT last_updated FROM discovery_cache ORDER BY last_updated DESC LIMIT 1').get()?.last_updated;
    
    return {
      recommendations: recommendations || [],
      globalTop: globalTop || [],
      basedOn: basedOn || [],
      topTags: topTags || [],
      topGenres: topGenres || [],
      lastUpdated,
    };
  },

  updateDiscoveryCache(discovery) {
    const stmt = db.prepare('INSERT OR REPLACE INTO discovery_cache (key, value, last_updated) VALUES (?, ?, ?)');
    const now = new Date().toISOString();
    
    if (discovery.recommendations) {
      stmt.run('recommendations', dbHelpers.stringifyJSON(discovery.recommendations), now);
    }
    if (discovery.globalTop) {
      stmt.run('globalTop', dbHelpers.stringifyJSON(discovery.globalTop), now);
    }
    if (discovery.basedOn) {
      stmt.run('basedOn', dbHelpers.stringifyJSON(discovery.basedOn), now);
    }
    if (discovery.topTags) {
      stmt.run('topTags', dbHelpers.stringifyJSON(discovery.topTags), now);
    }
    if (discovery.topGenres) {
      stmt.run('topGenres', dbHelpers.stringifyJSON(discovery.topGenres), now);
    }
  },

  // Images Cache
  getImage(mbid) {
    const row = db.prepare('SELECT * FROM images_cache WHERE mbid = ?').get(mbid);
    if (!row) return null;
    return {
      mbid: row.mbid,
      imageUrl: row.image_url,
      cacheAge: row.cache_age,
    };
  },

  setImage(mbid, imageUrl) {
    const stmt = db.prepare('INSERT OR REPLACE INTO images_cache (mbid, image_url, cache_age, created_at) VALUES (?, ?, ?, ?)');
    stmt.run(mbid, imageUrl, Date.now(), new Date().toISOString());
  },

  getAllImages() {
    const rows = db.prepare('SELECT * FROM images_cache').all();
    const images = {};
    for (const row of rows) {
      images[row.mbid] = row.image_url;
    }
    return images;
  },

  deleteImage(mbid) {
    return db.prepare('DELETE FROM images_cache WHERE mbid = ?').run(mbid);
  },

  clearImages() {
    return db.prepare('DELETE FROM images_cache').run();
  },

  // Weekly Flow
  getWeeklyFlowItems() {
    return db.prepare('SELECT * FROM weekly_flow ORDER BY added_at DESC').all().map(row => ({
      id: row.id,
      artistMbid: row.artist_mbid,
      artistName: row.artist_name,
      trackName: row.track_name,
      addedAt: row.added_at,
      downloaded: row.downloaded === 1,
    }));
  },

  insertWeeklyFlowItem(item) {
    const stmt = db.prepare('INSERT OR REPLACE INTO weekly_flow (id, artist_mbid, artist_name, track_name, added_at, downloaded) VALUES (?, ?, ?, ?, ?, ?)');
    stmt.run(
      item.id,
      item.artistMbid,
      item.artistName,
      item.trackName,
      item.addedAt,
      item.downloaded ? 1 : 0
    );
  },

  deleteWeeklyFlowItem(id) {
    return db.prepare('DELETE FROM weekly_flow WHERE id = ?').run(id);
  },

  clearWeeklyFlowItems() {
    return db.prepare('DELETE FROM weekly_flow').run();
  },

  addWeeklyFlowHistory(item) {
    const stmt = db.prepare('INSERT INTO weekly_flow_history (artist_mbid, artist_name, track_name, added_at, removed_at) VALUES (?, ?, ?, ?, ?)');
    stmt.run(
      item.artistMbid,
      item.artistName,
      item.trackName,
      item.addedAt,
      item.removedAt || new Date().toISOString()
    );
  },

  getWeeklyFlowHistory(limit = 200) {
    return db.prepare('SELECT * FROM weekly_flow_history ORDER BY removed_at DESC LIMIT ?').all(limit).map(row => ({
      artistMbid: row.artist_mbid,
      artistName: row.artist_name,
      trackName: row.track_name,
      addedAt: row.added_at,
      removedAt: row.removed_at,
    }));
  },
};
