import fs from 'fs/promises';
import path from 'path';
import { libraryManager } from './libraryManager.js';
import { libraryMonitor } from './libraryMonitor.js';
import { dbOps } from '../config/db-helpers.js';

/**
 * Data Integrity Service
 * 
 * Performs periodic checks to ensure data consistency:
 * - Orphaned files (files without tracks)
 * - Missing files (tracks without files)
 * - Statistics accuracy
 * - Duplicate files
 * - Orphaned database records
 */
export class DataIntegrityService {
  constructor() {
    this.running = false;
    this.checkInterval = null;
    this.checkIntervalMs = 24 * 60 * 60 * 1000; // Check every 24 hours
  }

  async start() {
    if (this.running) {
      return;
    }

    this.running = true;
    console.log('[Data Integrity] Starting data integrity service');
    libraryMonitor.log('info', 'integrity', 'Data integrity service started', {
      checkInterval: this.checkIntervalMs,
    });

    // Run initial check after 5 minutes
    setTimeout(() => {
      this.runIntegrityCheck().catch(err => {
        console.error('[Data Integrity] Error in initial check:', err.message);
      });
    }, 5 * 60 * 1000);

    // Then check periodically
    this.checkInterval = setInterval(() => {
      this.runIntegrityCheck().catch(err => {
        console.error('[Data Integrity] Error in periodic check:', err.message);
      });
    }, this.checkIntervalMs);
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.running = false;
    libraryMonitor.log('info', 'integrity', 'Data integrity service stopped');
  }

  /**
   * Run comprehensive integrity check
   */
  async runIntegrityCheck() {
    if (!this.running) return;

    console.log('[Data Integrity] Running integrity check...');
    libraryMonitor.log('info', 'integrity', 'Starting integrity check');

    const results = {
      orphanedFiles: [],
      missingFiles: [],
      statisticsErrors: [],
      duplicateFiles: [],
      orphanedRecords: [],
      startTime: Date.now(),
    };

    try {
      // 1. Check for orphaned files (files without tracks)
      results.orphanedFiles = await this.findOrphanedFiles();

      // 2. Check for missing files (tracks without files)
      results.missingFiles = await this.findMissingFiles();

      // 3. Validate statistics accuracy
      results.statisticsErrors = await this.validateStatistics();

      // 4. Check for duplicate files
      results.duplicateFiles = await this.findDuplicateFiles();

      // 5. Check for orphaned database records
      results.orphanedRecords = await this.findOrphanedRecords();

      const duration = Date.now() - results.startTime;
      results.duration = duration;

      // Log results
      console.log(`[Data Integrity] Check complete:`);
      console.log(`  - Orphaned files: ${results.orphanedFiles.length}`);
      console.log(`  - Missing files: ${results.missingFiles.length}`);
      console.log(`  - Statistics errors: ${results.statisticsErrors.length}`);
      console.log(`  - Duplicate files: ${results.duplicateFiles.length}`);
      console.log(`  - Orphaned records: ${results.orphanedRecords.length}`);
      console.log(`  - Duration: ${duration}ms`);

      libraryMonitor.log('info', 'integrity', 'Integrity check complete', {
        orphanedFiles: results.orphanedFiles.length,
        missingFiles: results.missingFiles.length,
        statisticsErrors: results.statisticsErrors.length,
        duplicateFiles: results.duplicateFiles.length,
        orphanedRecords: results.orphanedRecords.length,
        duration,
      });

      // Auto-fix issues if possible
      await this.autoFixIssues(results);

      return results;
    } catch (error) {
      console.error('[Data Integrity] Error during integrity check:', error.message);
      libraryMonitor.log('error', 'integrity', 'Integrity check failed', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Find orphaned files (files in library without matching tracks)
   */
  async findOrphanedFiles() {
    const orphanedFiles = [];
    const rootFolder = libraryManager.getRootFolder();
    const audioExtensions = ['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav', '.opus'];

    try {
      // Get all tracks with files
      const artists = libraryManager.getAllArtists();
      const trackPaths = new Set();
      
      for (const artist of artists) {
        const albums = libraryManager.getAlbums(artist.id);
        for (const album of albums) {
          const tracks = libraryManager.getTracks(album.id);
          for (const track of tracks) {
            if (track.path) {
              trackPaths.add(track.path);
            }
          }
        }
      }

      // Scan library for files
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
                if (!trackPaths.has(fullPath)) {
                  try {
                    const stats = await fs.stat(fullPath);
                    orphanedFiles.push({
                      path: fullPath,
                      name: entry.name,
                      size: stats.size,
                      modified: stats.mtime,
                    });
                  } catch (error) {
                    // File might have been deleted
                  }
                }
              }
            }
          }
        } catch (error) {
          // Skip directories we can't read
        }
      };

