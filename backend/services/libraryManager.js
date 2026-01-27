import fs from 'fs/promises';
import path from 'path';
import { dbOps } from '../config/db-helpers.js';
import { dbHelpers } from '../config/db-sqlite.js';
import { musicbrainzRequest } from './apiClients.js';

// Get settings helper
function getSettings() {
  return dbOps.getSettings();
}

export class LibraryManager {
  constructor() {
    this._rootFolder = null;
    this._rootFolderLogged = false;
  }

  getRootFolder() {
    // Cache the root folder value
    if (this._rootFolder === null) {
      // Use environment variable if set (for local development)
      // Otherwise use /data (for Docker - users can remap via volume mounts: /their/path:/data)
      this._rootFolder = process.env.MUSIC_ROOT || process.env.DATA_PATH || '/data';
      
      // Only log once on first call
      if (process.env.NODE_ENV !== 'production' && !this._rootFolderLogged) {
        console.log(`[LibraryManager] Root folder: ${this._rootFolder} (MUSIC_ROOT=${process.env.MUSIC_ROOT || 'not set'}, DATA_PATH=${process.env.DATA_PATH || 'not set'})`);
        this._rootFolderLogged = true;
      }
    }
    return this._rootFolder;
  }

  setRootFolder(folderPath) {
    // No-op: root folder is always /data
    // This method is kept for API compatibility but doesn't do anything
    return Promise.resolve();
  }

  async addArtist(mbid, artistName, options = {}) {
    const existing = dbOps.getArtist(mbid);
    if (existing) {
      return existing;
    }

    const rootFolder = this.getRootFolder(); // Always /data
    const artistPath = path.join(rootFolder, this.sanitizePath(artistName));
    
    const settings = getSettings();
    const artist = {
      id: this.generateId(),
      mbid,
      foreignArtistId: mbid, // For frontend compatibility
      artistName,
      path: artistPath, // Path where folders will be created when downloading
      addedAt: new Date().toISOString(),
      // Use default quality from settings
      quality: options.quality || settings.quality || 'standard',
      // Monitoring options - default to 'none' (artist only)
      monitored: false,
      monitorOption: 'none',
      addOptions: {
        monitor: 'none',
      },
      albumFolders: true,
      statistics: {
        albumCount: 0,
        trackCount: 0,
        sizeOnDisk: 0,
      },
    };

    dbOps.insertArtist(artist);

    // Don't automatically fetch albums - albums can be viewed without artist in library
    // Albums will be fetched when user explicitly requests them or when monitoring is enabled

    return artist;
  }

  async fetchArtistAlbums(artistId, mbid) {
    try {
      const artistData = await musicbrainzRequest(`/artist/${mbid}`, {
        inc: 'release-groups',
      });

      if (artistData['release-groups']) {
        // Include all release types - no filtering
        const releaseGroups = artistData['release-groups']
          .slice(0, 50); // Limit to first 50

        for (const rg of releaseGroups) {
          try {
            const album = await this.addAlbum(artistId, rg.id, rg.title, {
              releaseDate: rg['first-release-date'] || null,
              fetchTracks: true, // Fetch tracks when album is added
            });
            
            // Update album with release date if available
            if (rg['first-release-date'] && album) {
              await this.updateAlbum(album.id, {
                ...album,
                releaseDate: rg['first-release-date'],
              });
            }
            
            // Update album statistics after tracks are fetched (with delay to allow tracks to be added)
            setTimeout(() => {
              this.updateAlbumStatistics(album.id).catch(err => {
                console.error(`Failed to update album statistics for ${rg.title}:`, err.message);
              });
            }, 3000);
          } catch (err) {
            console.error(`Failed to add album ${rg.title}:`, err.message);
          }
        }
      }
    } catch (error) {
      console.error(`Failed to fetch albums for artist ${mbid}:`, error.message);
    }
  }

  async fetchAlbumTracks(albumId, releaseGroupMbid) {
    try {
      // Fetch release group details to get releases
      const rgData = await musicbrainzRequest(`/release-group/${releaseGroupMbid}`, {
        inc: 'releases',
      });

      if (rgData.releases && rgData.releases.length > 0) {
        // Get the first release
        const releaseId = rgData.releases[0].id;
        
        // Fetch release details with recordings
        const releaseData = await musicbrainzRequest(`/release/${releaseId}`, {
          inc: 'recordings',
        });

        let tracksAdded = 0;
        if (releaseData.media && releaseData.media.length > 0) {
          for (const medium of releaseData.media) {
            if (medium.tracks) {
              for (const track of medium.tracks) {
                const recording = track.recording;
                if (recording) {
                  try {
                    await this.addTrack(albumId, recording.id, recording.title, track.position || 0);
                    tracksAdded++;
                  } catch (err) {
                    // Track might already exist, that's okay
                    if (!err.message.includes('already exists')) {
                      console.error(`Failed to add track ${recording.title}:`, err.message);
                    }
                  }
                }
              }
            }
          }
        }
        
        // Update album statistics after tracks are added
        if (tracksAdded > 0) {
          await this.updateAlbumStatistics(albumId);
        }
      }
    } catch (error) {
      console.error(`Failed to fetch tracks for album ${releaseGroupMbid}:`, error.message);
    }
  }

