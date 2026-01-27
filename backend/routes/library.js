import express from 'express';
import fs from 'fs/promises';
import { UUID_REGEX } from '../config/constants.js';
import { libraryManager } from '../services/libraryManager.js';
import { downloadManager } from '../services/downloadManager.js';
import { qualityManager } from '../services/qualityManager.js';
import { musicbrainzRequest } from '../services/apiClients.js';
import { dbOps } from '../config/db-helpers.js';
import { queueCleaner } from '../services/queueCleaner.js';
import { libraryMonitor } from '../services/libraryMonitor.js';

const router = express.Router();

// Get all artists
router.get('/artists', async (req, res) => {
  try {
    const artists = libraryManager.getAllArtists();
    // Format for frontend compatibility
    const formatted = artists.map(artist => ({
      ...artist,
      foreignArtistId: artist.foreignArtistId || artist.mbid,
      added: artist.addedAt,
    }));
    // Don't cache - library changes frequently
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.json(formatted);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch artists',
      message: error.message,
    });
  }
});

// Get artist by MBID
router.get('/artists/:mbid', async (req, res) => {
  try {
    const { mbid } = req.params;
    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: 'Invalid MBID format' });
    }

    const artist = libraryManager.getArtist(mbid);
    if (!artist) {
      return res.status(404).json({ error: 'Artist not found' });
    }

    // Format for frontend compatibility
    const formatted = {
      ...artist,
      foreignArtistId: artist.foreignArtistId || artist.mbid,
      added: artist.addedAt,
    };
    res.json(formatted);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch artist',
      message: error.message,
    });
  }
});

// Add artist
router.post('/artists', async (req, res) => {
  try {
    const {
      foreignArtistId: mbid,
      artistName,
      quality,
    } = req.body;

    if (!mbid || !artistName) {
      return res.status(400).json({
        error: 'foreignArtistId and artistName are required',
      });
    }

    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: 'Invalid MBID format' });
    }

    const settings = dbOps.getSettings();
    const artist = await libraryManager.addArtist(mbid, artistName, {
      quality: quality || settings.quality || 'standard',
    });

    // Legacy requests are no longer stored separately - album requests are used instead
    // This code is kept for backward compatibility but doesn't do anything

    res.status(201).json(artist);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to add artist',
      message: error.message,
    });
  }
});

// Update artist
router.put('/artists/:mbid', async (req, res) => {
  try {
    const { mbid } = req.params;
    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: 'Invalid MBID format' });
    }

    const artist = await libraryManager.updateArtist(mbid, req.body);
    res.json(artist);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to update artist',
      message: error.message,
    });
  }
});

// Delete artist
// Clean up requests when artist is deleted
router.delete('/artists/:mbid', async (req, res) => {
  try {
    const { mbid } = req.params;
    const { deleteFiles = false } = req.query;

    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: 'Invalid MBID format' });
    }

    await libraryManager.deleteArtist(mbid, deleteFiles === 'true');
    
    // Also remove request for this artist
    // Legacy requests are no longer stored - album requests are used instead
    // This code is kept for backward compatibility but doesn't do anything
    
    res.json({ success: true, message: 'Artist deleted successfully' });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to delete artist',
      message: error.message,
    });
  }
});

// Get albums for artist
router.get('/albums', async (req, res) => {
  try {
    const { artistId } = req.query;
    if (!artistId) {
      return res.status(400).json({ error: 'artistId parameter is required' });
    }

    const albums = libraryManager.getAlbums(artistId);
    // Format for frontend compatibility
    const formatted = albums.map(album => ({
      ...album,
      foreignAlbumId: album.foreignAlbumId || album.mbid,
      title: album.albumName,
      albumType: 'Album', // Could be enhanced to get from MusicBrainz
      statistics: album.statistics || {
        trackCount: 0,
        sizeOnDisk: 0,
        percentOfTracks: 0,
      },
    }));
    res.json(formatted);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch albums',
      message: error.message,
    });
  }
});

