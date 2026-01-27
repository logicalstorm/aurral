import fs from 'fs/promises';
import path from 'path';
import { dbOps } from '../config/db-helpers.js';
import { libraryManager } from './libraryManager.js';
import { fileScanner } from './fileScanner.js';

/**
 * Library Monitor - Continuously tracks file system changes and updates database
 * - Scans root folder periodically
 * - Tracks file additions, deletions, moves
 * - Updates library statistics
 * - Logs all changes to database
 */
export class LibraryMonitor {
  constructor() {
    this.monitoring = false;
    this.scanInterval = null;
    this.lastScan = null;
    this.fileIndex = new Map(); // Track files by path for change detection
    this.scanIntervalMs = 60000; // Scan every 60 seconds
    this.initLogging();
  }

  initLogging() {
    // Activity log is managed by SQLite with automatic cleanup
    // No initialization needed
  }

  log(level, category, message, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level, // 'info', 'warn', 'error', 'debug'
      category, // 'scan', 'file', 'download', 'library', etc.
      message,
      data,
    };
    
    // Also log to console with prefix
    const prefix = `[${level.toUpperCase()}] [${category}]`;
    const logMethod = level === 'error' ? console.error : 
                     level === 'warn' ? console.warn : 
                     level === 'debug' ? console.debug : 
                     console.log;
    
    logMethod(`${prefix} ${message}`, Object.keys(data).length > 0 ? data : '');
    