  getArtist(mbid) {
    return dbOps.getArtist(mbid);
  }

  getArtistById(id) {
    return dbOps.getArtistById(id);
  }

  getAllArtists() {
    return dbOps.getAllArtists();
  }

  async updateArtist(mbid, updates) {
    const artist = dbOps.getArtist(mbid);
    if (!artist) {
      throw new Error('Artist not found');
    }

    // Handle nested objects properly (merge instead of replace)
    let mergedUpdates = { ...updates };
    if (updates.addOptions) {
      mergedUpdates.addOptions = {
        ...(artist.addOptions || {}),
        ...updates.addOptions,
      };
    }
    if (updates.statistics) {
      mergedUpdates.statistics = {
        ...(artist.statistics || {}),
        ...updates.statistics,
      };
    }
    
    const updated = dbOps.updateArtist(mbid, mergedUpdates);
    
    // If monitoring option was changed and artist is now monitored, trigger monitoring immediately
    if (updates.monitored !== undefined || updates.monitorOption !== undefined) {
      const isNowMonitored = updated.monitored && updated.monitorOption && updated.monitorOption !== 'none';
      if (isNowMonitored) {
        // Trigger monitoring check for this artist in background (don't wait)
        import('./monitoringService.js').then(({ monitoringService }) => {
          monitoringService.processArtistMonitoring(updated).catch(err => {
            console.error(`[LibraryManager] Error triggering monitoring for ${updated.artistName}:`, err.message);
          });
        }).catch(err => {
          console.error(`[LibraryManager] Failed to import monitoring service:`, err.message);
        });
      }
    }
    
    return updated;
  }

  async deleteArtist(mbid, deleteFiles = false) {
    console.log(`[LibraryManager] Deleting artist with MBID: ${mbid}`);
    
    const artist = this.getArtist(mbid);
    if (!artist) {
      // Try to find by ID if mbid doesn't match (for generated UUIDs)
      const allArtists = this.getAllArtists();
      const foundById = allArtists.find(a => a.id === mbid || a.foreignArtistId === mbid);
      if (foundById) {
        console.log(`[LibraryManager] Found artist by ID instead of MBID: ${foundById.artistName}`);
        const actualMbid = foundById.mbid;
        
        if (deleteFiles && foundById.path) {
          try {
            await fs.rm(foundById.path, { recursive: true, force: true });
            console.log(`[LibraryManager] Deleted artist folder: ${foundById.path}`);
          } catch (error) {
            console.error(`[LibraryManager] Failed to delete artist files: ${error.message}`);
          }
        }
        
        // Delete by actual mbid (cascade will handle albums and tracks)
        dbOps.deleteArtist(actualMbid);
        console.log(`[LibraryManager] Artist deleted successfully.`);
        return { success: true };
      }
      
      console.error(`[LibraryManager] Artist not found with MBID: ${mbid}`);
      throw new Error('Artist not found');
    }

    console.log(`[LibraryManager] Found artist to delete: ${artist.artistName} (id: ${artist.id}, mbid: ${artist.mbid})`);

    if (deleteFiles && artist.path) {
      try {
        await fs.rm(artist.path, { recursive: true, force: true });
        console.log(`[LibraryManager] Deleted artist folder: ${artist.path}`);
      } catch (error) {
        console.error(`[LibraryManager] Failed to delete artist files: ${error.message}`);
      }
    }

    // Delete artist (cascade will handle albums and tracks via foreign keys)
    dbOps.deleteArtist(mbid);
    
    console.log(`[LibraryManager] Artist deleted successfully.`);
    
    return { success: true };
  }

  async addAlbum(artistId, releaseGroupMbid, albumName, options = {}) {
    const artist = this.getArtistById(artistId);
    if (!artist) {
      throw new Error('Artist not found');
    }

    const existing = dbOps.getAlbums(artistId).find(
      a => a.mbid === releaseGroupMbid
    );
    if (existing) {
      return existing;
    }

    // Calculate album path but don't create the folder yet
    // Folders will be created when files are actually downloaded
    const albumPath = path.join(artist.path, this.sanitizePath(albumName));

    const album = {
      id: this.generateId(),
      artistId,
      mbid: releaseGroupMbid,
      foreignAlbumId: releaseGroupMbid, // For frontend compatibility
      albumName,
      path: albumPath,
      addedAt: new Date().toISOString(),
      releaseDate: options.releaseDate || null,
      statistics: {
        trackCount: 0,
        sizeOnDisk: 0,
        percentOfTracks: 0,
      },
    };

    dbOps.insertAlbum(album);
    
    // Fetch tracks for this album in background if we have a release group MBID
    if (releaseGroupMbid && options.fetchTracks !== false) {
      this.fetchAlbumTracks(album.id, releaseGroupMbid).catch(err => {
        console.error(`Failed to fetch tracks for album ${albumName}:`, err.message);
      });
    }
    
    return album;
  }

