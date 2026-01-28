import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { dbOps } from '../config/db-helpers.js';

class FileIntegrityService {
  constructor() {
    this.hashCache = new Map();
    this.verificationQueue = [];
    this.isProcessing = false;
    this.checksumInterval = null;
  }

  async calculateFileHash(filePath, algorithm = 'sha256') {
    try {
      const fileBuffer = await fs.readFile(filePath);
      const hash = crypto.createHash(algorithm);
      hash.update(fileBuffer);
      return hash.digest('hex');
    } catch (error) {
      console.error(`[FileIntegrity] Error calculating hash for ${filePath}:`, error.message);
      return null;
    }
  }

  async calculateFileHashStream(filePath, algorithm = 'sha256') {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(algorithm);
      const stream = fsSync.createReadStream(filePath);
      
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  async verifyFile(filePath, expectedHash = null, algorithm = 'sha256') {
    try {
      const stats = await fs.stat(filePath);
      const actualHash = await this.calculateFileHashStream(filePath, algorithm);
      
      const result = {
        filePath,
        exists: true,
        size: stats.size,
        actualHash,
        algorithm,
        isValid: true,
        issues: [],
      };

      if (expectedHash) {
        if (actualHash !== expectedHash) {
          result.isValid = false;
          result.issues.push({
            type: 'hash_mismatch',
            expected: expectedHash,
            actual: actualHash,
          });
        }
      }

      if (stats.size === 0) {
        result.isValid = false;
        result.issues.push({
          type: 'empty_file',
          message: 'File has zero bytes',
        });
      }

      const audioExtensions = ['.flac', '.mp3', '.m4a', '.aac', '.ogg', '.wav', '.opus'];
      const ext = path.extname(filePath).toLowerCase();
      if (audioExtensions.includes(ext)) {
        const minSizes = {
          '.flac': 100 * 1024,
          '.mp3': 50 * 1024,
          '.m4a': 50 * 1024,
          '.aac': 50 * 1024,
          '.ogg': 30 * 1024,
          '.wav': 100 * 1024,
          '.opus': 30 * 1024,
        };
        
        if (stats.size < (minSizes[ext] || 30 * 1024)) {
          result.issues.push({
            type: 'suspiciously_small',
            message: `File size ${stats.size} bytes is smaller than expected for ${ext}`,
          });
        }
      }

      return result;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {
          filePath,
          exists: false,
          isValid: false,
          issues: [{ type: 'file_not_found', message: 'File does not exist' }],
        };
      }
      throw error;
    }
  }

  async verifyAlbumFiles(albumPath, tracks = []) {
    const results = {
      albumPath,
      totalFiles: 0,
      validFiles: 0,
      invalidFiles: 0,
      missingFiles: 0,
      issues: [],
      files: [],
    };

    try {
      const files = await fs.readdir(albumPath);
      const audioExtensions = ['.flac', '.mp3', '.m4a', '.aac', '.ogg', '.wav', '.opus'];
      const audioFiles = files.filter(f => audioExtensions.includes(path.extname(f).toLowerCase()));

      results.totalFiles = audioFiles.length;

      for (const file of audioFiles) {
        const filePath = path.join(albumPath, file);
        const verification = await this.verifyFile(filePath);
        results.files.push(verification);

        if (verification.isValid && verification.issues.length === 0) {
          results.validFiles++;
        } else {
          results.invalidFiles++;
          results.issues.push(...verification.issues.map(issue => ({
            ...issue,
            file: file,
          })));
        }
      }

      if (tracks.length > 0) {
        const matchedTracks = new Set();
        
        for (const file of audioFiles) {
          const baseName = path.basename(file, path.extname(file)).toLowerCase();
          
          for (const track of tracks) {
            const trackName = (track.trackName || track.name || '').toLowerCase();
            if (baseName.includes(trackName) || trackName.includes(baseName)) {
              matchedTracks.add(track.id || track.mbid);
              break;
            }
          }
        }

        const missingTracks = tracks.filter(t => !matchedTracks.has(t.id || t.mbid));
        results.missingFiles = missingTracks.length;
        
        for (const missing of missingTracks) {
          results.issues.push({
            type: 'missing_track',
            trackName: missing.trackName || missing.name,
            trackNumber: missing.trackNumber,
          });
        }
      }

    } catch (error) {
      if (error.code === 'ENOENT') {
        results.issues.push({
          type: 'album_not_found',
          message: `Album directory not found: ${albumPath}`,
        });
      } else {
        throw error;
      }
    }

    return results;
  }