// Add album
router.post('/albums', async (req, res) => {
  try {
    const { artistId, releaseGroupMbid, albumName } = req.body;
    
    if (!artistId || !releaseGroupMbid || !albumName) {
      return res.status(400).json({ 
        error: 'artistId, releaseGroupMbid, and albumName are required' 
      });
    }

    const album = await libraryManager.addAlbum(artistId, releaseGroupMbid, albumName, {
      fetchTracks: true, // Fetch tracks when album is added
    });

    // Format for frontend
    const formatted = {
      ...album,
      foreignAlbumId: album.mbid,
      title: album.albumName,
      albumType: 'Album',
    };

    res.status(201).json(formatted);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to add album',
      message: error.message,
    });
  }
});

// Get album by ID
router.get('/albums/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const album = libraryManager.getAlbumById(id);
    if (!album) {
      return res.status(404).json({ error: 'Album not found' });
    }
    res.json(album);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch album',
      message: error.message,
    });
  }
});

// Update album
router.put('/albums/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const album = await libraryManager.updateAlbum(id, req.body);
    res.json(album);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to update album',
      message: error.message,
    });
  }
});

// Delete album
router.delete('/albums/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { deleteFiles = false } = req.query;
    await libraryManager.deleteAlbum(id, deleteFiles === 'true');
    res.json({ success: true, message: 'Album deleted successfully' });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to delete album',
      message: error.message,
    });
  }
});

// Get tracks for album
router.get('/tracks', async (req, res) => {
  try {
    const { albumId } = req.query;
    if (!albumId) {
      return res.status(400).json({ error: 'albumId parameter is required' });
    }
    const tracks = libraryManager.getTracks(albumId);
    // Format for frontend compatibility
    const formatted = tracks.map(track => ({
      ...track,
      title: track.trackName,
      trackNumber: track.trackNumber || 0,
    }));
    res.json(formatted);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch tracks',
      message: error.message,
    });
  }
});

// Download album
router.post('/downloads/album', async (req, res) => {
  try {
    const { artistId, albumId, artistMbid, artistName } = req.body;
    
    if (!albumId) {
      return res.status(400).json({ error: 'albumId is required' });
    }

    // Get album info
    const album = libraryManager.getAlbumById(albumId);
    if (!album) {
      return res.status(404).json({ error: 'Album not found' });
    }

    // Get or create artist
    let artist = artistId ? libraryManager.getArtistById(artistId) : null;
    
    // If artist doesn't exist but we have MBID/name, add them
    if (!artist && artistMbid && artistName) {
      try {
        artist = await libraryManager.addArtist(artistMbid, artistName, {
          quality: dbOps.getSettings().quality || 'standard',
        });
        libraryMonitor.log('info', 'library', 'Artist automatically added when downloading album', {
          artistMbid,
          artistName,
          albumId: album.id,
          albumName: album.albumName,
        });
      } catch (error) {
        console.error('Failed to add artist automatically:', error);
        // Continue anyway - downloadManager will handle the error
      }
    }
    
    // If still no artist, try to find by album's artistId
    if (!artist && album.artistId) {
      artist = libraryManager.getArtistById(album.artistId);
    }
    
    if (!artist) {
      return res.status(404).json({ error: 'Artist not found. Please add the artist to your library first.' });
    }
    
    if (album && artist) {
      // Create or update album request
      const albumRequests = dbOps.getAlbumRequests();
      const existingRequest = albumRequests.find(
        r => r.albumId === albumId || (r.albumMbid === album.mbid && r.artistMbid === artist.mbid)
      );
      
      if (!existingRequest) {
        dbOps.insertAlbumRequest({
          id: libraryManager.generateId(),
          artistId,
          artistMbid: artist.mbid,
          artistName: artist.artistName,
          albumId,
          albumMbid: album.mbid,
          albumName: album.albumName,
          status: 'processing',
          requestedAt: new Date().toISOString(),
        });
        libraryMonitor.log('info', 'request', 'Album request created', {
          albumId,
          albumName: album.albumName,
          artistName: artist.artistName,
        });
      }
    }

    // Queue download using global queue system
    try {
      const downloadRecord = await downloadManager.queueAlbumDownload(artistId, albumId);
      res.json({ 
        success: true, 
        message: 'Download queued',
        downloadId: downloadRecord.id,
      });
    } catch (error) {
      console.error(`Failed to queue album download ${albumId}:`, error.message);
      res.status(500).json({
        error: 'Failed to queue download',
        message: error.message,
      });
    }
  } catch (error) {
    console.error('Error initiating album download:', error);
    res.status(500).json({
      error: 'Failed to initiate album download',
      message: error.message,
    });
  }
});

