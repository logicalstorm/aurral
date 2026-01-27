import fs from 'fs/promises';
import path from 'path';
import { dbOps } from '../config/db-helpers.js';
import { libraryManager } from './libraryManager.js';
import { fileScanner } from './fileScanner.js';
import { downloadManager } from './downloadManager.js';

/**
 * Queue Cleaner - Handles failed imports, file renaming, and cleanup
 * Similar to Tubifarry's Queue Cleaner functionality
 */
export class QueueCleaner {
  constructor() {
    this.cleaning = false;
    this.config = this.getConfig();
    this.startCleaner();
  }

  getConfig() {
    const defaultConfig = {
      enabled: true,
      blocklist: true, // Blocklist failed releases
      remove: false, // Remove files on failure
      rename: true, // Rename files based on metadata
      cleanImports: 'missing', // 'missing', 'incomplete', 'always'
      retryFindingRelease: true,
      retryDelayMinutes: 5,
      maxRetries: 3,
    };

    const settings = dbOps.getSettings();
    const dbConfig = settings.queueCleaner || {};
    return { ...defaultConfig, ...dbConfig };
  }

  updateConfig() {
    this.config = this.getConfig();
  }

  startCleaner() {
    // Run cleaner every 30 seconds
    setInterval(() => {
      this.processQueue();
    }, 30000);
  }

  async processQueue() {
    if (this.cleaning || !this.config.enabled) {
      return;
    }

    this.cleaning = true;
    this.updateConfig();

    try {
      // Find failed downloads that haven't been processed
      const failedDownloads = dbOps.getDownloads().filter(
        d => d.status === 'failed' && !d.queueCleaned
      );

      // Find unmatched files in download directory
      const unmatchedFiles = await this.findUnmatchedFiles();

      console.log(`Queue Cleaner: Processing ${failedDownloads.length} failed downloads, ${unmatchedFiles.length} unmatched files`);

      // Process failed downloads
      for (const download of failedDownloads) {
        await this.processFailedDownload(download);
      }

      // Process unmatched files
      for (const file of unmatchedFiles) {
        await this.processUnmatchedFile(file);
      }
    } catch (error) {
      console.error('Error in Queue Cleaner:', error.message);
    } finally {
      this.cleaning = false;
    }
  }

  async findUnmatchedFiles() {
    const unmatchedFiles = [];
    
    // Get download directory
    const downloadDir = downloadManager.slskdDownloadDir;
    if (!downloadDir) {
      return unmatchedFiles;
    }

    try {
      // Check if directory exists
      await fs.access(downloadDir);
      
      // Scan for audio files
      const files = await this.scanForAudioFiles(downloadDir);
      
      // Get active downloads and requests to filter relevant files
      const activeDownloads = dbOps.getDownloads().filter(
        d => d.status === 'downloading' || d.status === 'completed'
      );
      const activeRequests = dbOps.getAlbumRequests().filter(
        r => r.status === 'processing'
      );
      
      // Only process files that are:
      // 1. Not matched to tracks
      // 2. Related to active downloads/requests OR recently modified (within 7 days)
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      
      for (const file of files) {
        const isMatched = await this.isFileMatched(file.path);
        if (isMatched) {
          continue; // Skip matched files
        }
        
        // Check if file is related to an active download
        const isRelatedToDownload = activeDownloads.some(download => {
          if (!download.destinationPath && !download.filename) {
            return false;
          }
          const downloadPath = download.destinationPath || download.filename;
          return file.path.includes(downloadPath) || 
                 path.basename(file.path) === path.basename(downloadPath);
        });
        
        // Check if file is recently modified (within 7 days)
        const isRecent = file.mtime && file.mtime.getTime() > sevenDaysAgo;
        
        // Only process if related to active download/request or recently modified
        if (isRelatedToDownload || isRecent) {
          unmatchedFiles.push(file);
        }
      }
    } catch (error) {
      // Directory might not exist yet
      if (error.code !== 'ENOENT') {
        console.warn(`Error scanning download directory: ${error.message}`);
      }
    }

    return unmatchedFiles;
  }

