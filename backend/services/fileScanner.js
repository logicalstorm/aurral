import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { libraryManager } from './libraryManager.js';
import { musicbrainzRequest } from './apiClients.js';
import { libraryMonitor } from './libraryMonitor.js';

const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav', '.opus'];

export class FileScanner {
  constructor() {
    this.scanning = false;
  }

  async scanDirectory(dirPath, depth = 0, maxDepth = 5) {
    if (depth > maxDepth) return [];

    const files = [];
    try {
      // Check access first
      try {
        await fs.access(dirPath, fs.constants.R_OK);
      } catch (error) {
        if (error.code === 'EPERM' || error.code === 'EACCES') {
          console.error(`Permission denied: ${dirPath}. Check macOS Full Disk Access settings.`);
          return [];
        }
        throw error;
      }
      
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          const subFiles = await this.scanDirectory(fullPath, depth + 1, maxDepth);
          files.push(...subFiles);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (AUDIO_EXTENSIONS.includes(ext)) {
            try {
              const stats = await fs.stat(fullPath);
              files.push({
                path: fullPath,
                name: entry.name,
                size: stats.size,
                modified: stats.mtime,
                extension: ext,
              });
            } catch (error) {
              // Skip files we can't stat
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error.message);
    }
    
    return files;
  }

  async scanLibrary(discover = false) {
    if (this.scanning) {
      libraryMonitor.log('debug', 'scan', 'Scan already in progress, skipping');
      console.log('Scan already in progress');
      return;
    }

    this.scanning = true;
    libraryMonitor.log('info', 'scan', 'Starting library scan', { discover });
    const rootFolder = libraryManager.getRootFolder(); // Always /data
    
    // Ensure root folder exists
    try {
      await fs.mkdir(rootFolder, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        this.scanning = false;
        throw new Error(`Failed to create root folder "${rootFolder}": ${error.message}`);
      }
    }

    try {
      let artists = libraryManager.getAllArtists();
      
      // If discover mode is enabled, always run discovery to find files on disk
      // This ensures we discover files even if artists already exist
      if (discover) {
        console.log('Discovery mode: Scanning folder structure to discover artists/albums/tracks...');
        libraryMonitor.log('info', 'scan', 'Running discovery scan', { 
          existingArtists: artists.length,
        });
        const discovered = await this.discoverFromFolderStructure(rootFolder);
        console.log(`Discovered ${discovered.artistsCreated} artists, ${discovered.albumsCreated} albums, ${discovered.tracksCreated} tracks`);
        libraryMonitor.log('info', 'scan', 'Discovery scan complete', discovered);
        artists = libraryManager.getAllArtists();
        
        // After discovery, update statistics for all artists
        for (const artist of artists) {
          await libraryManager.updateArtistStatistics(artist.id);
        }
      }
      
      const allFiles = await this.scanDirectory(rootFolder);
      libraryMonitor.log('info', 'scan', `Found ${allFiles.length} audio files in library`);
      console.log(`Found ${allFiles.length} audio files`);
      
      // Match files to tracks
      let matchedCount = 0;
      for (const file of allFiles) {
        const matched = await this.matchFileToTrack(file, artists);
        if (matched) matchedCount++;
      }
      
      libraryMonitor.log('info', 'scan', `Matched ${matchedCount} files to tracks`, {
        totalFiles: allFiles.length,
        matched: matchedCount,
        unmatched: allFiles.length - matchedCount,
      });

      // Update statistics for all artists
      for (const artist of artists) {
        await libraryManager.updateArtistStatistics(artist.id);
      }
      
      libraryMonitor.log('info', 'scan', 'Library scan complete', {
        filesScanned: allFiles.length,
        artistsUpdated: artists.length,
        matchedFiles: matchedCount,
      });

      return { 
        filesScanned: allFiles.length, 
        artistsUpdated: artists.length,
        artists: artists.length,
        matchedFiles: matchedCount,
      };
    } catch (error) {
      // Re-throw with more context
      if (error.message && error.message.includes('Permission denied')) {
        throw error;
      }
      throw new Error(`Library scan failed: ${error.message}`);
    } finally {
      this.scanning = false;
    }
  }

  async discoverFromFolderStructure(rootFolder) {
    let artistsCreated = 0;
    let albumsCreated = 0;
    let tracksCreated = 0;
    
    // Create root folder if it doesn't exist
    try {
      await fs.mkdir(rootFolder, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw new Error(`Failed to create root folder "${rootFolder}": ${error.message}`);
      }
    }
    
    // Check if the directory is accessible
    try {
      await fs.access(rootFolder, fs.constants.R_OK);
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        throw new Error(
          `Permission denied accessing "${rootFolder}". ` +
          `On macOS, you may need to grant Full Disk Access to Terminal/Node.js in System Settings > Privacy & Security > Full Disk Access. ` +
          `Alternatively, use a path within your home directory.`
        );
      }
      throw error;
    }
    
    try {
      const entries = await fs.readdir(rootFolder, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const artistFolderPath = path.join(rootFolder, entry.name);
        const artistName = entry.name;
        
        // Check if folder is empty
        let isEmpty = false;
        try {
          const folderContents = await fs.readdir(artistFolderPath);
          isEmpty = folderContents.length === 0;
          if (isEmpty) {
            console.log(`Found empty folder: ${artistName}`);
          }
        } catch (error) {
          // If we can't read the folder, skip it
          console.warn(`Cannot read folder ${artistName}:`, error.message);
          continue;
        }
        
        // Try to find artist MBID by searching MusicBrainz
        let mbid = null;
        try {
          const searchResult = await musicbrainzRequest('/artist', {
            query: artistName,
            limit: 1,
          });
          
          if (searchResult.artists && searchResult.artists.length > 0) {
            mbid = searchResult.artists[0].id;
            console.log(`Found MusicBrainz match for "${artistName}": ${mbid}`);
          }
        } catch (error) {
          console.warn(`Failed to search MusicBrainz for "${artistName}":`, error.message);
        }
        
        // If folder is empty and no MBID found, skip it (don't create artists with generated UUIDs for empty folders)
        if (isEmpty && !mbid) {
          console.log(`Skipping empty folder "${artistName}" - no MusicBrainz match found`);
          continue;
        }
        
        // If no MBID found but folder has content, generate a valid UUID
        if (!mbid) {
          mbid = randomUUID();
          console.log(`No MusicBrainz match for "${artistName}", using generated UUID: ${mbid}`);
        }
        
        // Check if artist already exists (by mbid or by name in case mbid was generated)
        let artist = libraryManager.getArtist(mbid);
        
        // Also check if an artist with this name already exists (in case MBID was generated)
        if (!artist) {
          const allArtists = libraryManager.getAllArtists();
          const existingByName = allArtists.find(a => 
            a.artistName.toLowerCase() === artistName.toLowerCase()
          );
          if (existingByName) {
            console.log(`Artist "${artistName}" already exists with different MBID, skipping discovery`);
            continue;
          }
        }
        
        if (!artist) {
          try {
            artist = await libraryManager.addArtist(mbid, artistName, {});
            artistsCreated++;
            console.log(`Created artist: ${artistName}`);
          } catch (error) {
            console.warn(`Failed to create artist "${artistName}":`, error.message);
            continue;
          }
        }
        
        // Discover albums in artist folder (skip if folder is empty - we already added the artist above)
        if (!isEmpty) {
          try {
            const albumEntries = await fs.readdir(artistFolderPath, { withFileTypes: true });
            
            // If folder only contains empty subdirectories or no audio files, skip album discovery
            const hasAudioFiles = albumEntries.some(e => 
              !e.isDirectory() && AUDIO_EXTENSIONS.includes(path.extname(e.name).toLowerCase())
            );
            
            // Check if there are any non-empty subdirectories
            let hasNonEmptyDirs = false;
            for (const entry of albumEntries) {
              if (entry.isDirectory()) {
                try {
                  const subEntries = await fs.readdir(path.join(artistFolderPath, entry.name));
                  if (subEntries.length > 0) {
                    hasNonEmptyDirs = true;
                    break;
                  }
                } catch {
                  // Skip if we can't read the subdirectory
                }
              }
            }
            
            if (!hasAudioFiles && !hasNonEmptyDirs) {
              console.log(`Artist folder "${artistName}" has no audio files or non-empty subdirectories - artist added but no albums discovered`);
              // Artist was already added above, so continue to next artist folder
              continue;
            }
          
            // Check if there are audio files directly in artist folder (no album structure)
            const directFiles = albumEntries.filter(e => 
              !e.isDirectory() && AUDIO_EXTENSIONS.includes(path.extname(e.name).toLowerCase())
            );
          
            if (directFiles.length > 0 && albumEntries.filter(e => e.isDirectory()).length === 0) {
              // All files are directly in artist folder, create a single "Unknown Album"
              const albumName = 'Unknown Album';
              const releaseGroupMbid = randomUUID();
              const albums = libraryManager.getAlbums(artist.id);
              let album = albums.find(a => a.albumName === albumName);
              
              if (!album) {
                try {
                  album = await libraryManager.addAlbum(artist.id, releaseGroupMbid, albumName, {});
                  albumsCreated++;
                  console.log(`  Created album: ${albumName} (for ${directFiles.length} files)`);
                } catch (error) {
                  console.warn(`  Failed to create album "${albumName}":`, error.message);
                }
              }
              
              if (album) {
                // Add all direct files as tracks
                for (const fileEntry of directFiles) {
                  const trackFilePath = path.join(artistFolderPath, fileEntry.name);
                  const trackFileName = path.basename(fileEntry.name, path.extname(fileEntry.name));
                  const parsed = this.parseFileName(trackFileName);
                  
                  const tracks = libraryManager.getTracks(album.id);
                  const existingTrack = tracks.find(t => {
                    const trackNameLower = t.trackName.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const fileNameLower = parsed.trackName.toLowerCase().replace(/[^a-z0-9]/g, '');
                    return trackNameLower === fileNameLower || 
                           trackNameLower.includes(fileNameLower) || 
                           fileNameLower.includes(trackNameLower);
                  });
                  
                  if (!existingTrack) {
                    try {
                      const trackMbid = randomUUID();
                      const stats = await fs.stat(trackFilePath);
                      const track = await libraryManager.addTrack(
                        album.id, 
                        trackMbid, 
                        parsed.trackName, 
                        parsed.trackNumber || 0
                      );
                      
                      await libraryManager.updateTrack(track.id, {
                        path: trackFilePath,
                        hasFile: true,
                        size: stats.size,
                      });
                      
                      tracksCreated++;
                    } catch (error) {
                      // Track might already exist
                    }
                  }
                }
              }
            }
          
            // Process album subfolders
            for (const albumEntry of albumEntries) {
              if (!albumEntry.isDirectory()) continue;
              
              const albumFolderPath = path.join(artistFolderPath, albumEntry.name);
              const albumName = albumEntry.name;
              
              // Try to find release group MBID
              let releaseGroupMbid = null;
              try {
                const searchResult = await musicbrainzRequest('/release-group', {
                  query: `${albumName} AND arid:${mbid}`,
                  limit: 1,
                });
                
                if (searchResult['release-groups'] && searchResult['release-groups'].length > 0) {
                  releaseGroupMbid = searchResult['release-groups'][0].id;
                }
              } catch (error) {
                // Ignore search errors
              }
              
              if (!releaseGroupMbid) {
                releaseGroupMbid = randomUUID();
              }
              
              // Check if album already exists
              const albums = libraryManager.getAlbums(artist.id);
              let album = albums.find(a => a.albumName === albumName);
              
              if (!album) {
                try {
                  album = await libraryManager.addAlbum(artist.id, releaseGroupMbid, albumName, {});
                  albumsCreated++;
                  console.log(`  Created album: ${albumName}`);
                } catch (error) {
                  console.warn(`  Failed to create album "${albumName}":`, error.message);
                  continue;
                }
              }
              
              // Discover tracks in album folder
              try {
                const trackEntries = await fs.readdir(albumFolderPath, { withFileTypes: true });
                
                for (const trackEntry of trackEntries) {
                  if (trackEntry.isDirectory()) continue;
                  
                  const ext = path.extname(trackEntry.name).toLowerCase();
                  if (!AUDIO_EXTENSIONS.includes(ext)) continue;
                  
                  const trackFilePath = path.join(albumFolderPath, trackEntry.name);
                  const trackFileName = path.basename(trackEntry.name, ext);
                  const parsed = this.parseFileName(trackFileName);
                  
                  // Check if track already exists
                  const tracks = libraryManager.getTracks(album.id);
                  const existingTrack = tracks.find(t => {
                    const trackNameLower = t.trackName.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const fileNameLower = parsed.trackName.toLowerCase().replace(/[^a-z0-9]/g, '');
                    return trackNameLower === fileNameLower || 
                           trackNameLower.includes(fileNameLower) || 
                           fileNameLower.includes(trackNameLower);
                  });
                  
                  if (!existingTrack) {
                    try {
                      const trackMbid = randomUUID();
                      const stats = await fs.stat(trackFilePath);
                      const track = await libraryManager.addTrack(
                        album.id, 
                        trackMbid, 
                        parsed.trackName, 
                        parsed.trackNumber || 0
                      );
                      
                      await libraryManager.updateTrack(track.id, {
                        path: trackFilePath,
                        hasFile: true,
                        size: stats.size,
                      });
                      
                      tracksCreated++;
                    } catch (error) {
                      // Track might already exist or other error
                    }
                  } else {
                    // Update existing track with file info
                    try {
                      const stats = await fs.stat(trackFilePath);
                      await libraryManager.updateTrack(existingTrack.id, {
                        path: trackFilePath,
                        hasFile: true,
                        size: stats.size,
                      });
                    } catch (error) {
                      // Ignore errors
                    }
                  }
                }
              } catch (error) {
                console.warn(`  Failed to scan tracks in "${albumName}":`, error.message);
              }
            }
          } catch (error) {
            console.warn(`Failed to scan albums for "${artistName}":`, error.message);
          }
        }
      }
    } catch (error) {
      if (error.message && error.message.includes('Permission denied')) {
        throw error; // Re-throw permission errors with helpful message
      }
      console.error('Error discovering from folder structure:', error.message);
      throw error;
    }
    
    return { artistsCreated, albumsCreated, tracksCreated };
  }