// Download track
router.post('/downloads/track', async (req, res) => {
  try {
    const { artistId, trackId } = req.body;
    
    if (!artistId || !trackId) {
      return res.status(400).json({ error: 'artistId and trackId are required' });
    }

    // Queue download using global queue system
    const downloadRecord = await downloadManager.queueTrackDownload(artistId, trackId);
    res.json({ 
      success: true, 
      message: 'Download queued',
      downloadId: downloadRecord.id,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to queue track download',
      message: error.message,
    });
  }
});

// Get downloads
router.get('/downloads', async (req, res) => {
  try {
    const { slskdClient } = await import('../services/slskdClient.js');
    if (!slskdClient.isConfigured()) {
      return res.json([]);
    }
    const downloads = await slskdClient.getDownloads();
    res.json(downloads);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch downloads',
      message: error.message,
    });
  }
});

// Get download status for albums
router.get('/downloads/status', async (req, res) => {
  try {
    const { albumIds } = req.query;
    
    if (!albumIds) {
      return res.status(400).json({ error: 'albumIds query parameter is required' });
    }
    
    const albumIdArray = Array.isArray(albumIds) ? albumIds : albumIds.split(',');
    const statuses = {};
    
    for (const albumId of albumIdArray) {
      const status = downloadManager.getDownloadStatus(albumId);
      if (status) {
        statuses[albumId] = status;
      }
    }
    
    res.json(statuses);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch download status',
      message: error.message,
    });
  }
});

// Get download status for all albums (for polling)
router.get('/downloads/status/all', async (req, res) => {
  try {
    const { db } = await import('../config/db.js');
    const { libraryManager } = await import('../services/libraryManager.js');
    
    // Get all albums from library
    const artists = libraryManager.getAllArtists();
    const allAlbums = [];
    
    for (const artist of artists) {
      const albums = libraryManager.getAlbums(artist.id);
      for (const album of albums) {
        allAlbums.push(album);
      }
    }
    
    const statuses = {};
    for (const album of allAlbums) {
      const status = downloadManager.getDownloadStatus(album.id);
      if (status) {
        statuses[album.id] = status;
      }
    }
    
    res.json(statuses);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch download status',
      message: error.message,
    });
  }
});

// Scan library
router.post('/scan', async (req, res) => {
  try {
    const { discover } = req.body;
    libraryMonitor.log('info', 'scan', 'Manual library scan triggered via API', { discover });
    const result = await libraryManager.scanLibrary(discover);
    res.json({ 
      success: true, 
      message: 'Library scan completed',
      ...result 
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to scan library',
      message: error.message,
    });
  }
});

// Get root folder (always returns /data)
router.get('/rootfolder', async (req, res) => {
  try {
    const rootFolder = libraryManager.getRootFolder(); // Always /data
    res.json([{ path: rootFolder }]);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch root folder',
      message: error.message,
    });
  }
});

// Quality profiles
router.get('/qualityprofile', async (req, res) => {
  try {
    const profiles = qualityManager.getQualityProfiles();
    res.json(profiles);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch quality profiles',
      message: error.message,
    });
  }
});


// Lookup artist (check if exists in library)
router.get('/lookup/:mbid', async (req, res) => {
  try {
    const { mbid } = req.params;
    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: 'Invalid MBID format' });
    }

    const artist = libraryManager.getArtist(mbid);
    if (artist) {
      res.json({
        exists: true,
        artist: {
          ...artist,
          foreignArtistId: artist.foreignArtistId || artist.mbid,
        },
      });
    } else {
      res.json({
        exists: false,
        artist: null,
      });
    }
  } catch (error) {
    res.status(500).json({
      error: 'Failed to lookup artist',
      message: error.message,
    });
  }
});

// Batch lookup
router.post('/lookup/batch', async (req, res) => {
  try {
    const { mbids } = req.body;
    if (!Array.isArray(mbids)) {
      return res.status(400).json({ error: 'mbids must be an array' });
    }

    const results = {};
    mbids.forEach(mbid => {
      const artist = libraryManager.getArtist(mbid);
      results[mbid] = !!artist;
    });

    res.json(results);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to batch lookup artists',
      message: error.message,
    });
  }
});