  async scanForAudioFiles(dir, depth = 0, maxDepth = 3) {
    const files = [];
    const audioExtensions = ['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav', '.opus'];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory() && depth < maxDepth) {
          const subFiles = await this.scanForAudioFiles(fullPath, depth + 1, maxDepth);
          files.push(...subFiles);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (audioExtensions.includes(ext)) {
            try {
              const stats = await fs.stat(fullPath);
              files.push({
                path: fullPath,
                name: entry.name,
                size: stats.size,
                extension: ext,
                mtime: stats.mtime, // Include modification time for filtering
              });
            } catch (error) {
              // Skip files we can't stat
            }
          }
        }
      }
    } catch (error) {
      // Ignore permission errors
    }

    return files;
  }

  async isFileMatched(filePath) {
    // Check if file is already matched to a track in the library
    const artists = libraryManager.getAllArtists();
    
    for (const artist of artists) {
      const albums = libraryManager.getAlbums(artist.id);
      for (const album of albums) {
        const tracks = libraryManager.getTracks(album.id);
        const matchedTrack = tracks.find(t => t.path === filePath);
        if (matchedTrack) {
          return true;
        }
      }
    }

    return false;
  }

  async processFailedDownload(download) {
    try {
      console.log(`Processing failed download: ${download.id}`);

      // Check if we should blocklist
      if (this.config.blocklist && download.albumId) {
        await this.blocklistRelease(download.albumId, download);
      }

      // Check if we should remove files
      if (this.config.remove && download.destinationPath) {
        try {
          // Log deletion event
          if (download.events) {
            download.events.push({
              timestamp: new Date().toISOString(),
              event: 'deleted',
              reason: 'queue_cleaner_failed_download',
              destinationPath: download.destinationPath,
            });
          }
          
          await fs.unlink(download.destinationPath);
          download.status = 'deleted';
          download.deletedAt = new Date().toISOString();
          console.log(`Removed failed download file: ${download.destinationPath}`);
        } catch (error) {
          console.warn(`Could not remove file ${download.destinationPath}:`, error.message);
        }
      }

      // Mark as cleaned
      dbOps.updateDownload(download.id, {
        queueCleaned: true,
        queueCleanedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`Error processing failed download ${download.id}:`, error.message);
    }
  }

  async processUnmatchedFile(file) {
    try {
      console.log(`Processing unmatched file: ${file.name}`);

      // Read metadata from file
      const metadata = await this.readFileMetadata(file.path);
      
      if (!metadata) {
        console.warn(`Could not read metadata from ${file.name}`);
        return;
      }

      // Check if we should rename
      if (this.config.rename) {
        const renamed = await this.renameFileBasedOnMetadata(file, metadata);
        if (renamed) {
          // Try to match again after renaming
          await this.retryMatching(renamed.path, metadata);
          return;
        }
      }

      // Try to match without renaming
      await this.retryMatching(file.path, metadata);

      // If still unmatched and should clean, handle it
      const stillUnmatched = !(await this.isFileMatched(file.path));
      if (stillUnmatched) {
        const shouldClean = this.shouldCleanImport(file, metadata);
        if (shouldClean) {
          if (this.config.remove) {
            await fs.unlink(file.path);
            console.log(`Removed unmatched file: ${file.path}`);
          } else if (this.config.blocklist) {
            // Try to blocklist if we can identify the release
            if (metadata.album && metadata.artist) {
              await this.blocklistByMetadata(metadata);
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error processing unmatched file ${file.path}:`, error.message);
    }
  }

  async readFileMetadata(filePath) {
    try {
      // Dynamically import music-metadata to handle cases where it's not installed
      const { parseFile } = await import('music-metadata');
      const metadata = await parseFile(filePath);
      
      return {
        artist: metadata.common.artist || metadata.common.albumartist || null,
        album: metadata.common.album || null,
        title: metadata.common.title || null,
        track: metadata.common.track?.no || null,
        year: metadata.common.year || null,
        genre: metadata.common.genre?.[0] || null,
      };
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        console.warn(`music-metadata not installed. Install with: npm install music-metadata`);
        return null;
      }
      console.warn(`Error reading metadata from ${filePath}:`, error.message);
      return null;
    }
  }

  async renameFileBasedOnMetadata(file, metadata) {
    if (!metadata.artist || !metadata.title) {
      return null;
    }

    try {
      const dir = path.dirname(file.path);
      const ext = path.extname(file.name);
      
      // Build new filename: Artist - Title.ext or TrackNumber - Title.ext
      let newName;
      if (metadata.track && metadata.album) {
        // Album track: "01 - Title.ext"
        const trackNum = String(metadata.track).padStart(2, '0');
        newName = `${trackNum} - ${this.sanitizeFilename(metadata.title)}${ext}`;
      } else {
        // Single track: "Artist - Title.ext"
        newName = `${this.sanitizeFilename(metadata.artist)} - ${this.sanitizeFilename(metadata.title)}${ext}`;
      }

      const newPath = path.join(dir, newName);

      // Don't rename if file already exists at destination
      try {
        await fs.access(newPath);
        console.log(`File already exists at ${newPath}, skipping rename`);
        return { path: newPath, renamed: false };
      } catch {
        // File doesn't exist, proceed with rename
      }

      await fs.rename(file.path, newPath);
      console.log(`Renamed file: ${file.name} -> ${newName}`);
      
      return { path: newPath, renamed: true };
    } catch (error) {
      console.error(`Error renaming file ${file.path}:`, error.message);
      return null;
    }
  }

  sanitizeFilename(name) {
    if (!name) return '';
    // Remove invalid filename characters
    return name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async retryMatching(filePath, metadata) {
    if (!this.config.retryFindingRelease) {
      return;
    }

    try {
      // Try to match file to a track using metadata
      const artists = libraryManager.getAllArtists();
      
      // Find matching artist
      const matchingArtist = artists.find(a => {
        const artistName = a.artistName.toLowerCase();
        const metadataArtist = (metadata.artist || '').toLowerCase();
        return artistName === metadataArtist || 
               artistName.includes(metadataArtist) ||
               metadataArtist.includes(artistName);
      });

      if (!matchingArtist) {
        return;
      }

      // Find matching album
      const albums = libraryManager.getAlbums(matchingArtist.id);
      const matchingAlbum = albums.find(a => {
        const albumName = a.albumName.toLowerCase();
        const metadataAlbum = (metadata.album || '').toLowerCase();
        return albumName === metadataAlbum ||
               albumName.includes(metadataAlbum) ||
               metadataAlbum.includes(albumName);
      });

      if (!matchingAlbum) {
        return;
      }

      // Find or create matching track
      const tracks = libraryManager.getTracks(matchingAlbum.id);
      let matchingTrack = tracks.find(t => {
        const trackName = t.trackName.toLowerCase();
        const metadataTitle = (metadata.title || '').toLowerCase();
        return trackName === metadataTitle ||
               trackName.includes(metadataTitle) ||
               metadataTitle.includes(trackName);
      });

      if (!matchingTrack && metadata.title) {
        // Create track if it doesn't exist
        const { randomUUID } = await import('crypto');
        matchingTrack = await libraryManager.addTrack(
          matchingAlbum.id,
          randomUUID(),
          metadata.title,
          metadata.track || 0
        );
      }

      if (matchingTrack) {
        // Update track with file path
        const stats = await fs.stat(filePath);
        await libraryManager.updateTrack(matchingTrack.id, {
          path: filePath,
          hasFile: true,
          size: stats.size,
        });

        console.log(`Matched file ${path.basename(filePath)} to track ${matchingTrack.trackName}`);
        return true;
      }
    } catch (error) {
      console.warn(`Error retrying match for ${filePath}:`, error.message);
    }

    return false;
  }

  shouldCleanImport(file, metadata) {
    const cleanMode = this.config.cleanImports;

    if (cleanMode === 'always') {
      return true;
    }

    if (cleanMode === 'missing') {
      // Clean if essential metadata is missing
      return !metadata.artist || !metadata.title;
    }

    if (cleanMode === 'incomplete') {
      // Clean if metadata is incomplete (missing album, track number, etc.)
      return !metadata.artist || !metadata.title || !metadata.album;
    }

    return false;
  }

  async blocklistRelease(albumId, download) {
    // Check if already blocklisted
    const blocklist = dbOps.getBlocklist();
    const existing = blocklist.find(b => b.albumId === albumId);
    if (existing) {
      return;
    }

    const album = libraryManager.getAlbumById(albumId);
    if (!album) {
      return;
    }

    dbOps.insertBlocklist({
      albumId: albumId,
      albumName: album.albumName,
      artistId: download.artistId,
      blocklistedAt: new Date().toISOString(),
      reason: download.lastError || 'Failed to import',
      downloadId: download.id,
    });

    console.log(`Blocklisted album: ${album.albumName}`);
  }

  async blocklistByMetadata(metadata) {
    // Create a unique key for this release
    const key = `${metadata.artist}:${metadata.album}`.toLowerCase();

    // Check if already blocklisted
    const blocklist = dbOps.getBlocklist();
    const existing = blocklist.find(b => {
      const existingKey = `${b.artistName || ''}:${b.albumName || ''}`.toLowerCase();
      return existingKey === key;
    });

    if (existing) {
      return;
    }

    dbOps.insertBlocklist({
      artistName: metadata.artist,
      albumName: metadata.album,
      blocklistedAt: new Date().toISOString(),
      reason: 'Failed to match file to library',
    });

    console.log(`Blocklisted release: ${metadata.artist} - ${metadata.album}`);
  }

  isBlocklisted(artistName, albumName) {
    return dbOps.isBlocklisted(artistName, albumName);
  }

  getBlocklist() {
    return dbOps.getBlocklist();
  }

  async removeFromBlocklist(albumId) {
    const result = dbOps.removeFromBlocklist(albumId);
    return result.changes > 0;
  }

  // Manual trigger for testing
  async cleanNow() {
    await this.processQueue();
  }
}

export const queueCleaner = new QueueCleaner();
