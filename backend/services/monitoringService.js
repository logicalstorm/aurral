import { libraryManager } from './libraryManager.js';
import { downloadManager } from './downloadManager.js';
import { libraryMonitor } from './libraryMonitor.js';
import { musicbrainzRequest } from './apiClients.js';
import { db } from '../config/db.js';

/**
 * Monitoring Service - Automatically checks monitored artists and processes their monitoring options
 * - Periodically checks all monitored artists
 * - Fetches new albums from MusicBrainz
 * - Processes monitoring options (all, latest, future, missing, first)
 * - Automatically monitors and downloads albums based on the option
 */
export class MonitoringService {
  constructor() {
    this.running = false;
    this.checkInterval = null;
    this.checkIntervalMs = 60 * 60 * 1000; // Check every hour
    this.lastCheck = null;
  }

  async start() {
    if (this.running) {
      console.log('[MonitoringService] Already running');
      return;
    }

    this.running = true;
    console.log(`[MonitoringService] Starting with check interval: ${this.checkIntervalMs / 1000 / 60} minutes`);
    libraryMonitor.log('info', 'monitoring', 'Monitoring service started', {
      checkInterval: this.checkIntervalMs,
    });

    // Do initial check after 5 minutes (to let server fully start)
    setTimeout(() => {
      this.checkMonitoredArtists().catch(err => {
        console.error('[MonitoringService] Error in initial check:', err.message);
        libraryMonitor.log('error', 'monitoring', 'Error in initial check', { error: err.message });
      });
    }, 5 * 60 * 1000);

    // Then check periodically
    this.checkInterval = setInterval(() => {
      this.checkMonitoredArtists().catch(err => {
        console.error('[MonitoringService] Error in periodic check:', err.message);
        libraryMonitor.log('error', 'monitoring', 'Error in periodic check', { error: err.message });
      });
    }, this.checkIntervalMs);
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.running = false;
    libraryMonitor.log('info', 'monitoring', 'Monitoring service stopped');
    console.log('[MonitoringService] Stopped');
  }

  async checkMonitoredArtists() {
    if (!this.running) return;

    this.lastCheck = new Date();
    libraryMonitor.log('info', 'monitoring', 'Starting check of monitored artists');
    console.log('[MonitoringService] Checking monitored artists...');

    try {
      const artists = libraryManager.getAllArtists();
      const monitoredArtists = artists.filter(a => a.monitored && a.monitorOption && a.monitorOption !== 'none');

      if (monitoredArtists.length === 0) {
        libraryMonitor.log('info', 'monitoring', 'No monitored artists found');
        console.log('[MonitoringService] No monitored artists found');
        return;
      }

      console.log(`[MonitoringService] Found ${monitoredArtists.length} monitored artist(s)`);
      libraryMonitor.log('info', 'monitoring', `Checking ${monitoredArtists.length} monitored artists`, {
        artistCount: monitoredArtists.length,
      });

      for (const artist of monitoredArtists) {
        try {
          await this.processArtistMonitoring(artist);
        } catch (err) {
          console.error(`[MonitoringService] Error processing artist ${artist.artistName}:`, err.message);
          libraryMonitor.log('error', 'monitoring', `Error processing artist ${artist.artistName}`, {
            artistId: artist.id,
            artistName: artist.artistName,
            error: err.message,
          });
        }
      }

      libraryMonitor.log('info', 'monitoring', 'Completed check of monitored artists', {
        artistsChecked: monitoredArtists.length,
      });
      console.log(`[MonitoringService] Completed check of ${monitoredArtists.length} artist(s)`);
    } catch (error) {
      console.error('[MonitoringService] Error in checkMonitoredArtists:', error);
      libraryMonitor.log('error', 'monitoring', 'Error checking monitored artists', { error: error.message });
    }
  }