// Get recent artists
router.get('/recent', async (req, res) => {
  try {
    const artists = libraryManager.getAllArtists();
    const recent = [...artists]
      .sort((a, b) => new Date(b.addedAt || b.added) - new Date(a.addedAt || a.added))
      .slice(0, 20)
      .map(artist => ({
        ...artist,
        foreignArtistId: artist.foreignArtistId || artist.mbid,
        added: artist.addedAt || artist.added,
      }));
    res.set("Cache-Control", "public, max-age=300");
    res.json(recent);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch recent artists',
      message: error.message,
    });
  }
});

// Refresh artist - fetch albums from MusicBrainz and process monitoring options
router.post('/artists/:mbid/refresh', async (req, res) => {
  try {
    const { mbid } = req.params;
    if (!UUID_REGEX.test(mbid)) {
      return res.status(400).json({ error: 'Invalid MBID format' });
    }

    const artist = libraryManager.getArtist(mbid);
    if (!artist) {
      return res.status(404).json({ error: 'Artist not found' });
    }

    // Fetch albums from MusicBrainz
    await libraryManager.fetchArtistAlbums(artist.id, mbid);
    
    // Get updated albums
    const albums = libraryManager.getAlbums(artist.id);
    
    // Update statistics for all albums (to ensure track counts and completion are correct)
    for (const album of albums) {
      await libraryManager.updateAlbumStatistics(album.id).catch(err => {
        console.error(`Failed to update statistics for album ${album.albumName}:`, err.message);
      });
    }
    
    // Update artist statistics
    await libraryManager.updateArtistStatistics(artist.id);
    
    // Process monitoring options if artist is monitored
    if (artist.monitored && artist.monitorOption && artist.monitorOption !== 'none') {
      const { downloadManager } = await import('../services/downloadManager.js');
      const albumsToMonitor = [];
      
      // Sort albums by release date (newest first)
      const sortedAlbums = [...albums].sort((a, b) => {
        const dateA = a.releaseDate || a.addedAt || '';
        const dateB = b.releaseDate || b.addedAt || '';
        return dateB.localeCompare(dateA);
      });
      
      switch (artist.monitorOption) {
        case 'all':
          // Monitor all albums that aren't already monitored
          albumsToMonitor.push(...albums.filter(a => !a.monitored));
          break;
        case 'latest':
          // Monitor only the latest album
          if (sortedAlbums.length > 0 && !sortedAlbums[0].monitored) {
            albumsToMonitor.push(sortedAlbums[0]);
          }
          break;
        case 'first':
          // Monitor only the first (oldest) album
          const oldestAlbum = sortedAlbums[sortedAlbums.length - 1];
          if (oldestAlbum && !oldestAlbum.monitored) {
            albumsToMonitor.push(oldestAlbum);
          }
          break;
        case 'missing':
          // Monitor albums that are missing tracks (not 100% complete)
          albumsToMonitor.push(...albums.filter(a => {
            const stats = a.statistics || {};
            return !a.monitored && (stats.percentOfTracks || 0) < 100;
          }));
          break;
        case 'future':
          // Monitor albums released after the artist was added (future releases)
          const artistAddedDate = new Date(artist.addedAt);
          albumsToMonitor.push(...albums.filter(a => {
            if (a.monitored) return false;
            if (!a.releaseDate) return false;
            const releaseDate = new Date(a.releaseDate);
            return releaseDate > artistAddedDate;
          }));
          break;
      }
      
      // Monitor and download albums
      for (const album of albumsToMonitor) {
        try {
          await libraryManager.updateAlbum(album.id, { ...album, monitored: true });
          // Start download in background
          downloadManager.downloadAlbum(artist.id, album.id).catch(err => {
            console.error(`Failed to auto-download album ${album.albumName}:`, err.message);
          });
          libraryMonitor.log('info', 'monitoring', 'Auto-monitoring album based on monitor option', {
            artistId: artist.id,
            artistName: artist.artistName,
            albumId: album.id,
            albumName: album.albumName,
            monitorOption: artist.monitorOption,
          });
        } catch (err) {
          console.error(`Failed to monitor album ${album.albumName}:`, err.message);
        }
      }
    }
    
    res.json({ 
      success: true, 
      message: 'Artist refreshed successfully',
      albums: albums.length,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to refresh artist',
      message: error.message,
    });
  }
});