  async scanLibraryIntegrity(rootPath, options = {}) {
    const { maxFiles = 1000, includeHashes = false } = options;
    
    const results = {
      scannedAt: new Date().toISOString(),
      rootPath,
      totalArtists: 0,
      totalAlbums: 0,
      totalFiles: 0,
      validFiles: 0,
      issuesFound: 0,
      issues: [],
    };

    try {
      const artists = await fs.readdir(rootPath);
      
      for (const artist of artists.slice(0, 100)) {
        const artistPath = path.join(rootPath, artist);
        const artistStat = await fs.stat(artistPath).catch(() => null);
        
        if (!artistStat?.isDirectory()) continue;
        results.totalArtists++;

        const albums = await fs.readdir(artistPath).catch(() => []);
        
        for (const album of albums) {
          const albumPath = path.join(artistPath, album);
          const albumStat = await fs.stat(albumPath).catch(() => null);
          
          if (!albumStat?.isDirectory()) continue;
          results.totalAlbums++;

          if (results.totalFiles >= maxFiles) break;

          const albumResults = await this.verifyAlbumFiles(albumPath);
          results.totalFiles += albumResults.totalFiles;
          results.validFiles += albumResults.validFiles;
          
          if (albumResults.issues.length > 0) {
            results.issuesFound += albumResults.issues.length;
            results.issues.push({
              artist,
              album,
              path: albumPath,
              issues: albumResults.issues,
            });
          }
        }
        
        if (results.totalFiles >= maxFiles) break;
      }
    } catch (error) {
      results.issues.push({
        type: 'scan_error',
        message: error.message,
      });
    }

    return results;
  }

  async detectDuplicates(rootPath) {
    const hashMap = new Map();
    const duplicates = [];

    const scanDir = async (dirPath) => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          
          if (entry.isDirectory()) {
            await scanDir(fullPath);
          } else if (entry.isFile()) {
            const audioExtensions = ['.flac', '.mp3', '.m4a', '.aac', '.ogg', '.wav', '.opus'];
            if (audioExtensions.includes(path.extname(entry.name).toLowerCase())) {
              const stats = await fs.stat(fullPath);
              const sizeKey = `${stats.size}`;
              
              if (!hashMap.has(sizeKey)) {
                hashMap.set(sizeKey, []);
              }
              hashMap.get(sizeKey).push(fullPath);
            }
          }
        }
      } catch (error) {
      }
    };

    await scanDir(rootPath);

    for (const [size, files] of hashMap) {
      if (files.length > 1) {
        const hashes = new Map();
        
        for (const file of files) {
          const hash = await this.calculateFileHashStream(file).catch(() => null);
          if (hash) {
            if (!hashes.has(hash)) {
              hashes.set(hash, []);
            }
            hashes.get(hash).push(file);
          }
        }

        for (const [hash, duplicateFiles] of hashes) {
          if (duplicateFiles.length > 1) {
            duplicates.push({
              hash,
              size: parseInt(size),
              files: duplicateFiles,
            });
          }
        }
      }
    }

    return {
      scannedAt: new Date().toISOString(),
      rootPath,
      duplicateGroups: duplicates.length,
      duplicateFiles: duplicates.reduce((acc, d) => acc + d.files.length - 1, 0),
      duplicates,
    };
  }

  async findMissingTracks(artistId, albumId) {
    try {
      const { libraryManager } = await import('./libraryManager.js');
      
      const album = libraryManager.getAlbumById(albumId);
      if (!album || !album.path) {
        return { error: 'Album not found or has no path' };
      }

      const tracks = libraryManager.getTracks(albumId);
      const tracksWithoutFiles = tracks.filter(t => !t.hasFile || !t.path);
      
      return {
        albumId,
        albumName: album.albumName,
        albumPath: album.path,
        totalTracks: tracks.length,
        missingTracks: tracksWithoutFiles.length,
        tracks: tracksWithoutFiles.map(t => ({
          id: t.id,
          trackName: t.trackName,
          trackNumber: t.trackNumber,
        })),
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async getMissingTracksForArtist(artistId) {
    try {
      const { libraryManager } = await import('./libraryManager.js');
      
      const albums = libraryManager.getAlbums(artistId);
      const results = [];

      for (const album of albums) {
        const missing = await this.findMissingTracks(artistId, album.id);
        if (missing.missingTracks > 0) {
          results.push(missing);
        }
      }

      return {
        artistId,
        albumsWithMissingTracks: results.length,
        totalMissingTracks: results.reduce((acc, r) => acc + r.missingTracks, 0),
        albums: results,
      };
    } catch (error) {
      return { error: error.message };
    }
  }
}

export const fileIntegrityService = new FileIntegrityService();