    // Write to database (async, don't wait)
    dbOps.insertActivityLog(entry);
  }

  async start() {
    if (this.monitoring) {
      this.log('warn', 'monitor', 'Library monitor already running');
      return;
    }

    this.monitoring = true;
    const rootFolder = libraryManager.getRootFolder();
    this.log('info', 'monitor', 'Starting library monitor', {
      scanInterval: this.scanIntervalMs,
      rootFolder: rootFolder,
    });
    console.log(`[LibraryMonitor] Starting with root folder: ${rootFolder}`);
    console.log(`[LibraryMonitor] Scan interval: ${this.scanIntervalMs}ms (${this.scanIntervalMs / 1000}s)`);

    // Do initial scan immediately (but don't wait for it to complete to avoid blocking server startup)
    this.scan().catch(err => {
      this.log('error', 'monitor', 'Error in initial scan', { error: err.message });
      console.error('[LibraryMonitor] Initial scan failed:', err.message);
      console.error(err.stack);
    });

    // Then scan periodically
    this.scanInterval = setInterval(() => {
      this.scan().catch(err => {
        this.log('error', 'monitor', 'Error in periodic scan', { error: err.message });
      });
    }, this.scanIntervalMs);
  }

  stop() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    this.monitoring = false;
    this.log('info', 'monitor', 'Library monitor stopped');
  }

  async scan() {
    if (this.scanning) {
      this.log('debug', 'scan', 'Scan already in progress, skipping');
      return;
    }

    this.scanning = true;
    const startTime = Date.now();
    this.log('info', 'scan', 'Starting library scan');
    console.log('[LibraryMonitor] Starting library scan...');

    try {
      const rootFolder = libraryManager.getRootFolder();
      
      // Get current file index from disk
      const currentFiles = await this.buildFileIndex(rootFolder);
      console.log(`[LibraryMonitor] File system scan complete: ${currentFiles.size} files found`);
      this.log('info', 'scan', 'File system scan complete', {
        filesFound: currentFiles.size,
        rootFolder,
      });
      
      // If this is the first scan, always run discovery to find files on disk
      // This ensures we discover files even if artists already exist in the database
      if (this.fileIndex.size === 0) {
        console.log('[LibraryMonitor] First scan detected, running discovery scan to find files on disk...');
        this.log('info', 'scan', 'First scan - running discovery to find files on disk', {
          filesFound: currentFiles.size,
        });
        try {
          const result = await fileScanner.scanLibrary(true); // discover = true
          console.log(`[LibraryMonitor] Discovery scan complete: ${result.artistsCreated || 0} artists, ${result.albumsCreated || 0} albums, ${result.tracksCreated || 0} tracks`);
          this.log('info', 'scan', 'Discovery scan complete', result);
          
          // After discovery, rebuild file index to include newly discovered files
          const updatedFiles = await this.buildFileIndex(rootFolder);
          currentFiles.clear();
          for (const [path, info] of updatedFiles.entries()) {
            currentFiles.set(path, info);
          }
          console.log(`[LibraryMonitor] File index updated: ${currentFiles.size} files`);
        } catch (error) {
          this.log('error', 'scan', 'Discovery scan failed', { error: error.message });
          console.error('[LibraryMonitor] Discovery scan failed:', error.message);
          console.error(error.stack);
        }
      }

      // Compare with previous index to detect changes
      const changes = this.detectChanges(currentFiles);
      
      if (changes.added.length > 0 || changes.removed.length > 0 || changes.modified.length > 0) {
        this.log('info', 'scan', 'File system changes detected', {
          added: changes.added.length,
          removed: changes.removed.length,
          modified: changes.modified.length,
        });

        // Process changes
        await this.processChanges(changes);
      }

      // Update file index
      this.fileIndex = currentFiles;
      this.lastScan = new Date().toISOString();
      
      // Update library statistics
      await this.updateLibraryStatistics();

      const duration = Date.now() - startTime;
      this.log('info', 'scan', 'Library scan complete', {
        duration: `${duration}ms`,
        filesTracked: currentFiles.size,
      });

      // Last scan time is tracked in memory, no need to store in database
      // (can be added to settings if needed in the future)

    } catch (error) {
      this.log('error', 'scan', 'Library scan failed', { error: error.message, stack: error.stack });
    } finally {
      this.scanning = false;
    }
  }

  async buildFileIndex(rootFolder) {
    const fileIndex = new Map();
    const audioExtensions = ['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav', '.opus'];

    try {
      await fs.access(rootFolder);
    } catch (error) {
      this.log('warn', 'scan', 'Root folder not accessible', { 
        rootFolder, 
        error: error.message 
      });
      return fileIndex;
    }

    const scanDir = async (dirPath, depth = 0, maxDepth = 10) => {
      if (depth > maxDepth) return;

      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          
          if (entry.isDirectory()) {
            await scanDir(fullPath, depth + 1, maxDepth);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (audioExtensions.includes(ext)) {
              try {
                const stats = await fs.stat(fullPath);
                fileIndex.set(fullPath, {
                  path: fullPath,
                  name: entry.name,
                  size: stats.size,
                  modified: stats.mtime.toISOString(),
                  extension: ext,
                  inode: stats.ino, // For tracking moves
                });
              } catch (error) {
                this.log('debug', 'scan', 'Could not stat file', { 
                  path: fullPath, 
                  error: error.message 
                });
              }
            }
          }
        }
      } catch (error) {
        this.log('warn', 'scan', 'Error scanning directory', { 
          dirPath, 
          error: error.message 
        });
      }
    };

    await scanDir(rootFolder);
    return fileIndex;
  }

  detectChanges(currentFiles) {
    const changes = {
      added: [],
      removed: [],
      modified: [],
      moved: [], // Files that moved (same inode, different path)
    };

    // Find added and modified files
    for (const [filePath, fileInfo] of currentFiles.entries()) {
      const previous = this.fileIndex.get(filePath);
      
      if (!previous) {
        // New file
        changes.added.push(fileInfo);
      } else if (previous.modified !== fileInfo.modified || previous.size !== fileInfo.size) {
        // Modified file
        changes.modified.push(fileInfo);
      }
    }

    // Find removed files
    for (const [filePath, fileInfo] of this.fileIndex.entries()) {
      if (!currentFiles.has(filePath)) {
        // Check if it was moved (same inode elsewhere)
        let foundMoved = false;
        for (const [newPath, newInfo] of currentFiles.entries()) {
          if (newInfo.inode === fileInfo.inode && newPath !== filePath) {
            changes.moved.push({
              from: filePath,
              to: newPath,
              file: newInfo,
            });
            foundMoved = true;
            break;
          }
        }
        
        if (!foundMoved) {
          changes.removed.push(fileInfo);
        }
      }
    }

    return changes;
  }

  async processChanges(changes) {
    // Log all changes
    for (const file of changes.added) {
      this.log('info', 'file', 'File added', { 
        path: file.path, 
        size: file.size,
        name: file.name,
      });
    }

    for (const file of changes.removed) {
      this.log('warn', 'file', 'File removed', { 
        path: file.path, 
        name: file.name,
      });
    }

    for (const file of changes.modified) {
      this.log('info', 'file', 'File modified', { 
        path: file.path, 
        size: file.size,
        name: file.name,
      });
    }

    for (const move of changes.moved) {
      this.log('info', 'file', 'File moved', { 
        from: move.from, 
        to: move.to,
        name: move.file.name,
      });
    }

    // Update library database
    const artists = libraryManager.getAllArtists();
    
    // Process added files - try to match to tracks
    for (const file of changes.added) {
      const matched = await fileScanner.matchFileToTrack(file, artists);
      
      // If file was matched to a track, update album statistics and request status
      if (matched) {
        // Find which album this track belongs to
        for (const artist of artists) {
          const albums = libraryManager.getAlbums(artist.id);
          for (const album of albums) {
            const tracks = libraryManager.getTracks(album.id);
            const track = tracks.find(t => t.path === file.path);
            if (track) {
              // Update album statistics
              await libraryManager.updateAlbumStatistics(album.id);
              
              // Check if album is now complete
              const updatedAlbum = libraryManager.getAlbumById(album.id);
              const isComplete = updatedAlbum?.statistics?.percentOfTracks === 100;
              
              // Update album request status
              if (isComplete) {
                const albumRequests = dbOps.getAlbumRequests();
                const albumRequest = albumRequests.find(r => r.albumId === album.id);
                if (albumRequest && albumRequest.status !== 'available') {
                  dbOps.updateAlbumRequest(album.id, { status: 'available' });
                  this.log('info', 'request', 'Album request marked as available (file discovered)', {
                    albumId: album.id,
                    albumName: album.albumName,
                    tracksComplete: updatedAlbum.statistics.trackCount,
                    totalTracks: updatedAlbum.statistics.trackCount,
                    percentComplete: updatedAlbum.statistics.percentOfTracks,
                  });
                }
              }
              break;
            }
          }
        }
      }
    }

    // Process removed files - mark tracks as missing
    for (const file of changes.removed) {
      await this.handleFileRemoved(file);
    }

    // Process moved files - update track paths
    for (const move of changes.moved) {
      await this.handleFileMoved(move.from, move.to, move.file);
    }

    // Process modified files - update track info
    for (const file of changes.modified) {
      await this.handleFileModified(file);
    }
  }

  async handleFileRemoved(file) {
    // Find tracks that reference this file
    const artists = libraryManager.getAllArtists();
    for (const artist of artists) {
      const albums = libraryManager.getAlbums(artist.id);
      for (const album of albums) {
        const tracks = libraryManager.getTracks(album.id);
        for (const track of tracks) {
          if (track.path === file.path) {
            this.log('info', 'library', 'Marking track as missing', {
              trackId: track.id,
              trackName: track.trackName,
              albumId: album.id,
              albumName: album.albumName,
            });
            
            await libraryManager.updateTrack(track.id, {
              path: null,
              hasFile: false,
              size: 0,
            });
          }
        }
      }
    }
  }

  async handleFileMoved(fromPath, toPath, file) {
    // Find tracks that reference the old path
    const artists = libraryManager.getAllArtists();
    for (const artist of artists) {
      const albums = libraryManager.getAlbums(artist.id);
      for (const album of albums) {
        const tracks = libraryManager.getTracks(album.id);
        for (const track of tracks) {
          if (track.path === fromPath) {
            this.log('info', 'library', 'Updating track path (file moved)', {
              trackId: track.id,
              trackName: track.trackName,
              from: fromPath,
              to: toPath,
            });
            
            await libraryManager.updateTrack(track.id, {
              path: toPath,
              hasFile: true,
              size: file.size,
            });
          }
        }
      }
    }
  }

  async handleFileModified(file) {
    // Update track info if file size changed
    const artists = libraryManager.getAllArtists();
    for (const artist of artists) {
      const albums = libraryManager.getAlbums(artist.id);
      for (const album of albums) {
        const tracks = libraryManager.getTracks(album.id);
        for (const track of tracks) {
          if (track.path === file.path && track.size !== file.size) {
            this.log('debug', 'library', 'Updating track size', {
              trackId: track.id,
              trackName: track.trackName,
              oldSize: track.size,
              newSize: file.size,
            });
            
            await libraryManager.updateTrack(track.id, {
              size: file.size,
            });
          }
        }
      }
    }
  }

  async updateLibraryStatistics() {
    this.log('info', 'library', 'Updating library statistics');
    console.log('[LibraryMonitor] Updating library statistics...');
    
    const artists = libraryManager.getAllArtists();
    let statsUpdated = 0;
    
    for (const artist of artists) {
      try {
        await libraryManager.updateArtistStatistics(artist.id);
        statsUpdated++;
        
        // Log statistics for debugging
        const updatedArtist = libraryManager.getArtistById(artist.id);
        if (updatedArtist && updatedArtist.statistics) {
          this.log('debug', 'library', 'Artist statistics updated', {
            artistId: artist.id,
            artistName: artist.artistName,
            albumCount: updatedArtist.statistics.albumCount,
            trackCount: updatedArtist.statistics.trackCount,
            sizeOnDisk: updatedArtist.statistics.sizeOnDisk,
          });
        }
      } catch (error) {
        this.log('error', 'library', 'Failed to update artist statistics', {
          artistId: artist.id,
          artistName: artist.artistName,
          error: error.message,
        });
      }
    }
    
    console.log(`[LibraryMonitor] Statistics updated for ${statsUpdated}/${artists.length} artists`);
    this.log('info', 'library', 'Library statistics updated', {
      artistsUpdated: statsUpdated,
      totalArtists: artists.length,
    });
  }

  // Get activity log
  getActivityLog(limit = 100, category = null, level = null) {
    return dbOps.getActivityLog(limit, category, level);
  }

  // Get library status summary
  getStatusSummary() {
    const artists = libraryManager.getAllArtists();
    const rootFolder = libraryManager.getRootFolder();
    
    const summary = {
      rootFolder,
      lastScan: this.lastScan,
      monitoring: this.monitoring,
      filesTracked: this.fileIndex.size,
      artists: {
        total: artists.length,
        monitored: artists.filter(a => a.monitored).length,
        withFiles: 0,
        withoutFiles: 0,
      },
      albums: {
        total: 0,
        monitored: 0,
        complete: 0,
        incomplete: 0,
        downloading: 0,
      },
      tracks: {
        total: 0,
        withFiles: 0,
        missing: 0,
      },
    };

    for (const artist of artists) {
      const albums = libraryManager.getAlbums(artist.id);
      summary.albums.total += albums.length;
      summary.albums.monitored += albums.filter(a => a.monitored).length;
      
      let artistHasFiles = false;
      for (const album of albums) {
        const tracks = libraryManager.getTracks(album.id);
        summary.tracks.total += tracks.length;
        
        const tracksWithFiles = tracks.filter(t => t.hasFile).length;
        summary.tracks.withFiles += tracksWithFiles;
        summary.tracks.missing += tracks.length - tracksWithFiles;
        
        if (tracksWithFiles > 0) {
          artistHasFiles = true;
        }
        
        if (tracks.length > 0) {
          const percentComplete = (tracksWithFiles / tracks.length) * 100;
          if (percentComplete === 100) {
            summary.albums.complete++;
          } else {
            summary.albums.incomplete++;
          }
        }
      }
      
      if (artistHasFiles) {
        summary.artists.withFiles++;
      } else {
        summary.artists.withoutFiles++;
      }
    }

    // Count downloading albums from download records
    const downloads = dbOps.getDownloads();
    const downloadingAlbums = new Set();
    for (const download of downloads) {
      if (download.status === 'downloading' && download.albumId) {
        downloadingAlbums.add(download.albumId);
      }
    }
    summary.albums.downloading = downloadingAlbums.size;

    return summary;
  }
}

export const libraryMonitor = new LibraryMonitor();
