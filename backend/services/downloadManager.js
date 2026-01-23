import { slskdClient } from './slskdClient.js';
import { libraryManager } from './libraryManager.js';
import { fileScanner } from './fileScanner.js';
import { db } from '../config/db.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { queueCleaner } from './queueCleaner.js';
import { libraryMonitor } from './libraryMonitor.js';

// Get __dirname for .env file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class DownloadManager {
  constructor() {
    this.checkingDownloads = false;
    this.slskdDownloadDir = null; // Cache the download directory
    this.remotePathMapping = null; // Cache remote path mapping if configured
    this.startDownloadMonitor();
    this.initializeDownloadDirectory();
  }

  // Recursively search for a file in a directory
  async findFileRecursively(dir, filename, maxDepth = 5, currentDepth = 0) {
    if (currentDepth >= maxDepth) {
      return null;
    }
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        // Check if filename matches (case-insensitive for better matching)
        if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
          return fullPath;
        } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
          // Skip common system directories
          if (entry.name === 'node_modules' || entry.name === '.git') {
            continue;
          }
          const found = await this.findFileRecursively(fullPath, filename, maxDepth, currentDepth + 1);
          if (found) {
            return found;
          }
        }
      }
    } catch (error) {
      // Directory doesn't exist or permission error - skip
      if (currentDepth === 0) {
        console.warn(`Error reading directory ${dir} for recursive search:`, error.message);
      }
    }
    
    return null;
  }

  // Map remote path to local path (for Docker/remote setups)
  mapRemotePath(remotePath) {
    if (!remotePath) return null;
    
    // If remote path mapping is configured, use it
    if (this.remotePathMapping) {
      const { remote, local } = this.remotePathMapping;
      if (remotePath.startsWith(remote)) {
        return remotePath.replace(remote, local);
      }
    }
    
    // Check environment variable for remote path mapping
    // Format: REMOTE_PATH:local_path (e.g., /mnt/downloads:/data/downloads)
    const pathMapping = process.env.SLSKD_REMOTE_PATH_MAPPING;
    if (pathMapping) {
      const [remote, local] = pathMapping.split(':').map(p => p.trim());
      if (remote && local && remotePath.startsWith(remote)) {
        return remotePath.replace(remote, local);
      }
    }
    
    return remotePath;
  }

  async initializeDownloadDirectory() {
    // Load .env file explicitly to ensure we get the variable
    // Use the same path resolution as server.js
    try {
      const dotenv = await import('dotenv');
      // __dirname is the services directory, so go up to backend, then .env
      const envPath = path.join(__dirname, '..', '.env');
      const envConfig = dotenv.config({ path: envPath });
      
      // Merge parsed env with process.env
      if (envConfig.parsed) {
        Object.assign(process.env, envConfig.parsed);
        console.log(`Loaded .env file from: ${envPath}`);
      }
    } catch (err) {
      console.warn('Could not load .env file:', err.message);
    }
    
    // Check environment variable - prefer COMPLETE_DIR, fallback to DOWNLOAD_DIR + /complete
    let completeDir = process.env.SLSKD_COMPLETE_DIR;
    
    if (!completeDir && process.env.SLSKD_DOWNLOAD_DIR) {
      // If DOWNLOAD_DIR is set, append /complete to it
      completeDir = path.join(process.env.SLSKD_DOWNLOAD_DIR, 'complete');
    }
    
    if (completeDir) {
      this.slskdDownloadDir = completeDir; // Store the complete directory path
    } else {
      // Try to get download directory from slskd API
      if (slskdClient.isConfigured()) {
        try {
          const dir = await slskdClient.getDownloadDirectory();
          if (dir) {
            this.slskdDownloadDir = dir;
          }
        } catch (error) {
          console.warn('Could not get download directory from slskd:', error.message);
        }
      }
      
      // Final fallback
      if (!this.slskdDownloadDir) {
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        const defaultDownloadsDir = homeDir ? path.join(homeDir, '.slskd', 'downloads') : '/tmp';
        this.slskdDownloadDir = path.join(defaultDownloadsDir, 'complete');
      }
    }
  }

  startDownloadMonitor() {
    // Check downloads every 10 seconds for more responsive updates
    setInterval(() => {
      this.checkCompletedDownloads();
    }, 10000);
  }

  // Helper function to normalize download state across different slskd API versions
  normalizeState(state) {
    if (!state) return 'unknown';
    const stateStr = String(state).toLowerCase();
    if (stateStr.includes('completed') || stateStr === 'complete') return 'completed';
    if (stateStr.includes('failed') || stateStr === 'error') return 'failed';
    if (stateStr.includes('cancelled') || stateStr === 'canceled') return 'cancelled';
    if (stateStr.includes('downloading') || stateStr === 'inprogress' || stateStr === 'in progress') return 'downloading';
    // Handle various queued states: "Queued", "Queued, Remotely", "Queued, Locally", etc.
    if (stateStr.includes('queued') || stateStr === 'pending' || stateStr.includes('remotely') || stateStr.includes('locally')) return 'queued';
    return stateStr;
  }

  async checkCompletedDownloads() {
    if (this.checkingDownloads || !slskdClient.isConfigured()) {
      return;
    }

    this.checkingDownloads = true;
    try {
      let downloads = await slskdClient.getDownloads();
      
      // If downloads is still nested (user objects with directories), flatten it
      if (Array.isArray(downloads) && downloads.length > 0) {
        const firstItem = downloads[0];
        if (firstItem && typeof firstItem === 'object' && firstItem.directories && !firstItem.id && !firstItem.state) {
          // This is a user object, not a download file - flatten it
          const flattened = [];
          for (const userObj of downloads) {
            if (userObj.directories && Array.isArray(userObj.directories)) {
              for (const dir of userObj.directories) {
                if (dir.files && Array.isArray(dir.files)) {
                  flattened.push(...dir.files);
                }
              }
            }
          }
          if (flattened.length > 0) {
            downloads = flattened;
          }
        }
      }
      
      // Get our tracked downloads that are still in progress
      const trackedDownloads = (db.data.downloads || []).filter(d => d.status === 'downloading');
      
      // Check for completed downloads that we haven't processed yet
      const trackedCount = trackedDownloads.length;
      libraryMonitor.log('debug', 'download', `Checking ${downloads.length} downloads from slskd (${trackedCount} tracked as downloading)`);
      let completedCount = 0;
      let processedCount = 0;
      
      // Log all download states for debugging (only if there are downloads)
      if (downloads.length > 0) {
        const stateCounts = {};
        for (const download of downloads) {
          // Check multiple possible field names for state
          const state = download.state || download.status || download.State || download.Status || 'unknown';
          stateCounts[state] = (stateCounts[state] || 0) + 1;
        }
        // If all are unknown, log a warning
        if (stateCounts.unknown === downloads.length && downloads.length > 0) {
          console.warn(`⚠ All downloads show as 'unknown' state. Check slskd API response structure.`);
        }
      }

      for (const download of downloads) {
        // Check multiple possible field names for state (handle both camelCase and PascalCase)
        const state = download.state || download.status || download.State || download.Status;
        const normalizedState = this.normalizeState(state);
        
        if (normalizedState === 'completed') {
          completedCount++;
          // Check if we've already processed this download
          const downloadIdStr = download.id?.toString();
          const downloadRecord = (db.data.downloads || []).find(
            d => {
              const recordIdStr = d.slskdDownloadId?.toString();
              return (recordIdStr === downloadIdStr || 
                      d.slskdDownloadId === download.id) && 
                      d.status === 'completed';
            }
          );
          
          if (!downloadRecord) {
            libraryMonitor.log('info', 'download', `Found completed download`, {
              downloadId: download.id,
              filename: download.filename || 'unknown',
              state: state,
            });
            await this.handleCompletedDownload(download);
            processedCount++;
          }
        }
      }
      
      
      // Check for failed/stalled downloads and handle retries
      for (const trackedDownload of trackedDownloads) {
        // Find the corresponding slskd download
        const slskdDownload = downloads.find(
          d => d.id === trackedDownload.slskdDownloadId || d.id?.toString() === trackedDownload.slskdDownloadId
        );
        
        if (!slskdDownload) {
          // Download not found in slskd - might have completed and been removed, or failed
          // First check if it was recently completed (within last 2 minutes) - might just be processing
          const startedAt = new Date(trackedDownload.startedAt);
          const now = new Date();
          const minutesElapsed = (now - startedAt) / (1000 * 60);
          
          // Only retry if it's been more than 10 minutes (give it time to complete and be processed)
          // And only if we haven't already retried too many times
          if (minutesElapsed > 10 && (trackedDownload.retryCount || 0) < 3) {
            console.log(
              `Download ${trackedDownload.id} not found in slskd after ${Math.round(minutesElapsed)} minutes (retry ${trackedDownload.retryCount || 0}/3), marking for retry`,
            );
            await this.handleFailedDownload(trackedDownload);
          } else if (minutesElapsed > 10) {
            // Too many retries or too old - mark as failed
            console.log(
              `Download ${trackedDownload.id} not found after ${Math.round(minutesElapsed)} minutes and max retries reached, marking as failed`,
            );
            trackedDownload.status = 'failed';
            trackedDownload.failedAt = new Date().toISOString();
            await db.write();
          }
        } else {
          // Check download state with normalized state handling
          const state = slskdDownload.state || slskdDownload.status;
          const normalizedState = this.normalizeState(state);
          
          if (normalizedState === 'completed') {
            // Download is completed but we haven't processed it yet - handle it
            console.log(`Found completed download in tracked list: ${trackedDownload.id}, state: ${state}`);
            await this.handleCompletedDownload(slskdDownload);
          } else if (normalizedState === 'failed' || normalizedState === 'cancelled') {
            console.log(`Download ${trackedDownload.id} failed with state: ${state}`);
            await this.handleFailedDownload(trackedDownload, slskdDownload);
          } else if (normalizedState === 'downloading' || normalizedState === 'queued') {
            // Update progress if available
            const progress = slskdDownload.percentComplete || 
                           slskdDownload.progress || 
                           slskdDownload.percentComplete || 
                           0;
            
            // Update progress tracking
            if (trackedDownload.progress !== progress) {
              trackedDownload.progress = progress;
              trackedDownload.lastChecked = new Date().toISOString();
              trackedDownload.lastState = state;
              await db.write();
            }
            
            // Check if download is stalled (no progress for > 10 minutes)
            const lastChecked = trackedDownload.lastChecked 
              ? new Date(trackedDownload.lastChecked) 
              : new Date(trackedDownload.startedAt);
            const minutesSinceUpdate = (new Date() - lastChecked) / (1000 * 60);
            
            // Also check if progress hasn't changed in a while
            const lastProgress = trackedDownload.lastProgress || 0;
            const progressStalled = progress === lastProgress && progress < 100;
            
            if ((minutesSinceUpdate > 10 && progress < 100) || (progressStalled && minutesSinceUpdate > 15)) {
              console.log(
                `Download ${trackedDownload.id} appears stalled (${progress}% complete, no update for ${Math.round(minutesSinceUpdate)} minutes, state: ${state})`,
              );
              trackedDownload.lastProgress = progress;
              await this.handleStalledDownload(trackedDownload, slskdDownload);
            } else if (progress !== lastProgress) {
              // Progress changed, update last progress
              trackedDownload.lastProgress = progress;
              await db.write();
            }
          } else {
            // Unknown state - log for debugging
            if (state !== trackedDownload.lastState) {
              console.log(`Download ${trackedDownload.id} state changed: ${state}`);
              trackedDownload.lastState = state;
              await db.write();
            }
          }
        }
      }
    } catch (error) {
      // Only log errors that aren't 404s (which might be expected if slskd endpoint doesn't exist)
      if (error.response?.status !== 404) {
        console.error('Error checking downloads:', error.message);
      }
    } finally {
      this.checkingDownloads = false;
    }
  }

  async handleCompletedDownload(download) {
    try {
      libraryMonitor.log('info', 'download', `Processing completed download`, {
        downloadId: download.id,
        filename: download.filename,
        username: download.username,
      });
      
      // slskd download object structure may vary
      // Try multiple possible path fields
      let sourcePath = download.filePath || download.destinationPath || download.path || download.file;
      
      // If path not in download object, try to construct it from filename
      // slskd typically stores completed downloads in a "complete" or "downloads" folder
      if (!sourcePath && download.filename) {
        // Get slskd download directory - try API first, then environment, then defaults
        let slskdDownloadDir = this.slskdDownloadDir;
        
        if (!slskdDownloadDir) {
          // Try to get it from API if we haven't cached it yet
          try {
            slskdDownloadDir = await slskdClient.getDownloadDirectory();
            if (slskdDownloadDir) {
              this.slskdDownloadDir = slskdDownloadDir;
            }
          } catch (error) {
            // Fall through to environment/defaults
          }
        }
        
        // Fallback to environment or common locations
        if (!slskdDownloadDir) {
          // Prefer COMPLETE_DIR, fallback to DOWNLOAD_DIR + /complete
          let completeDir = process.env.SLSKD_COMPLETE_DIR;
          
          if (!completeDir && process.env.SLSKD_DOWNLOAD_DIR) {
            completeDir = path.join(process.env.SLSKD_DOWNLOAD_DIR, 'complete');
          }
          
          // If still not found, try loading .env directly
          if (!completeDir) {
            try {
              const dotenv = await import('dotenv');
              // Use same path resolution as initializeDownloadDirectory
              const envPath = path.join(__dirname, '..', '.env');
              const envConfig = dotenv.config({ path: envPath });
              if (envConfig.parsed) {
                if (envConfig.parsed.SLSKD_COMPLETE_DIR) {
                  completeDir = envConfig.parsed.SLSKD_COMPLETE_DIR;
                } else if (envConfig.parsed.SLSKD_DOWNLOAD_DIR) {
                  completeDir = path.join(envConfig.parsed.SLSKD_DOWNLOAD_DIR, 'complete');
                }
              }
            } catch (err) {
              // Ignore
            }
          }
          
          // Final fallback
          if (!completeDir) {
            const homeDir = process.env.HOME || process.env.USERPROFILE || '';
            const defaultDownloadsDir = homeDir ? path.join(homeDir, '.slskd', 'downloads') : '/tmp';
            completeDir = path.join(defaultDownloadsDir, 'complete');
          }
          
          slskdDownloadDir = completeDir;
        }
        
        // Also check incomplete directory - slskd may store completed files there
        // until they're moved to complete directory
        let incompleteDir = null;
        if (slskdDownloadDir) {
          // Try to find incomplete directory relative to complete directory
          const parentDir = path.dirname(slskdDownloadDir);
          incompleteDir = path.join(parentDir, 'incomplete');
          
          // Build list of possible incomplete directories
          const possibleIncompleteDirs = [incompleteDir];
          
          // Try loading from .env directly
          try {
            const dotenv = await import('dotenv');
            const envPath = path.join(__dirname, '..', '.env');
            const envConfig = dotenv.config({ path: envPath });
            if (envConfig.parsed?.SLSKD_DOWNLOAD_DIR) {
              possibleIncompleteDirs.push(path.join(envConfig.parsed.SLSKD_DOWNLOAD_DIR, 'incomplete'));
            }
            if (envConfig.parsed?.SLSKD_COMPLETE_DIR) {
              const completeParent = path.dirname(envConfig.parsed.SLSKD_COMPLETE_DIR);
              possibleIncompleteDirs.push(path.join(completeParent, 'incomplete'));
            }
          } catch (err) {
            // Ignore
          }
          
          // Also try environment variables
          if (process.env.SLSKD_DOWNLOAD_DIR) {
            possibleIncompleteDirs.push(path.join(process.env.SLSKD_DOWNLOAD_DIR, 'incomplete'));
          }
          
          // Check which one exists
          for (const dir of possibleIncompleteDirs) {
            try {
              await fs.access(dir);
              incompleteDir = dir;
              break;
            } catch (err) {
              // Doesn't exist, try next
            }
          }
          
          if (!incompleteDir) {
          }
        }
        
        // Cache it for next time
        this.slskdDownloadDir = slskdDownloadDir;
        
        
        // Try multiple possible path structures
        // slskdDownloadDir now points directly to the complete folder
        const filename = download.filename.replace(/\\/g, '/'); // Normalize path separators
        const justFilename = path.basename(filename); // Get just the filename
        
        // slskd may preserve the directory structure from the remote path
        // Remove @@ prefix if present (slskd special marker)
        let cleanPath = filename.replace(/^@@[^\/\\]+[\/\\]/, ''); // Remove @@username/ prefix
        cleanPath = cleanPath.replace(/^@@/, ''); // Remove standalone @@
        
        // Files are directly in the complete directory: {completeDir}/{filename}
        // Also check incomplete directory - slskd may store files there even when marked complete
        const possiblePaths = [
          // Full path structure (without @@ prefix) in complete dir
          path.join(slskdDownloadDir, cleanPath),
          // Full path structure (with original path) in complete dir
          path.join(slskdDownloadDir, filename),
          // Most common: directly in complete folder
          path.join(slskdDownloadDir, justFilename),
          // With username: {username}/{filename} in complete dir
          download.username ? path.join(slskdDownloadDir, download.username, justFilename) : null,
          // With username and full path in complete dir
          download.username ? path.join(slskdDownloadDir, download.username, cleanPath) : null,
          // If filename has path structure, try preserving just the filename
          filename.includes('/') ? path.join(slskdDownloadDir, filename.split(/[\\/]/).pop()) : null,
          // Also try incomplete directory (slskd may store completed files there)
          incompleteDir ? path.join(incompleteDir, cleanPath) : null,
          incompleteDir ? path.join(incompleteDir, filename) : null,
          incompleteDir ? path.join(incompleteDir, justFilename) : null,
          incompleteDir && download.username ? path.join(incompleteDir, download.username, justFilename) : null,
          incompleteDir && download.username ? path.join(incompleteDir, download.username, cleanPath) : null,
        ].filter(Boolean);
        
        
        // Try to find the file
        for (const possiblePath of possiblePaths) {
          try {
            // Try direct path first
            await fs.access(possiblePath);
            const stats = await fs.stat(possiblePath);
            if (stats.isFile()) {
              sourcePath = possiblePath;
              break;
            }
          } catch (err) {
            // Try remote path mapping if direct path failed
            const mappedPath = this.mapRemotePath(possiblePath);
            if (mappedPath && mappedPath !== possiblePath) {
              try {
                await fs.access(mappedPath);
                const stats = await fs.stat(mappedPath);
                if (stats.isFile()) {
                  sourcePath = mappedPath;
                  break;
                }
              } catch (mappedErr) {
                // Continue to next path
              }
            }
          }
        }
        
        // If still not found, try recursive search in downloads directory
        if (!sourcePath) {
          try {
            const foundFile = await this.findFileRecursively(slskdDownloadDir, justFilename);
            if (foundFile) {
              sourcePath = foundFile;
            }
          } catch (searchErr) {
            console.warn(`Recursive search failed:`, searchErr.message);
          }
        }
        
        // Also try recursive search in incomplete directory if it exists
        if (!sourcePath && incompleteDir) {
          try {
            // Check if incomplete directory exists
            try {
              await fs.access(incompleteDir);
              const foundFile = await this.findFileRecursively(incompleteDir, justFilename);
              if (foundFile) {
                sourcePath = foundFile;
              }
            } catch (accessErr) {
              // Incomplete directory doesn't exist or isn't accessible
            }
          } catch (searchErr) {
            console.warn(`Recursive search in incomplete directory failed:`, searchErr.message);
          }
        }
        
        // If still not found, log warning
        if (!sourcePath) {
          console.warn(`Could not locate downloaded file: ${justFilename}`);
        }
      }
      
      if (!sourcePath) {
        console.warn('Download completed but no file path available. Download object:', JSON.stringify(download, null, 2));
        return;
      }

      // Check if file exists
      try {
        await fs.access(sourcePath);
      } catch (error) {
        console.warn(`Downloaded file not found at ${sourcePath}`);
        return;
      }

      // Find our download record - try matching by ID (string or number)
      const downloadIdStr = download.id?.toString();
      const downloadId = download.id;
      
      // Try multiple matching strategies
      const downloadRecord = (db.data.downloads || []).find(
        d => {
          const recordIdStr = d.slskdDownloadId?.toString();
          const recordId = d.slskdDownloadId;
          
          // Try exact matches
          if (recordIdStr === downloadIdStr) return true;
          if (recordId === downloadId) return true;
          if (recordId === downloadIdStr) return true;
          if (recordIdStr === downloadId) return true;
          
          // Try matching by filename if IDs don't match (for retries)
          if (download.filename && d.filename) {
            const downloadFilename = download.filename.split(/[\\/]/).pop();
            const recordFilename = d.filename.split(/[\\/]/).pop();
            if (downloadFilename === recordFilename && 
                d.status === 'downloading' && 
                d.albumId) {
              return true;
            }
          }
          
          return false;
        }
      );
      
      if (!downloadRecord) {
        console.warn(`No download record found for slskd download ID: ${download.id} (${typeof download.id})`);
        console.warn(`Filename: ${download.filename || 'unknown'}`);
        console.warn(`Available download records (${(db.data.downloads || []).length} total, ${(db.data.downloads || []).filter(d => d.status === 'downloading').length} downloading):`, 
          (db.data.downloads || []).slice(0, 10).map(d => ({
            id: d.id,
            slskdDownloadId: d.slskdDownloadId,
            type: typeof d.slskdDownloadId,
            filename: d.filename?.split(/[\\/]/).pop() || 'unknown',
            status: d.status,
            trackTitle: d.trackTitle,
          })));
        return;
      }
      
      libraryMonitor.log('info', 'download', `Found download record for completed download`, {
        downloadId: download.id,
        trackTitle: downloadRecord.trackTitle || 'unknown',
        status: downloadRecord.status,
        albumId: downloadRecord.albumId,
        artistId: downloadRecord.artistId,
      });
      console.log(`✓ Found download record for ${download.id}: track "${downloadRecord.trackTitle || 'unknown'}", status: ${downloadRecord.status}`);

      let moved = false;
      let destinationPath = sourcePath;

      // Move to proper location using download record
      if (downloadRecord) {
        try {
          const artist = libraryManager.getArtistById(downloadRecord.artistId);
          
          if (artist) {
            if (downloadRecord.type === 'album' && downloadRecord.albumId) {
              const album = libraryManager.getAlbumById(downloadRecord.albumId);
              if (album) {
                // Store the file path but don't move yet - wait for all tracks
                downloadRecord.tempFilePath = sourcePath;
                downloadRecord.status = 'completed';
                downloadRecord.completedAt = new Date().toISOString();
                await db.write();
                
                const trackInfo = downloadRecord.trackTitle 
                  ? ` (track: "${downloadRecord.trackTitle}")` 
                  : '';
                console.log(
                  `✓ Album track${trackInfo} completed, waiting for remaining tracks...`,
                );
                
                // Check if all tracks for this album are now complete
                const albumDownloads = (db.data.downloads || []).filter(
                  d => d.albumId === downloadRecord.albumId && d.type === 'album'
                );
                const completedCount = albumDownloads.filter(d => d.status === 'completed').length;
                const totalCount = albumDownloads.length;
                
                // Update status to show progress
                this.updateDownloadStatus(downloadRecord.albumId, 'downloading', {
                  tracksCompleted: completedCount,
                  totalTracks: totalCount,
                });
                
                // If all tracks are complete, move them all at once
                // Note: Tracks may be in different folders (from different users), but we move each
                // from its stored tempFilePath location to the final album folder
                if (completedCount === totalCount && totalCount > 0) {
                  console.log(`All ${totalCount} tracks completed for album "${album.albumName}" - moving all tracks to library...`);
                  
                  // Move all completed tracks (each may be from a different user/location)
                  for (const trackDownload of albumDownloads) {
                    if (trackDownload.tempFilePath && trackDownload.status === 'completed') {
                      try {
                        const trackInfo = trackDownload.trackTitle 
                          ? ` (track: "${trackDownload.trackTitle}")` 
                          : '';
                        const username = trackDownload.username || 'unknown';
                        console.log(`Moving album track${trackInfo} from user "${username}" (${trackDownload.tempFilePath}) to: ${album.path}`);
                        libraryMonitor.log('info', 'download', `Moving completed download to library`, {
                          downloadId: trackDownload.slskdDownloadId || trackDownload.id,
                          trackTitle: trackDownload.trackTitle,
                          from: trackDownload.tempFilePath,
                          to: album.path,
                          albumId: album.id,
                          artistId: artist.id,
                          username: username,
                        });
                        const finalPath = await this.moveFileToAlbum(trackDownload.tempFilePath, artist, album);
                        trackDownload.destinationPath = finalPath;
                        delete trackDownload.tempFilePath;
                      } catch (error) {
                        console.error(`Error moving track "${trackDownload.trackTitle}" from ${trackDownload.tempFilePath}:`, error.message);
                        // Keep tempFilePath so we can retry later
                      }
                    } else if (!trackDownload.tempFilePath) {
                      console.warn(`Track "${trackDownload.trackTitle}" is marked completed but has no tempFilePath - may need to be re-found`);
                    }
                  }
                  
                  await db.write();
                  
                  // Match all files to tracks
                  for (const trackDownload of albumDownloads) {
                    if (trackDownload.destinationPath) {
                      try {
                        const wasMatched = await fileScanner.matchFileToTrack(
                          {
                            path: trackDownload.destinationPath,
                            name: path.basename(trackDownload.destinationPath),
                            size: 0, // Size not available at this point
                          },
                          libraryManager.getAllArtists()
                        );
                        
                        if (!wasMatched) {
                          console.log(`File not matched: ${trackDownload.destinationPath}`);
                        }
                      } catch (error) {
                        console.error(`Error matching file ${trackDownload.destinationPath}:`, error.message);
                      }
                    }
                  }
                  
                  // Update album statistics
                  await libraryManager.updateAlbumStatistics(downloadRecord.albumId).catch(err => {
                    console.error(`Failed to update album statistics:`, err.message);
                  });
                  
                  // Update album request status
                  const albumTracks = libraryManager.getTracks(downloadRecord.albumId);
                  const tracksWithFiles = albumTracks.filter(t => t.hasFile && t.path);
                  const isComplete = albumTracks.length > 0 && tracksWithFiles.length === albumTracks.length;
                  
                  if (isComplete && db.data.albumRequests) {
                    const albumRequest = db.data.albumRequests.find(r => r.albumId === downloadRecord.albumId);
                    if (albumRequest && albumRequest.status !== 'available') {
                      albumRequest.status = 'available';
                      await db.write();
                      libraryMonitor.log('info', 'request', 'Album request marked as available', {
                        albumId: downloadRecord.albumId,
                        albumName: album.albumName,
                        tracksComplete: tracksWithFiles.length,
                        totalTracks: albumTracks.length,
                      });
                    }
                  }
                  
                  // Update status to "added"
                  this.updateDownloadStatus(downloadRecord.albumId, 'added', {
                    tracksCompleted: completedCount,
                    totalTracks: totalCount,
                  });
                  
                  console.log(`✓ All tracks for album "${album.albumName}" moved to: ${album.path}`);
                }
                
                // Don't set moved = true here since we're waiting for all tracks
                destinationPath = sourcePath; // Keep original path until all tracks are ready
              }
            } else if (downloadRecord.type === 'track' && downloadRecord.trackId) {
              const track = (db.data?.library?.tracks || []).find(t => t.id === downloadRecord.trackId);
              if (track) {
                const album = libraryManager.getAlbumById(track.albumId);
                if (album) {
                  // Move to album folder with proper filename
                  destinationPath = await this.moveFileToTrack(sourcePath, artist, album, track);
                  moved = true;
                }
              }
            }
          }
        } catch (error) {
          console.error(`Error moving file for download ${download.id}:`, error.message);
        }

        // Only update download record if it wasn't already updated (for album downloads that are waiting)
        // For album downloads, we set status and tempFilePath above, so skip this update
        const isAlbumWaiting = downloadRecord.type === 'album' && downloadRecord.albumId && downloadRecord.tempFilePath;
        if (!isAlbumWaiting) {
          downloadRecord.status = 'completed';
          downloadRecord.completedAt = new Date().toISOString();
          downloadRecord.destinationPath = destinationPath;
          await db.write();
          
          // For non-album downloads (single tracks), handle immediately
          if (downloadRecord.type !== 'album' || !downloadRecord.albumId) {
            // Check if file was successfully matched - if not, QueueCleaner will handle it
            const wasMatched = await fileScanner.matchFileToTrack(
              {
                path: destinationPath,
                name: path.basename(destinationPath),
                size: download.size || 0,
              },
              libraryManager.getAllArtists()
            );
            
            // Update album statistics after file matching
            if (wasMatched && downloadRecord.albumId) {
              await libraryManager.updateAlbumStatistics(downloadRecord.albumId).catch(err => {
                console.error(`Failed to update album statistics:`, err.message);
              });
            }
            
            if (!wasMatched) {
              console.log(`Download completed but file not matched - QueueCleaner will process it`);
            }
          }
        }
      } else {
        console.warn(`Download record not found for completed download ${download.id}`);
      }

      // Update statistics for the artist whose album was downloaded
      if (downloadRecord && downloadRecord.artistId) {
        await libraryManager.updateArtistStatistics(downloadRecord.artistId).catch(err => {
          console.error(`Failed to update artist statistics:`, err.message);
        });
      }

      if (moved) {
        console.log(`Moved download to: ${destinationPath}`);
      }
    } catch (error) {
      console.error('Error handling completed download:', error.message);
    }
  }

  async moveFileToAlbum(sourcePath, artist, album) {
    const fileName = path.basename(sourcePath);
    const destinationPath = path.join(album.path, fileName);

    // Create album directory only when files are actually being moved there
    // This creates: /data/Artist Name/Album Name/
    try {
      await fs.mkdir(album.path, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw new Error(`Failed to create album directory "${album.path}": ${error.message}`);
      }
    }

    // Check if file already exists - if it does and is the same, skip moving
    try {
      const existingStats = await fs.stat(destinationPath);
      const sourceStats = await fs.stat(sourcePath);
      
      // If file exists and is the same size, it's likely the same file
      // Skip moving (it's already in the right place)
      if (existingStats.size === sourceStats.size) {
        console.log(`File already exists at destination with same size, skipping move: ${destinationPath}`);
        // Delete the source file since we don't need it
        try {
          await fs.unlink(sourcePath);
        } catch (error) {
          console.warn(`Could not delete source file ${sourcePath}:`, error.message);
        }
        return destinationPath;
      } else {
        // Different size - this shouldn't happen, but log a warning
        console.warn(
          `File exists at destination but with different size (existing: ${existingStats.size}, new: ${sourceStats.size}). Overwriting.`,
        );
      }
    } catch {
      // File doesn't exist, proceed with move
    }

    // Move file (rename is atomic on same filesystem)
    try {
      await fs.rename(sourcePath, destinationPath);
    } catch (error) {
      // If rename fails (different filesystems), copy and delete
      if (error.code === 'EXDEV') {
        await fs.copyFile(sourcePath, destinationPath);
        await fs.unlink(sourcePath);
      } else {
        throw error;
      }
    }

    return destinationPath;
  }

  async moveFileToTrack(sourcePath, artist, album, track) {
    const sourceExt = path.extname(sourcePath);
    // Sanitize filename (remove invalid characters)
    const sanitizedName = track.trackName.replace(/[<>:"/\\|?*]/g, '_').trim();
    const trackFileName = `${sanitizedName}${sourceExt}`;
    const destinationPath = path.join(album.path, trackFileName);

    // Create album directory only when files are actually being moved there
    try {
      await fs.mkdir(album.path, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw new Error(`Failed to create album directory "${album.path}": ${error.message}`);
      }
    }

    // If destination already exists, add a number suffix
    let finalDestination = destinationPath;
    let counter = 1;
    while (true) {
      try {
        await fs.access(finalDestination);
        // File exists, try with counter
        const nameWithoutExt = path.basename(trackFileName, sourceExt);
        finalDestination = path.join(album.path, `${nameWithoutExt} (${counter})${sourceExt}`);
        counter++;
      } catch (error) {
        // File doesn't exist, we can use this path
        break;
      }
    }

    // Move file
    try {
      await fs.rename(sourcePath, finalDestination);
    } catch (error) {
      // If rename fails (different filesystems), copy and delete
      if (error.code === 'EXDEV') {
        await fs.copyFile(sourcePath, finalDestination);
        await fs.unlink(sourcePath);
      } else {
        throw error;
      }
    }

    return finalDestination;
  }

  async downloadAlbum(artistId, albumId) {
    const artist = libraryManager.getArtistById(artistId);
    const album = libraryManager.getAlbumById(albumId);

    if (!artist || !album) {
      throw new Error('Artist or album not found');
    }
    
    // Validate that the album belongs to the artist
    if (album.artistId !== artistId) {
      const actualArtist = libraryManager.getArtistById(album.artistId);
      const actualArtistName = actualArtist ? actualArtist.artistName : 'Unknown';
      console.error(`[DownloadManager] Album mismatch detected!`, {
        requestedArtistId: artistId,
        requestedArtistName: artist.artistName,
        albumId: albumId,
        albumName: album.albumName,
        albumArtistId: album.artistId,
        albumArtistName: actualArtistName,
      });
      throw new Error(`Album "${album.albumName}" does not belong to artist "${artist.artistName}". Album belongs to "${actualArtistName}". This indicates a data inconsistency.`);
    }
    
    console.log(`[DownloadManager] Downloading album "${album.albumName}" by "${artist.artistName}" (albumId: ${albumId}, artistId: ${artistId})`);

    if (!slskdClient.isConfigured()) {
      throw new Error('slskd not configured. Please configure slskd in settings.');
    }

    // Update download status to "adding"
    this.updateDownloadStatus(albumId, 'adding');

    try {
      // Update status to "searching" when we start searching
      this.updateDownloadStatus(albumId, 'searching');
      
      // Get the album's tracklist from MusicBrainz for matching
      let tracklist = [];
      if (album.mbid) {
        try {
          const tracks = libraryManager.getTracks(albumId);
          if (tracks && tracks.length > 0) {
            // Use existing tracks from database
            tracklist = tracks.map(t => ({
              title: t.trackName,
              position: t.trackNumber || 0,
              mbid: t.mbid,
            }));
          } else {
            // Fetch tracklist from MusicBrainz if not in database
            const { musicbrainzRequest } = await import('./apiClients.js');
            const rgData = await musicbrainzRequest(`/release-group/${album.mbid}`, {
              inc: 'releases',
            });
            
            if (rgData.releases && rgData.releases.length > 0) {
              const releaseId = rgData.releases[0].id;
              const releaseData = await musicbrainzRequest(`/release/${releaseId}`, {
                inc: 'recordings',
              });
              
              if (releaseData.media && releaseData.media.length > 0) {
                for (const medium of releaseData.media) {
                  if (medium.tracks) {
                    for (const track of medium.tracks) {
                      const recording = track.recording;
                      if (recording) {
                        tracklist.push({
                          title: recording.title,
                          position: track.position || 0,
                          mbid: recording.id,
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        } catch (error) {
          console.warn(`Could not fetch tracklist for album ${album.mbid}:`, error.message);
        }
      }
      
      // Search and download with tracklist for matching
      // This will download multiple tracks (one per track in tracklist)
      // Use quality from artist settings or fall back to global settings
      const quality = artist.quality || db.data?.settings?.quality || 'standard';
      const downloadResults = await slskdClient.downloadAlbum(artist.artistName, album.albumName, {
        tracklist: tracklist,
        albumMbid: album.mbid,
        quality: quality,
      });
      
      // Store download references for tracking
      // downloadAlbum returns an array of download results (one per track)
      if (!db.data.downloads) {
        db.data.downloads = [];
      }
      
      const downloadRecords = [];
      
      // Handle both single result (backward compatibility) and array of results
      const results = Array.isArray(downloadResults) ? downloadResults : [downloadResults];
      
      for (const download of results) {
        // Extract download ID - it might be at the top level or in enqueued[0]
        let downloadId = download?.id;
        if (!downloadId && download?.enqueued && download.enqueued.length > 0) {
          downloadId = download.enqueued[0].id;
        }
        
        if (!download || !downloadId) {
          console.warn('Skipping invalid download result (no ID found):', JSON.stringify(download, null, 2));
          continue;
        }
        
        // Extract username and filename - might be at top level or in enqueued[0]
        const downloadObj = download.enqueued && download.enqueued.length > 0 
          ? download.enqueued[0] 
          : download;
        
        const downloadRecord = {
          id: downloadId || this.generateId(),
          type: 'album',
          artistId,
          albumId,
          status: 'downloading',
          startedAt: new Date().toISOString(),
          slskdDownloadId: downloadId,
          username: downloadObj.username || download.username, // Store username for retry tracking
          filename: downloadObj.filename || download.filename,
          retryCount: 0,
          progress: 0,
          lastChecked: new Date().toISOString(),
          trackTitle: download.track?.title, // Store which track this is
          trackPosition: download.track?.position,
        };
        
        downloadRecords.push(downloadRecord);
        db.data.downloads.push(downloadRecord);
      }
      
      await db.write();
      
      console.log(
        `Album download initiated: ${downloadRecords.length}/${tracklist.length} tracks started`,
      );
      
      // Update status to "downloading" now that downloads are initiated
      this.updateDownloadStatus(albumId, 'downloading', {
        tracksStarted: downloadRecords.length,
        totalTracks: tracklist.length,
      });
      
      // Return the first download for backward compatibility
      return downloadRecords[0] || downloadResults;
    } catch (error) {
      console.error(`Failed to download album "${album.albumName}" by "${artist.artistName}":`, error.message);
      throw error;
    }
  }

  async downloadTrack(artistId, trackId) {
    const artist = libraryManager.getArtistById(artistId);
    const track = (db.data?.library?.tracks || []).find(t => t.id === trackId);
    
    if (!artist || !track) {
      throw new Error('Artist or track not found');
    }

    if (!slskdClient.isConfigured()) {
      throw new Error('slskd not configured');
    }

    // Search and download
    const download = await slskdClient.downloadTrack(artist.artistName, track.trackName);
    
    // Store download reference
    if (!db.data.downloads) {
      db.data.downloads = [];
    }
    
    db.data.downloads.push({
      id: download.id || this.generateId(),
      type: 'track',
      artistId,
      trackId,
      status: 'downloading',
      startedAt: new Date().toISOString(),
      slskdDownloadId: download.id,
      username: download.username, // Store username for retry tracking
      filename: download.filename,
      retryCount: 0,
      progress: 0,
      lastChecked: new Date().toISOString(),
    });
    
    await db.write();
    
    return download;
  }

  async handleFailedDownload(downloadRecord, slskdDownload = null) {
    try {
      // Increment retry count
      downloadRecord.retryCount = (downloadRecord.retryCount || 0) + 1;
      
      // Extract error message from slskd download or use default
      const errorMessage = slskdDownload?.error || 
                          slskdDownload?.errorMessage || 
                          slskdDownload?.state || 
                          'Download not found in slskd';
      downloadRecord.lastError = errorMessage;
      downloadRecord.lastChecked = new Date().toISOString();
      downloadRecord.lastFailureAt = new Date().toISOString();
      
      const maxRetries = 3;
      if (downloadRecord.retryCount >= maxRetries) {
        // Max retries reached, mark as failed
        downloadRecord.status = 'failed';
        downloadRecord.failedAt = new Date().toISOString();
        downloadRecord.queueCleaned = false; // Let QueueCleaner handle it
        console.log(
          `Download ${downloadRecord.id} failed after ${maxRetries} retries. Last error: ${errorMessage}. Marking as failed for QueueCleaner.`,
        );
        await db.write();
        return;
      }
      
      // Calculate delay before retry (exponential backoff: 1min, 2min, 4min)
      const retryDelayMinutes = Math.pow(2, downloadRecord.retryCount - 1);
      const lastFailureTime = downloadRecord.lastFailureAt 
        ? new Date(downloadRecord.lastFailureAt) 
        : new Date();
      const timeSinceFailure = (new Date() - lastFailureTime) / (1000 * 60); // minutes
      
      // Only retry if enough time has passed
      if (timeSinceFailure < retryDelayMinutes) {
        const remainingMinutes = Math.ceil(retryDelayMinutes - timeSinceFailure);
        console.log(
          `Download ${downloadRecord.id} will retry in ${remainingMinutes} minutes (attempt ${downloadRecord.retryCount}/${maxRetries})...`,
        );
        await db.write();
        return;
      }
      
      // Try to find alternative source and retry
      console.log(
        `Retrying download ${downloadRecord.id} (attempt ${downloadRecord.retryCount}/${maxRetries})...`,
      );
      
      // Cancel the failed download in slskd if it exists
      if (slskdDownload && slskdDownload.id) {
        try {
          await slskdClient.cancelDownload(slskdDownload.id);
          console.log(`Cancelled failed download ${slskdDownload.id} in slskd`);
        } catch (error) {
          // Ignore cancel errors (download might already be gone)
          console.warn(`Could not cancel download ${slskdDownload.id}:`, error.message);
        }
      }
      
      // Retry the download with alternative source
      await this.retryDownload(downloadRecord);
    } catch (error) {
      console.error(`Error handling failed download ${downloadRecord.id}:`, error.message);
      // Mark as failed if retry itself fails
      downloadRecord.status = 'failed';
      downloadRecord.failedAt = new Date().toISOString();
      downloadRecord.lastError = `Retry failed: ${error.message}`;
      await db.write();
    }
  }

  async handleStalledDownload(downloadRecord, slskdDownload) {
    try {
      // Similar to failed download, but for stalled ones
      downloadRecord.retryCount = (downloadRecord.retryCount || 0) + 1;
      downloadRecord.lastError = `Download stalled - no progress for extended period (${downloadRecord.progress || 0}% complete)`;
      downloadRecord.lastChecked = new Date().toISOString();
      downloadRecord.lastFailureAt = new Date().toISOString();
      
      const maxRetries = 3;
      if (downloadRecord.retryCount >= maxRetries) {
        downloadRecord.status = 'failed';
        downloadRecord.failedAt = new Date().toISOString();
        console.log(
          `Download ${downloadRecord.id} stalled after ${maxRetries} retries. Marking as failed.`,
        );
        await db.write();
        return;
      }
      
      // Calculate delay before retry (exponential backoff)
      const retryDelayMinutes = Math.pow(2, downloadRecord.retryCount - 1);
      const lastFailureTime = downloadRecord.lastFailureAt 
        ? new Date(downloadRecord.lastFailureAt) 
        : new Date();
      const timeSinceFailure = (new Date() - lastFailureTime) / (1000 * 60); // minutes
      
      // Only retry if enough time has passed
      if (timeSinceFailure < retryDelayMinutes) {
        const remainingMinutes = Math.ceil(retryDelayMinutes - timeSinceFailure);
        console.log(
          `Download ${downloadRecord.id} will retry in ${remainingMinutes} minutes (stalled, attempt ${downloadRecord.retryCount}/${maxRetries})...`,
        );
        await db.write();
        return;
      }
      
      console.log(
        `Retrying stalled download ${downloadRecord.id} (attempt ${downloadRecord.retryCount}/${maxRetries})...`,
      );
      
      // Cancel the stalled download
      if (slskdDownload && slskdDownload.id) {
        try {
          await slskdClient.cancelDownload(slskdDownload.id);
          console.log(`Cancelled stalled download ${slskdDownload.id} in slskd`);
        } catch (error) {
          // Ignore cancel errors
          console.warn(`Could not cancel stalled download ${slskdDownload.id}:`, error.message);
        }
      }
      
      // Retry with alternative source
      await this.retryDownload(downloadRecord);
    } catch (error) {
      console.error(`Error handling stalled download ${downloadRecord.id}:`, error.message);
      // Mark as failed if retry itself fails
      downloadRecord.status = 'failed';
      downloadRecord.failedAt = new Date().toISOString();
      downloadRecord.lastError = `Stalled retry failed: ${error.message}`;
      await db.write();
    }
  }

  updateDownloadStatus(albumId, status, metadata = {}) {
    if (!db.data.downloadStatus) {
      db.data.downloadStatus = {};
    }
    
    db.data.downloadStatus[albumId] = {
      status,
      updatedAt: new Date().toISOString(),
      ...metadata,
    };
    
    // Write to disk asynchronously (don't await)
    db.write().catch(err => {
      console.error('Failed to update download status:', err);
    });
  }

  // Public method to update status (for routes)
  updateStatus(albumId, status, metadata = {}) {
    this.updateDownloadStatus(albumId, status, metadata);
  }

  getDownloadStatus(albumId) {
    if (!db.data.downloadStatus) {
      return null;
    }
    
    const status = db.data.downloadStatus[albumId];
    if (!status) {
      return null;
    }
    
    // Check if there are active downloads for this album
    const activeDownloads = (db.data.downloads || []).filter(
      d => d.albumId === albumId && d.status === 'downloading'
    );
    
    // Get slskd download status if available
    const slskdStatuses = activeDownloads.map(d => ({
      id: d.slskdDownloadId,
      progress: d.progress || 0,
      trackTitle: d.trackTitle,
    }));
    
    return {
      ...status,
      activeDownloads: slskdStatuses,
      downloadCount: activeDownloads.length,
    };
  }

  async retryDownload(downloadRecord) {
    try {
      // Get the original download info
      const artist = libraryManager.getArtistById(downloadRecord.artistId);
      
      if (!artist) {
        downloadRecord.status = 'failed';
        await db.write();
        return;
      }
      
      if (downloadRecord.type === 'album' && downloadRecord.albumId) {
        const album = libraryManager.getAlbumById(downloadRecord.albumId);
        if (album) {
          // For album downloads, we need to retry just the specific track that failed
          // Get the track info from the download record
          const trackTitle = downloadRecord.trackTitle;
          const trackPosition = downloadRecord.trackPosition;
          
          if (trackTitle) {
            // Retry just this specific track
            downloadRecord.status = 'retrying';
            downloadRecord.retryStartedAt = new Date().toISOString();
            await db.write();
            
            // Search and download just this track
            const query = `${artist.artistName} ${album.albumName} ${trackTitle}`;
            console.log(`Retrying track "${trackTitle}" with query: "${query}"`);
            
            const download = await slskdClient.searchAndDownload(query, {
              fileType: "Audio",
              preferIndividualTracks: true,
              excludeUsernames: downloadRecord.triedUsernames || [],
            });
            
            // Extract download ID
            let downloadId = download?.id;
            if (!downloadId && download?.enqueued && download.enqueued.length > 0) {
              downloadId = download.enqueued[0].id;
            }
            
            if (downloadId) {
              // Update download record with new slskd download ID
              downloadRecord.slskdDownloadId = downloadId;
              downloadRecord.status = 'downloading';
              downloadRecord.startedAt = new Date().toISOString();
              
              // Track which usernames we've tried
              if (!downloadRecord.triedUsernames) {
                downloadRecord.triedUsernames = [];
              }
              if (downloadRecord.username) {
                downloadRecord.triedUsernames.push(downloadRecord.username);
              }
              const downloadObj = download.enqueued && download.enqueued.length > 0 
                ? download.enqueued[0] 
                : download;
              if (downloadObj?.username) {
                downloadRecord.triedUsernames.push(downloadObj.username);
              }
              
              await db.write();
              console.log(`Retry initiated for track "${trackTitle}" with new download ID: ${downloadId}`);
            } else {
              console.error(`Failed to get download ID from retry result for track "${trackTitle}"`);
              downloadRecord.status = 'failed';
              await db.write();
            }
          } else {
            // No track info, can't retry individual track - would need to retry whole album
            console.warn(`Cannot retry download ${downloadRecord.id} - no track information available`);
            downloadRecord.status = 'failed';
            await db.write();
          }
        }
      } else if (downloadRecord.type === 'track' && downloadRecord.trackId) {
        const track = (db.data?.library?.tracks || []).find(t => t.id === downloadRecord.trackId);
        if (track) {
          // Retry track download
          downloadRecord.status = 'retrying';
          downloadRecord.retryStartedAt = new Date().toISOString();
          await db.write();
          
          const download = await slskdClient.downloadTrack(artist.artistName, track.trackName, {
            excludeUsernames: downloadRecord.triedUsernames || [],
          });
          
          downloadRecord.slskdDownloadId = download.id;
          downloadRecord.status = 'downloading';
          downloadRecord.startedAt = new Date().toISOString();
          downloadRecord.username = download.username;
          downloadRecord.filename = download.filename;
          downloadRecord.progress = 0;
          downloadRecord.lastChecked = new Date().toISOString();
          await db.write();
        }
      }
    } catch (error) {
      console.error(`Error retrying download ${downloadRecord.id}:`, error.message);
      downloadRecord.status = 'failed';
      downloadRecord.failedAt = new Date().toISOString();
      await db.write();
    }
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}

export const downloadManager = new DownloadManager();