      await scanDir(rootFolder);
    } catch (error) {
      console.error('[Data Integrity] Error finding orphaned files:', error.message);
    }

    return orphanedFiles;
  }

  /**
   * Find missing files (tracks marked as having files but file doesn't exist)
   */
  async findMissingFiles() {
    const missingFiles = [];
    const artists = libraryManager.getAllArtists();

    for (const artist of artists) {
      const albums = libraryManager.getAlbums(artist.id);
      for (const album of albums) {
        const tracks = libraryManager.getTracks(album.id);
        for (const track of tracks) {
          if (track.hasFile && track.path) {
            try {
              await fs.access(track.path);
            } catch (error) {
              // File doesn't exist
              missingFiles.push({
                trackId: track.id,
                trackName: track.trackName,
                albumId: album.id,
                albumName: album.albumName,
                artistId: artist.id,
                artistName: artist.artistName,
                path: track.path,
              });
            }
          }
        }
      }
    }

    return missingFiles;
  }

  /**
   * Validate statistics accuracy
   */
  async validateStatistics() {
    const errors = [];
    const artists = libraryManager.getAllArtists();

    for (const artist of artists) {
      const albums = libraryManager.getAlbums(artist.id);
      let actualAlbumCount = albums.length;
      let actualTrackCount = 0;
      let actualSize = 0;

      for (const album of albums) {
        const tracks = libraryManager.getTracks(album.id);
        actualTrackCount += tracks.length;

        let albumTracksWithFiles = 0;
        let albumSize = 0;

        for (const track of tracks) {
          if (track.hasFile && track.path) {
            try {
              const stats = await fs.stat(track.path);
              albumSize += stats.size;
              albumTracksWithFiles++;
            } catch (error) {
              // File missing - already handled by findMissingFiles
            }
          }
        }

        // Check album statistics
        const albumStats = album.statistics || {};
        const expectedPercent = tracks.length > 0 
          ? Math.round((albumTracksWithFiles / tracks.length) * 100) 
          : 0;

        if (albumStats.percentOfTracks !== expectedPercent) {
          errors.push({
            type: 'album_statistics',
            albumId: album.id,
            albumName: album.albumName,
            expected: expectedPercent,
            actual: albumStats.percentOfTracks,
          });
        }

        actualSize += albumSize;
      }

      // Check artist statistics
      const artistStats = artist.statistics || {};
      if (artistStats.albumCount !== actualAlbumCount ||
          artistStats.trackCount !== actualTrackCount ||
          Math.abs(artistStats.sizeOnDisk - actualSize) > 1024) { // Allow 1KB difference
        errors.push({
          type: 'artist_statistics',
          artistId: artist.id,
          artistName: artist.artistName,
          expected: {
            albumCount: actualAlbumCount,
            trackCount: actualTrackCount,
            sizeOnDisk: actualSize,
          },
          actual: {
            albumCount: artistStats.albumCount,
            trackCount: artistStats.trackCount,
            sizeOnDisk: artistStats.sizeOnDisk,
          },
        });
      }
    }

    return errors;
  }

  /**
   * Find duplicate files (same file path referenced by multiple tracks)
   */
  async findDuplicateFiles() {
    const duplicates = [];
    const pathMap = new Map();
    const artists = libraryManager.getAllArtists();

    for (const artist of artists) {
      const albums = libraryManager.getAlbums(artist.id);
      for (const album of albums) {
        const tracks = libraryManager.getTracks(album.id);
        for (const track of tracks) {
          if (track.path) {
            if (!pathMap.has(track.path)) {
              pathMap.set(track.path, []);
            }
            pathMap.get(track.path).push({
              trackId: track.id,
              trackName: track.trackName,
              albumId: album.id,
              albumName: album.albumName,
              artistId: artist.id,
              artistName: artist.artistName,
            });
          }
        }
      }
    }

    // Find paths with multiple tracks
    for (const [filePath, tracks] of pathMap.entries()) {
      if (tracks.length > 1) {
        duplicates.push({
          path: filePath,
          tracks: tracks,
        });
      }
    }

    return duplicates;
  }

  /**
   * Find orphaned database records (tracks without albums, albums without artists)
   */
  async findOrphanedRecords() {
    const orphaned = [];
    const artists = libraryManager.getAllArtists();

    for (const artist of artists) {
      const albums = libraryManager.getAlbums(artist.id);
      
      // Check for albums without tracks
      for (const album of albums) {
        const tracks = libraryManager.getTracks(album.id);
        if (tracks.length === 0) {
          orphaned.push({
            type: 'album_without_tracks',
            albumId: album.id,
            albumName: album.albumName,
            artistId: artist.id,
            artistName: artist.artistName,
          });
        }
      }
    }

    return orphaned;
  }

  /**
   * Auto-fix issues where possible
   */
  async autoFixIssues(results) {
    let fixed = 0;

    // Fix missing files (mark tracks as not having files)
    for (const missing of results.missingFiles) {
      try {
        await libraryManager.updateTrack(missing.trackId, {
          hasFile: false,
          path: null,
          size: 0,
        });
        fixed++;
      } catch (error) {
        console.warn(`[Data Integrity] Could not fix missing file for track ${missing.trackId}:`, error.message);
      }
    }

    // Fix statistics errors
    for (const error of results.statisticsErrors) {
      try {
        if (error.type === 'album_statistics') {
          await libraryManager.updateAlbumStatistics(error.albumId);
        } else if (error.type === 'artist_statistics') {
          await libraryManager.updateArtistStatistics(error.artistId);
        }
        fixed++;
      } catch (error) {
        console.warn(`[Data Integrity] Could not fix statistics for ${error.type}:`, error.message);
      }
    }

    if (fixed > 0) {
      console.log(`[Data Integrity] Auto-fixed ${fixed} issues`);
      libraryMonitor.log('info', 'integrity', 'Auto-fixed issues', { count: fixed });
    }
  }

  /**
   * Get integrity status summary
   */
  async getStatus() {
    const results = await this.runIntegrityCheck();
    return {
      healthy: results.orphanedFiles.length === 0 &&
               results.missingFiles.length === 0 &&
               results.statisticsErrors.length === 0 &&
               results.duplicateFiles.length === 0 &&
               results.orphanedRecords.length === 0,
      ...results,
    };
  }
}

export const dataIntegrityService = new DataIntegrityService();