// Get blocklist
router.get('/blocklist', async (req, res) => {
  try {
    const blocklist = queueCleaner.getBlocklist();
    res.json(blocklist);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch blocklist',
      message: error.message,
    });
  }
});

// Remove from blocklist
router.delete('/blocklist/:albumId', async (req, res) => {
  try {
    const { albumId } = req.params;
    const removed = await queueCleaner.removeFromBlocklist(albumId);
    
    if (removed) {
      res.json({ success: true, message: 'Removed from blocklist' });
    } else {
      res.status(404).json({ error: 'Not found in blocklist' });
    }
  } catch (error) {
    res.status(500).json({
      error: 'Failed to remove from blocklist',
      message: error.message,
    });
  }
});

// Manually trigger queue cleaner
// Get monitoring service status
router.get('/monitoring/status', async (req, res) => {
  try {
    const { monitoringService } = await import('../services/monitoringService.js');
    const status = monitoringService.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get monitoring status',
      message: error.message,
    });
  }
});

// Manually trigger monitoring check
router.post('/monitoring/check', async (req, res) => {
  try {
    const { monitoringService } = await import('../services/monitoringService.js');
    // Run check in background
    monitoringService.checkMonitoredArtists().catch(err => {
      console.error('Error in manual monitoring check:', err);
    });
    res.json({ success: true, message: 'Monitoring check started' });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to start monitoring check',
      message: error.message,
    });
  }
});

// Refresh album statistics (recalculate track counts and completion)
router.post('/albums/:albumId/refresh-stats', async (req, res) => {
  try {
    const { albumId } = req.params;
    if (!albumId) {
      return res.status(400).json({ error: 'albumId is required' });
    }

    await libraryManager.updateAlbumStatistics(albumId);
    const album = libraryManager.getAlbumById(albumId);
    
    res.json({ 
      success: true, 
      message: 'Album statistics updated',
      statistics: album?.statistics,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to refresh album statistics',
      message: error.message,
    });
  }
});

// Get activity log
router.get('/activity-log', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const category = req.query.category || null;
    const level = req.query.level || null;
    
    const log = libraryMonitor.getActivityLog(limit, category, level);
    res.json(log);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch activity log', message: error.message });
  }
});

// Get library status summary
router.get('/status', async (req, res) => {
  try {
    const summary = libraryMonitor.getStatusSummary();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch library status', message: error.message });
  }
});

// Force a library scan
router.post('/scan/force', async (req, res) => {
  try {
    libraryMonitor.log('info', 'scan', 'Manual scan triggered via API');
    await libraryMonitor.scan();
    res.json({ message: 'Library scan completed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to scan library', message: error.message });
  }
});

// Force a discovery scan (discovers artists/albums/tracks from file system)
router.post('/scan/discover', async (req, res) => {
  try {
    libraryMonitor.log('info', 'scan', 'Discovery scan triggered via API');
    const { fileScanner } = await import('../services/fileScanner.js');
    const result = await fileScanner.scanLibrary(true); // discover = true
    
    // Update statistics after discovery
    const artists = libraryManager.getAllArtists();
    for (const artist of artists) {
      await libraryManager.updateArtistStatistics(artist.id);
    }
    
    res.json({ 
      message: 'Discovery scan completed',
      ...result,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to run discovery scan', message: error.message });
  }
});

router.post('/queue-cleaner/clean', async (req, res) => {
  try {
    await queueCleaner.cleanNow();
    res.json({ success: true, message: 'Queue cleaner executed' });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to run queue cleaner',
      message: error.message,
    });
  }
});

// Get data integrity status
router.get('/integrity/status', async (req, res) => {
  try {
    const { dataIntegrityService } = await import('../services/dataIntegrityService.js');
    const status = await dataIntegrityService.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get integrity status',
      message: error.message,
    });
  }
});

// Run data integrity check
router.post('/integrity/check', async (req, res) => {
  try {
    const { dataIntegrityService } = await import('../services/dataIntegrityService.js');
    const results = await dataIntegrityService.runIntegrityCheck();
    res.json({
      success: true,
      message: 'Integrity check completed',
      ...results,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to run integrity check',
      message: error.message,
    });
  }
});

export default router;