  getAlbums(artistId) {
    return dbOps.getAlbums(artistId);
  }

  getAlbumById(id) {
    return dbOps.getAlbumById(id);
  }

  async updateAlbum(id, updates) {
    const album = this.getAlbumById(id);
    if (!album) {
      throw new Error('Album not found');
    }

    // Merge statistics if provided
    let mergedUpdates = { ...updates };
    if (updates.statistics) {
      mergedUpdates.statistics = {
        ...(album.statistics || {}),
        ...updates.statistics,
      };
    }

    return dbOps.updateAlbum(id, mergedUpdates);
  }

  async deleteAlbum(id, deleteFiles = false) {
    const album = this.getAlbumById(id);
    if (!album) {
      throw new Error('Album not found');
    }

    if (deleteFiles && album.path) {
      try {
        await fs.rm(album.path, { recursive: true, force: true });
      } catch (error) {
        console.error(`Failed to delete album files: ${error.message}`);
      }
    }

    // Delete album (cascade will handle tracks via foreign keys)
    dbOps.deleteAlbum(id);
    return { success: true };
  }

  async addTrack(albumId, trackMbid, trackName, trackNumber, options = {}) {
    const album = this.getAlbumById(albumId);
    if (!album) {
      throw new Error('Album not found');
    }

    const existing = dbOps.getTracks(albumId).find(
      t => t.mbid === trackMbid
    );
    if (existing) {
      return existing;
    }

    const track = {
      id: this.generateId(),
      albumId,
      artistId: album.artistId,
      mbid: trackMbid,
      trackName,
      trackNumber,
      path: null, // Will be set when file is downloaded
      quality: options.quality || null,
      size: 0,
      addedAt: new Date().toISOString(),
      hasFile: false,
    };

    dbOps.insertTrack(track);
    
    // Update album statistics after adding track
    this.updateAlbumStatistics(albumId).catch(err => {
      console.error(`Failed to update album statistics after adding track:`, err.message);
    });
    
    return track;
  }

  getTracks(albumId) {
    return dbOps.getTracks(albumId);
  }

  async updateTrack(id, updates) {
    const track = dbOps.getTrackById(id);
    if (!track) {
      throw new Error('Track not found');
    }

    const albumId = track.albumId;
    const updated = dbOps.updateTrack(id, updates);
    
    // Update album statistics if track file status changed
    if (updates.hasFile !== undefined || updates.path !== undefined || updates.size !== undefined) {
      this.updateAlbumStatistics(albumId).catch(err => {
        console.error(`Failed to update album statistics after updating track:`, err.message);
      });
    }
    
    return updated;
  }

  async scanLibrary(discover = false) {
    const { fileScanner } = await import('./fileScanner.js');
    return await fileScanner.scanLibrary(discover);
  }

  async updateAlbumStatistics(albumId) {
    const album = this.getAlbumById(albumId);
    if (!album) return;

    const tracks = this.getTracks(albumId);
    let tracksWithFiles = 0;
    let totalSize = 0;

    for (const track of tracks) {
      if (track.path && track.hasFile) {
        try {
          const stats = await fs.stat(track.path);
          totalSize += stats.size;
          // Update track size
          dbOps.updateTrack(track.id, { size: stats.size });
          tracksWithFiles++;
        } catch (error) {
          // File doesn't exist
          dbOps.updateTrack(track.id, { hasFile: false, size: 0 });
        }
      }
    }

    const percentOfTracks = tracks.length > 0 
      ? Math.round((tracksWithFiles / tracks.length) * 100) 
      : 0;

    const statistics = {
      trackCount: tracks.length,
      sizeOnDisk: totalSize,
      percentOfTracks: percentOfTracks,
    };

    dbOps.updateAlbum(albumId, { statistics });
    return this.getAlbumById(albumId);
  }

  async updateArtistStatistics(artistId) {
    const artist = this.getArtistById(artistId);
    if (!artist) return;

    const albums = this.getAlbums(artistId);
    let totalTracks = 0;
    let totalSize = 0;

    // Update each album's statistics first
    for (const album of albums) {
      await this.updateAlbumStatistics(album.id);
      
      const tracks = this.getTracks(album.id);
      totalTracks += tracks.length;
      const updatedAlbum = this.getAlbumById(album.id);
      totalSize += (updatedAlbum.statistics?.sizeOnDisk || 0);
    }

    const statistics = {
      albumCount: albums.length,
      trackCount: totalTracks,
      sizeOnDisk: totalSize,
    };

    dbOps.updateArtist(artist.mbid, { statistics });
  }

  sanitizePath(name) {
    // Remove invalid characters for file paths
    return name.replace(/[<>:"/\\|?*]/g, '_').trim();
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}

export const libraryManager = new LibraryManager();
