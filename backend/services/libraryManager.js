import fs from 'fs/promises';
import path from 'path';
import { db } from '../config/db.js';
import { musicbrainzRequest } from './apiClients.js';

export class LibraryManager {
  constructor() {
    this.initDb();
    this._rootFolder = null;
    this._rootFolderLogged = false;
  }

  initDb() {
    if (!db.data) {
      db.data = {};
    }
    if (!db.data.library) {
      db.data.library = {
        artists: [],
        albums: [],
        tracks: [],
        rootFolder: null,
        lastScan: null,
      };
    }
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
    this.initDb();
    
    const existing = (db.data.library.artists || []).find(a => a.mbid === mbid);
    if (existing) {
      return existing;
    }

    const rootFolder = this.getRootFolder(); // Always /data
    const artistPath = path.join(rootFolder, this.sanitizePath(artistName));
    
    // Don't create folders - they will be created when albums are downloaded
    // Just calculate the path for future use

    const artist = {
      id: this.generateId(),
      mbid,
      foreignArtistId: mbid, // For frontend compatibility
      artistName,
      path: artistPath, // Path where folders will be created when downloading
      addedAt: new Date().toISOString(),
      // Use default quality from settings
      quality: options.quality || db.data?.settings?.quality || 'standard',
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

    if (!db.data.library.artists) {
      db.data.library.artists = [];
    }
    db.data.library.artists.push(artist);
    await db.write();

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
    this.initDb();
    const artist = (db.data?.library?.artists || []).find(a => a.mbid === mbid);
    if (!artist) return null;
    return {
      ...artist,
      foreignArtistId: artist.foreignArtistId || artist.mbid,
    };
  }

  getArtistById(id) {
    this.initDb();
    return (db.data?.library?.artists || []).find(a => a.id === id) || null;
  }

  getAllArtists() {
    this.initDb();
    // Ensure all artists have foreignArtistId for frontend compatibility
    return ((db.data?.library?.artists) || []).map(artist => ({
      ...artist,
      foreignArtistId: artist.foreignArtistId || artist.mbid,
    }));
  }

  async updateArtist(mbid, updates) {
    this.initDb();
    // Find the artist directly in the database array, not via getArtist which returns a copy
    const artist = (db.data?.library?.artists || []).find(a => a.mbid === mbid);
    if (!artist) {
      throw new Error('Artist not found');
    }

    // Handle nested objects properly (merge instead of replace)
    if (updates.addOptions) {
      if (!artist.addOptions) {
        artist.addOptions = {};
      }
      Object.assign(artist.addOptions, updates.addOptions);
      // Don't delete from updates - Object.assign will overwrite, but we've already merged
      // So we'll delete it to prevent overwriting our merged version
      const { addOptions, ...restUpdates } = updates;
      Object.assign(artist, restUpdates);
    } else {
      // Apply all updates directly
      Object.assign(artist, updates);
    }
    
    try {
      await db.write();
    } catch (error) {
      console.error(`[LibraryManager] Error writing database:`, error);
      throw error;
    }
    
    // If monitoring option was changed and artist is now monitored, trigger monitoring immediately
    if (updates.monitored !== undefined || updates.monitorOption !== undefined) {
      const isNowMonitored = artist.monitored && artist.monitorOption && artist.monitorOption !== 'none';
      if (isNowMonitored) {
        // Trigger monitoring check for this artist in background (don't wait)
        import('../services/monitoringService.js').then(({ monitoringService }) => {
          monitoringService.processArtistMonitoring(artist).catch(err => {
            console.error(`[LibraryManager] Error triggering monitoring for ${artist.artistName}:`, err.message);
          });
        }).catch(err => {
          console.error(`[LibraryManager] Failed to import monitoring service:`, err.message);
        });
      }
    }
    
    // Return formatted version for frontend compatibility
    return {
      ...artist,
      foreignArtistId: artist.foreignArtistId || artist.mbid,
    };
  }

  async deleteArtist(mbid, deleteFiles = false) {
    this.initDb();
    
    console.log(`[LibraryManager] Deleting artist with MBID: ${mbid}`);
    console.log(`[LibraryManager] Current artists in DB: ${(db.data.library?.artists || []).length}`);
    
    const artist = this.getArtist(mbid);
    if (!artist) {
      // Try to find by ID if mbid doesn't match (for generated UUIDs)
      const allArtists = db.data.library?.artists || [];
      const foundById = allArtists.find(a => a.id === mbid || a.foreignArtistId === mbid);
      if (foundById) {
        console.log(`[LibraryManager] Found artist by ID instead of MBID: ${foundById.artistName}`);
        // Use the actual mbid from the found artist
        const actualMbid = foundById.mbid;
        
        if (deleteFiles && foundById.path) {
          try {
            await fs.rm(foundById.path, { recursive: true, force: true });
            console.log(`[LibraryManager] Deleted artist folder: ${foundById.path}`);
          } catch (error) {
            console.error(`[LibraryManager] Failed to delete artist files: ${error.message}`);
          }
        }
        
        // Remove by actual mbid
        if (db.data.library) {
          db.data.library.albums = (db.data.library.albums || []).filter(a => a.artistId !== foundById.id);
          db.data.library.tracks = (db.data.library.tracks || []).filter(t => t.artistId !== foundById.id);
          db.data.library.artists = (db.data.library.artists || []).filter(a => a.mbid !== actualMbid && a.id !== foundById.id);
        }
        await db.write();
        console.log(`[LibraryManager] Artist deleted successfully. Remaining artists: ${(db.data.library?.artists || []).length}`);
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

    // Remove associated albums and tracks
    const beforeCount = (db.data.library?.artists || []).length;
    if (db.data.library) {
      db.data.library.albums = (db.data.library.albums || []).filter(a => a.artistId !== artist.id);
      db.data.library.tracks = (db.data.library.tracks || []).filter(t => t.artistId !== artist.id);
      db.data.library.artists = (db.data.library.artists || []).filter(a => a.mbid !== mbid && a.id !== artist.id);
    }
    await db.write();
    
    const afterCount = (db.data.library?.artists || []).length;
    console.log(`[LibraryManager] Artist deleted. Before: ${beforeCount}, After: ${afterCount}`);
    
    return { success: true };
  }

  async addAlbum(artistId, releaseGroupMbid, albumName, options = {}) {
    this.initDb();
    const artist = this.getArtistById(artistId);
    if (!artist) {
      throw new Error('Artist not found');
    }

    const existing = (db.data.library.albums || []).find(
      a => a.artistId === artistId && a.mbid === releaseGroupMbid
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

    if (!db.data.library.albums) {
      db.data.library.albums = [];
    }
    db.data.library.albums.push(album);
    await db.write();
    
    // Fetch tracks for this album in background if we have a release group MBID
    if (releaseGroupMbid && options.fetchTracks !== false) {
      this.fetchAlbumTracks(album.id, releaseGroupMbid).catch(err => {
        console.error(`Failed to fetch tracks for album ${albumName}:`, err.message);
      });
    }
    
    return album;
  }

  getAlbums(artistId) {
    this.initDb();
    // Return albums with foreignAlbumId for frontend compatibility
    return (db.data.library.albums.filter(a => a.artistId === artistId) || []).map(album => ({
      ...album,
      foreignAlbumId: album.foreignAlbumId || album.mbid,
    }));
  }

  getAlbumById(id) {
    this.initDb();
    return (db.data?.library?.albums || []).find(a => a.id === id) || null;
  }

  async updateAlbum(id, updates) {
    this.initDb();
    const album = this.getAlbumById(id);
    if (!album) {
      throw new Error('Album not found');
    }

    Object.assign(album, updates);
    await db.write();
    return album;
  }

  async deleteAlbum(id, deleteFiles = false) {
    this.initDb();
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

    if (db.data.library) {
      db.data.library.tracks = (db.data.library.tracks || []).filter(t => t.albumId !== id);
      db.data.library.albums = (db.data.library.albums || []).filter(a => a.id !== id);
    }
    await db.write();
    return { success: true };
  }

  async addTrack(albumId, trackMbid, trackName, trackNumber, options = {}) {
    this.initDb();
    const album = this.getAlbumById(albumId);
    if (!album) {
      throw new Error('Album not found');
    }

    const existing = (db.data.library.tracks || []).find(
      t => t.albumId === albumId && t.mbid === trackMbid
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

    if (!db.data.library.tracks) {
      db.data.library.tracks = [];
    }
    db.data.library.tracks.push(track);
    await db.write();
    
    // Update album statistics after adding track
    this.updateAlbumStatistics(albumId).catch(err => {
      console.error(`Failed to update album statistics after adding track:`, err.message);
    });
    
    return track;
  }

  getTracks(albumId) {
    this.initDb();
    return (db.data?.library?.tracks || []).filter(t => t.albumId === albumId) || [];
  }

  async updateTrack(id, updates) {
    this.initDb();
    const track = (db.data?.library?.tracks || []).find(t => t.id === id);
    if (!track) {
      throw new Error('Track not found');
    }

    const albumId = track.albumId;
    Object.assign(track, updates);
    await db.write();
    
    // Update album statistics if track file status changed
    if (updates.hasFile !== undefined || updates.path !== undefined || updates.size !== undefined) {
      this.updateAlbumStatistics(albumId).catch(err => {
        console.error(`Failed to update album statistics after updating track:`, err.message);
      });
    }
    
    return track;
  }

  async scanLibrary(discover = false) {
    this.initDb();
    const { fileScanner } = await import('./fileScanner.js');
    return await fileScanner.scanLibrary(discover);
  }

  async updateAlbumStatistics(albumId) {
    this.initDb();
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
          track.size = stats.size;
          tracksWithFiles++;
        } catch (error) {
          // File doesn't exist
          track.hasFile = false;
          track.size = 0;
          await this.updateTrack(track.id, { hasFile: false, size: 0 });
        }
      }
    }

    const percentOfTracks = tracks.length > 0 
      ? Math.round((tracksWithFiles / tracks.length) * 100) 
      : 0;

    album.statistics = {
      trackCount: tracks.length,
      sizeOnDisk: totalSize,
      percentOfTracks: percentOfTracks,
    };

    await db.write();
    return album;
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
      totalSize += (album.statistics?.sizeOnDisk || 0);
    }

    artist.statistics = {
      albumCount: albums.length,
      trackCount: totalTracks,
      sizeOnDisk: totalSize,
    };

    await db.write();
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