  async processArtistMonitoring(artist) {
    if (!artist.mbid) {
      console.warn(`[MonitoringService] Artist ${artist.artistName} has no MBID, skipping`);
      return;
    }

    libraryMonitor.log('info', 'monitoring', `Processing monitoring for artist: ${artist.artistName}`, {
      artistId: artist.id,
      monitorOption: artist.monitorOption,
    });

    // Fetch latest albums from MusicBrainz
    try {
      const artistData = await musicbrainzRequest(`/artist/${artist.mbid}`, {
        inc: 'release-groups',
      });

      if (!artistData['release-groups'] || artistData['release-groups'].length === 0) {
        console.log(`[MonitoringService] No release groups found for ${artist.artistName}`);
        return;
      }

      // Get all release groups (no filtering)
      const releaseGroups = artistData['release-groups'].slice(0, 50);

      // Add any new albums to library
      const existingAlbums = libraryManager.getAlbums(artist.id);
      const existingMbids = new Set(existingAlbums.map(a => a.mbid));

      let newAlbumsAdded = 0;
      for (const rg of releaseGroups) {
        if (!existingMbids.has(rg.id)) {
          try {
            const album = await libraryManager.addAlbum(artist.id, rg.id, rg.title, {
              releaseDate: rg['first-release-date'] || null,
              fetchTracks: true, // Fetch tracks when album is added
            });
            
            // Update album with release date if available
            if (rg['first-release-date'] && album) {
              await libraryManager.updateAlbum(album.id, {
                ...album,
                releaseDate: rg['first-release-date'],
              });
            }
            
            // Update album statistics after tracks are fetched (with delay)
            setTimeout(() => {
              libraryManager.updateAlbumStatistics(album.id).catch(err => {
                console.error(`Failed to update album statistics for ${rg.title}:`, err.message);
              });
            }, 3000);
            
            newAlbumsAdded++;
            libraryMonitor.log('info', 'monitoring', 'New album discovered', {
              artistId: artist.id,
              artistName: artist.artistName,
              albumMbid: rg.id,
              albumName: rg.title,
              releaseDate: rg['first-release-date'] || null,
            });
          } catch (err) {
            console.error(`[MonitoringService] Failed to add album ${rg.title}:`, err.message);
          }
        }
      }

      if (newAlbumsAdded > 0) {
        console.log(`[MonitoringService] Added ${newAlbumsAdded} new album(s) for ${artist.artistName}`);
      }

      // Get updated albums list
      const albums = libraryManager.getAlbums(artist.id);
      const albumsToMonitor = this.getAlbumsToMonitor(artist, albums);

      if (albumsToMonitor.length === 0) {
        console.log(`[MonitoringService] No albums to monitor for ${artist.artistName} (option: ${artist.monitorOption})`);
        return;
      }

      console.log(`[MonitoringService] Found ${albumsToMonitor.length} album(s) to monitor for ${artist.artistName}`);

      // Update statistics for all albums before determining which to monitor
      for (const album of albums) {
        await libraryManager.updateAlbumStatistics(album.id).catch(err => {
          console.error(`[MonitoringService] Failed to update statistics for ${album.albumName}:`, err.message);
        });
      }

      // Monitor and download albums
      for (const album of albumsToMonitor) {
        try {
          // Update album to monitored
          await libraryManager.updateAlbum(album.id, { ...album, monitored: true });

          // Start download in background
          downloadManager.downloadAlbum(artist.id, album.id).catch(err => {
            console.error(`[MonitoringService] Failed to auto-download album ${album.albumName}:`, err.message);
            libraryMonitor.log('error', 'monitoring', 'Failed to auto-download album', {
              artistId: artist.id,
              artistName: artist.artistName,
              albumId: album.id,
              albumName: album.albumName,
              error: err.message,
            });
          });

          libraryMonitor.log('info', 'monitoring', 'Auto-monitoring album based on monitor option', {
            artistId: artist.id,
            artistName: artist.artistName,
            albumId: album.id,
            albumName: album.albumName,
            monitorOption: artist.monitorOption,
          });
        } catch (err) {
          console.error(`[MonitoringService] Failed to monitor album ${album.albumName}:`, err.message);
        }
      }
    } catch (error) {
      console.error(`[MonitoringService] Error fetching albums for ${artist.artistName}:`, error.message);
      throw error;
    }
  }

  getAlbumsToMonitor(artist, albums) {
    if (!artist.monitorOption || artist.monitorOption === 'none') {
      return [];
    }

    // Filter out already monitored albums
    const unmonitoredAlbums = albums.filter(a => !a.monitored);

    if (unmonitoredAlbums.length === 0) {
      return [];
    }

    // Sort albums by release date (newest first)
    const sortedAlbums = [...unmonitoredAlbums].sort((a, b) => {
      const dateA = a.releaseDate || a.addedAt || '';
      const dateB = b.releaseDate || b.addedAt || '';
      return dateB.localeCompare(dateA);
    });

    switch (artist.monitorOption) {
      case 'all':
        // Monitor all unmonitored albums
        return unmonitoredAlbums;

      case 'latest':
        // Monitor only the latest (newest) album
        return sortedAlbums.length > 0 ? [sortedAlbums[0]] : [];

      case 'first':
        // Monitor only the first (oldest) album
        const oldestAlbum = sortedAlbums[sortedAlbums.length - 1];
        return oldestAlbum ? [oldestAlbum] : [];

      case 'missing':
        // Monitor albums that are missing tracks (not 100% complete)
        return unmonitoredAlbums.filter(a => {
          const stats = a.statistics || {};
          return (stats.percentOfTracks || 0) < 100;
        });

      case 'future':
        // Monitor albums released after the artist was added (future releases)
        const artistAddedDate = new Date(artist.addedAt);
        return unmonitoredAlbums.filter(a => {
          if (!a.releaseDate) return false;
          const releaseDate = new Date(a.releaseDate);
          return releaseDate > artistAddedDate;
        });

      default:
        return [];
    }
  }

  getStatus() {
    return {
      running: this.running,
      checkInterval: this.checkIntervalMs,
      lastCheck: this.lastCheck,
    };
  }
}

export const monitoringService = new MonitoringService();