  /**
   * Read metadata from audio file
   */
  async readFileMetadata(filePath) {
    try {
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
        return null; // music-metadata not available
      }
      // Silently fail - metadata reading is optional
      return null;
    }
  }

  /**
   * Calculate Levenshtein distance for fuzzy matching
   */
  levenshteinDistance(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix = [];

    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j - 1] + 1
          );
        }
      }
    }

    return matrix[len1][len2];
  }

  /**
   * Calculate similarity score between two strings (0-100)
   */
  calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    const normalized1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalized2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    if (normalized1 === normalized2) return 100;
    if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) return 90;
    
    const distance = this.levenshteinDistance(normalized1, normalized2);
    const maxLength = Math.max(normalized1.length, normalized2.length);
    if (maxLength === 0) return 100;
    
    return Math.max(0, 100 - (distance / maxLength) * 100);
  }

  /**
   * Match file to track using multiple strategies
   * Returns: { matched: boolean, track: Track | null, confidence: number, method: string }
   */
  async matchFileToTrack(file, artists) {
    const pathParts = file.path.split(path.sep);
    const fileName = path.basename(file.path, file.extension);
    
    // Strategy 1: Filename-based matching (fast, existing logic)
    let bestMatch = null;
    let bestConfidence = 0;
    let bestMethod = 'none';
    
    // Find matching artist by folder name
    for (const artist of artists) {
      const artistFolderName = path.basename(artist.path);
      const artistIndex = pathParts.indexOf(artistFolderName);
      
      if (artistIndex === -1) continue;

      // Try to find album
      const albums = libraryManager.getAlbums(artist.id);
      for (const album of albums) {
        const albumFolderName = path.basename(album.path);
        if (pathParts.includes(albumFolderName) || (pathParts.length > artistIndex + 1 && pathParts[artistIndex + 1] === albumFolderName)) {
          // Try to match track
          const tracks = libraryManager.getTracks(album.id);
          for (const track of tracks) {
            // Filename matching
            const trackNameLower = track.trackName.toLowerCase().replace(/[^a-z0-9]/g, '');
            const fileNameLower = fileName.toLowerCase().replace(/[^a-z0-9]/g, '');
            
            let confidence = 0;
            let method = 'filename';
            
            if (trackNameLower === fileNameLower) {
              confidence = 100;
            } else if (fileNameLower.includes(trackNameLower) || trackNameLower.includes(fileNameLower)) {
              confidence = 85;
            } else {
              // Fuzzy matching
              confidence = this.calculateSimilarity(track.trackName, fileName);
              method = 'fuzzy';
            }
            
            if (confidence > bestConfidence && confidence >= 60) {
              bestMatch = { track, album, artist };
              bestConfidence = confidence;
              bestMethod = method;
            }
          }
        }
      }
    }
    
    // Strategy 2: Metadata-based matching (more accurate but slower)
    let metadataMatch = null;
    let metadataConfidence = 0;
    try {
      const metadata = await this.readFileMetadata(file.path);
      
      if (metadata && metadata.artist && metadata.title) {
        // Find artist by metadata
        for (const artist of artists) {
          const artistSimilarity = this.calculateSimilarity(artist.artistName, metadata.artist);
          
          if (artistSimilarity >= 70) {
            const albums = libraryManager.getAlbums(artist.id);
            
            // Find album by metadata
            for (const album of albums) {
              const albumSimilarity = metadata.album 
                ? this.calculateSimilarity(album.albumName, metadata.album)
                : 50; // If no album in metadata, give partial score
              
              if (albumSimilarity >= 50) {
                const tracks = libraryManager.getTracks(album.id);
                
                // Find track by metadata title
                for (const track of tracks) {
                  const trackSimilarity = this.calculateSimilarity(track.trackName, metadata.title);
                  
                  // Combined confidence: artist + album + track
                  const combinedConfidence = (artistSimilarity * 0.3) + (albumSimilarity * 0.2) + (trackSimilarity * 0.5);
                  
                  if (combinedConfidence > metadataConfidence && combinedConfidence >= 70) {
                    metadataMatch = { track, album, artist };
                    metadataConfidence = combinedConfidence;
                  }
                }
              }
            }
          }
        }
      }
    } catch (error) {
      // Metadata reading failed - continue with filename matching
    }
    
    // Choose best match (prefer metadata if confidence is high enough)
    let finalMatch = null;
    if (metadataMatch && metadataConfidence >= 80) {
      finalMatch = metadataMatch;
      bestConfidence = metadataConfidence;
      bestMethod = 'metadata';
    } else if (bestMatch && bestConfidence >= 60) {
      finalMatch = bestMatch;
    }
    
    if (finalMatch) {
      const { track, album, artist } = finalMatch;
      const wasMatched = track.hasFile;
      
      await libraryManager.updateTrack(track.id, {
        path: file.path,
        hasFile: true,
        size: file.size,
      });
      
      if (!wasMatched) {
        libraryMonitor.log('info', 'library', 'File matched to track', {
          file: file.name,
          trackId: track.id,
          trackName: track.trackName,
          albumId: album.id,
          albumName: album.albumName,
          artistId: artist.id,
          artistName: artist.artistName,
          confidence: Math.round(bestConfidence),
          method: bestMethod,
        });
      }
      
      return true; // File was matched
    }
    
    // Strategy 3: If no match but file is in album folder, create track entry
    for (const artist of artists) {
      const artistFolderName = path.basename(artist.path);
      const artistIndex = pathParts.indexOf(artistFolderName);
      
      if (artistIndex === -1) continue;

      const albums = libraryManager.getAlbums(artist.id);
      for (const album of albums) {
        const albumFolderName = path.basename(album.path);
        if (pathParts.includes(albumFolderName) || (pathParts.length > artistIndex + 1 && pathParts[artistIndex + 1] === albumFolderName)) {
          const tracks = libraryManager.getTracks(album.id);
          
          // Only create if no tracks exist (file might be for a track we haven't fetched yet)
          if (tracks.length === 0) {
            const parsed = this.parseFileName(fileName);
            try {
              await libraryManager.addTrack(album.id, this.generateId(), parsed.trackName, parsed.trackNumber || 0);
              const newTracks = libraryManager.getTracks(album.id);
              const newTrack = newTracks[newTracks.length - 1];
              if (newTrack) {
                await libraryManager.updateTrack(newTrack.id, {
                  path: file.path,
                  hasFile: true,
                  size: file.size,
                });
                return true; // File was matched
              }
            } catch (err) {
              // Track might already exist
            }
          }
        }
      }
    }
    
    return false; // File was not matched
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  parseFileName(fileName) {
    // Try to extract artist, album, track info from filename
    // Common patterns: "Artist - Album - Track.mp3", "01 Track.mp3", etc.
    const patterns = [
      /^(\d+)\s*[-.]?\s*(.+)$/, // "01 Track" or "01 - Track"
      /^(.+?)\s*-\s*(.+?)\s*-\s*(.+)$/, // "Artist - Album - Track"
      /^(.+?)\s*-\s*(.+)$/, // "Artist - Track"
    ];

    for (const pattern of patterns) {
      const match = fileName.match(pattern);
      if (match) {
        return {
          trackNumber: match[1] ? parseInt(match[1]) : null,
          trackName: match[match.length - 1]?.trim() || fileName,
        };
      }
    }

    return { trackName: fileName };
  }
}

export const fileScanner = new FileScanner();
