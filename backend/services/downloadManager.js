import { slskdClient } from './slskdClient.js';
import { libraryManager } from './libraryManager.js';
import { fileScanner } from './fileScanner.js';
import { db } from '../config/db.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { queueCleaner } from './queueCleaner.js';
import { libraryMonitor } from './libraryMonitor.js';
import { downloadQueue } from './downloadQueue.js';

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

  /**
   * Log an event to a download record's history
   * This ensures we have a complete audit trail of all download operations
   */
  logDownloadEvent(downloadRecord, event, data = {}) {
    if (!downloadRecord) return;
    
    // Initialize event history if it doesn't exist
    if (!downloadRecord.events) {
      downloadRecord.events = [];
    }
    
    const eventEntry = {
      timestamp: new Date().toISOString(),
      event,
      ...data,
    };
    
    downloadRecord.events.push(eventEntry);
    
    // Keep only last 100 events to prevent bloat
    if (downloadRecord.events.length > 100) {
      downloadRecord.events = downloadRecord.events.slice(-100);
    }
    
    // Update status-specific timestamps
    const timestamp = eventEntry.timestamp;
    switch (event) {
      case 'requested':
        downloadRecord.requestedAt = timestamp;
        downloadRecord.status = 'requested';
        break;
      case 'queued':
        downloadRecord.queuedAt = timestamp;
        downloadRecord.status = 'queued';
        break;
      case 'started':
        downloadRecord.startedAt = timestamp;
        downloadRecord.status = 'downloading';
        break;
      case 'progress':
        downloadRecord.lastProgressUpdate = timestamp;
        if (data.progress !== undefined) {
          downloadRecord.progress = data.progress;
        }
        break;
      case 'stalled':
        downloadRecord.stalledAt = downloadRecord.stalledAt || timestamp;
        downloadRecord.status = 'stalled';
        break;
      case 'failed':
        downloadRecord.failedAt = timestamp;
        downloadRecord.status = 'failed';
        if (data.error) {
          downloadRecord.lastError = data.error;
        }
        break;
      case 'timeout':
        downloadRecord.timedOutAt = timestamp;
        downloadRecord.status = 'timeout';
        if (data.error) {
          downloadRecord.lastError = data.error;
        }
        break;
      case 'completed':
        downloadRecord.completedAt = timestamp;
        downloadRecord.status = 'completed';
        break;
      case 'moved':
        downloadRecord.movedAt = timestamp;
        if (data.destinationPath) {
          downloadRecord.destinationPath = data.destinationPath;
        }
        break;
      case 'added_to_library':
        downloadRecord.addedToLibraryAt = timestamp;
        downloadRecord.status = 'added';
        break;
      case 'deleted':
        downloadRecord.deletedAt = timestamp;
        downloadRecord.status = 'deleted';
        break;
      case 'requeued':
        downloadRecord.requeuedAt = timestamp;
        downloadRecord.requeueCount = (downloadRecord.requeueCount || 0) + 1;
        downloadRecord.status = 'queued';
        // Reset failure tracking for new attempt
        downloadRecord.lastFailureAt = null;
        break;
      case 'cancelled':
        downloadRecord.cancelledAt = timestamp;
        downloadRecord.status = 'cancelled';
        break;
    }
    
    // Always update lastChecked
    downloadRecord.lastChecked = timestamp;
    
    return eventEntry;
  }

  // Remove empty directories up to the slskd download root
  async removeEmptyDirectories(filePath) {
    if (!this.slskdDownloadDir) {
      return;
    }

    try {
      let currentDir = path.dirname(filePath);
      const downloadRoot = path.resolve(this.slskdDownloadDir);

      // Only remove directories within the slskd download directory
      while (currentDir && currentDir !== downloadRoot && currentDir.startsWith(downloadRoot)) {
        try {
          const entries = await fs.readdir(currentDir);
          
          // If directory is empty, remove it
          if (entries.length === 0) {
            await fs.rmdir(currentDir);
            // Move up to parent directory
            currentDir = path.dirname(currentDir);
          } else {
            // Directory has contents, stop here
            break;
          }
        } catch (error) {
          // Directory might have been removed already or doesn't exist
          if (error.code === 'ENOENT' || error.code === 'ENOTEMPTY') {
            break;
          }
          // For other errors, log but don't throw
          console.warn(`Error checking/removing directory ${currentDir}:`, error.message);
          break;
        }
      }
    } catch (error) {
      // Don't throw - this is cleanup, not critical
      console.warn(`Error removing empty directories for ${filePath}:`, error.message);
    }
  }

  // Recursively search for a file in a directory
  async findFileRecursively(dir, filename, maxDepth = 5, currentDepth = 0) {
    if (currentDepth >= maxDepth) {
      return null;
    }
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      // Normalize the search filename for better matching
      const searchName = filename.toLowerCase();
      // Try to match without common suffixes like (1), (2), etc.
      const baseName = searchName.replace(/\s*\(\d+\)\s*$/, '').trim();
      
      // Normalize separators (periods, dashes, spaces) for comparison
      const normalizeSeparators = (str) => str.replace(/[.\-_\s]+/g, ' ').trim().toLowerCase();
      const normalizedSearch = normalizeSeparators(searchName);
      
      // Extract potential track pattern (e.g., "08 - Track Name" or "01. Track Name")
      const trackPattern = searchName.match(/(\d+[.\-\s]+\s*.+)$/);
      const trackOnly = trackPattern ? normalizeSeparators(trackPattern[1]) : null;
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isFile()) {
          const entryName = entry.name.toLowerCase();
          const normalizedEntry = normalizeSeparators(entryName);
          
          // Exact match
          if (entryName === searchName) {
            return fullPath;
          }
          
          // Normalized match (handles period vs dash differences)
          if (normalizedEntry === normalizedSearch) {
            return fullPath;
          }
          
          // Match without suffix (e.g., "file (1).mp3" matches "file.mp3")
          if (entryName === baseName) {
            return fullPath;
          }
          
          // If we have a track-only pattern, try matching just that part
          // e.g., "Beddy Rays - 2022 Beddy Rays - 08 - Sobercoaster.flac" should match "08 - Sobercoaster.flac"
          // or "01. She Loves Me So.flac" should match "01 - She Loves Me So.flac"
          if (trackOnly && normalizedEntry === trackOnly) {
            return fullPath;
          }
          
          // Partial match - check if the entry ends with the track pattern (normalized)
          if (trackOnly && normalizedEntry.endsWith(trackOnly)) {
            return fullPath;
          }
          
          // Check if entry name is contained in search name or vice versa (for partial matches)
          const entryBase = entryName.replace(/\s*\(\d+\)\s*\./, '.').replace(/\.[^.]+$/, '');
          const searchBase = baseName.replace(/\.[^.]+$/, '');
          
          // Normalized base comparison
          const normalizedEntryBase = normalizeSeparators(entryBase);
          const normalizedSearchBase = normalizeSeparators(searchBase);
          
          // If one contains the other (after removing common prefixes), it's likely a match
          if (normalizedEntryBase === normalizedSearchBase || 
              (normalizedEntryBase.length > 10 && normalizedSearchBase.length > 10 && 
               (normalizedEntryBase.includes(normalizedSearchBase) || normalizedSearchBase.includes(normalizedEntryBase)))) {
            return fullPath;
          }
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
            // Check if the directory ends with 'complete' - if not, append it
            // slskd API might return base directory or complete directory
            if (dir.endsWith('complete') || dir.endsWith('complete/')) {
              this.slskdDownloadDir = dir;
            } else {
              // API returned base directory, append /complete
              this.slskdDownloadDir = path.join(dir, 'complete');
            }
          }
        } catch (error) {
          console.warn('Could not get download directory from slskd:', error.message);
        }
      }
      
      // Final fallback: default to /downloads for Docker compatibility
      // Users can map their slskd downloads to /downloads without setting env var
      if (!this.slskdDownloadDir) {
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        if (homeDir) {
          // Local development: use home directory
          const defaultDownloadsDir = path.join(homeDir, '.slskd', 'downloads');
          this.slskdDownloadDir = path.join(defaultDownloadsDir, 'complete');
        } else {
          // Docker/production: default to /downloads
          this.slskdDownloadDir = '/downloads';
        }
      }
    }
  }

  startDownloadMonitor() {
    // Check downloads every 10 seconds for more responsive updates
    setInterval(() => {
      this.checkCompletedDownloads();
    }, 10000);
    
    // Check for failed downloads that should be requeued every 5 minutes
    setInterval(() => {
      this.checkFailedDownloadsForRequeue();
    }, 5 * 60 * 1000);
  }

  /**
   * Check for failed downloads that should be automatically requeued
   * This ensures we're always trying to complete downloads
   */
  async checkFailedDownloadsForRequeue() {
    try {
      if (!slskdClient.isConfigured()) {
        return;
      }

      const failedDownloads = (db.data.downloads || []).filter(
        d => d.status === 'failed' && 
             !d.queueCleaned && 
             (d.retryCount || 0) < 3 &&
             (!d.lastRequeueAttempt || 
              (new Date() - new Date(d.lastRequeueAttempt)) / (1000 * 60) > 60) // Wait at least 1 hour between requeue attempts
      );

      if (failedDownloads.length === 0) {
        return;
      }

      console.log(`Checking ${failedDownloads.length} failed downloads for automatic requeue...`);

      for (const download of failedDownloads) {
        try {
          // Check if enough time has passed since last failure
          const lastFailure = download.failedAt || download.lastFailureAt;
          if (!lastFailure) continue;

          const minutesSinceFailure = (new Date() - new Date(lastFailure)) / (1000 * 60);
          
          // Only requeue if it's been at least 30 minutes since failure
          if (minutesSinceFailure < 30) {
            continue;
          }

          // Check if this download is still relevant (not deleted, not cleaned)
          if (download.queueCleaned || download.status === 'deleted') {
            continue;
          }

          console.log(`Auto-requeuing failed download ${download.id} (attempt ${(download.retryCount || 0) + 1}/3)...`);
          
          download.lastRequeueAttempt = new Date().toISOString();
          await db.write();
          
          // Retry the download
          await this.retryDownload(download);
        } catch (error) {
          console.error(`Error auto-requeuing download ${download.id}:`, error.message);
        }
      }
    } catch (error) {
      console.error('Error checking failed downloads for requeue:', error.message);
    }
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
      const trackedDownloads = (db.data.downloads || []).filter(d => d.status === 'downloading' || d.status === 'requested');
      
      // Separate weekly-flow downloads for better logging
      const weeklyFlowDownloads = trackedDownloads.filter(d => d.type === 'weekly-flow');
      const otherDownloads = trackedDownloads.filter(d => d.type !== 'weekly-flow');
      
      // Check for completed downloads that we haven't processed yet
      const trackedCount = trackedDownloads.length;
      if (weeklyFlowDownloads.length > 0) {
        console.log(`[WEEKLY FLOW] Checking ${downloads.length} downloads from slskd (${trackedCount} tracked, ${weeklyFlowDownloads.length} weekly-flow)`);
      }
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
        
        // Check if this is a weekly-flow download
        const downloadIdStr = download.id?.toString();
        const weeklyFlowRecord = (db.data.downloads || []).find(
          d => d.type === 'weekly-flow' && 
               (d.slskdDownloadId?.toString() === downloadIdStr || d.slskdDownloadId === download.id)
        );
        
        if (normalizedState === 'completed') {
          completedCount++;
          // Check if we've already processed this download
          const downloadRecord = (db.data.downloads || []).find(
            d => {
              const recordIdStr = d.slskdDownloadId?.toString();
              return (recordIdStr === downloadIdStr || 
                      d.slskdDownloadId === download.id) && 
                      d.status === 'completed';
            }
          );
          
          if (!downloadRecord) {
            if (weeklyFlowRecord) {
              console.log(`[WEEKLY FLOW] Found completed download: ${weeklyFlowRecord.artistName} - ${weeklyFlowRecord.trackName} (ID: ${download.id})`);
            }
            libraryMonitor.log('info', 'download', `Found completed download`, {
              downloadId: download.id,
              filename: download.filename || 'unknown',
              state: state,
            });
            
            // Try to find by slskdDownloadId even if status isn't completed
            const existingRecord = weeklyFlowRecord || (db.data.downloads || []).find(
              d => {
                const recordIdStr = d.slskdDownloadId?.toString();
                return recordIdStr === downloadIdStr || d.slskdDownloadId === download.id;
              }
            );
            
            if (existingRecord) {
              // Update existing record
              this.logDownloadEvent(existingRecord, 'completed', {
                slskdState: state,
                filename: download.filename,
              });
              await db.write();
              await this.handleCompletedDownload(download);
            } else {
              // New download we weren't tracking - handle it
              await this.handleCompletedDownload(download);
            }
            processedCount++;
          }
        } else if (weeklyFlowRecord && (normalizedState === 'downloading' || normalizedState === 'queued')) {
          // Log progress for weekly-flow downloads
          const progress = download.percentComplete || download.progress || 0;
          if (progress > 0 && progress !== weeklyFlowRecord.progress) {
            console.log(`[WEEKLY FLOW] Download progress: ${weeklyFlowRecord.artistName} - ${weeklyFlowRecord.trackName} (${progress}%)`);
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
          const startedAt = new Date(trackedDownload.startedAt || trackedDownload.requestedAt || new Date());
          const now = new Date();
          const minutesElapsed = (now - startedAt) / (1000 * 60);
          
          // For weekly-flow downloads, log when they're missing
          if (trackedDownload.type === 'weekly-flow') {
            console.log(`[WEEKLY FLOW] Download not found in slskd: ${trackedDownload.artistName} - ${trackedDownload.trackName} (ID: ${trackedDownload.slskdDownloadId}, ${Math.round(minutesElapsed)}m ago)`);
          }
          
          // Only retry if it's been more than 10 minutes (give it time to complete and be processed)
          // And only if we haven't already retried too many times
          if (minutesElapsed > 10 && (trackedDownload.retryCount || 0) < 3) {
            if (trackedDownload.type === 'weekly-flow') {
              console.log(`[WEEKLY FLOW] Retrying missing download: ${trackedDownload.artistName} - ${trackedDownload.trackName}`);
            }
            console.log(
              `Download ${trackedDownload.id} not found in slskd after ${Math.round(minutesElapsed)} minutes (retry ${trackedDownload.retryCount || 0}/3), marking for retry`,
            );
            this.logDownloadEvent(trackedDownload, 'timeout', {
              error: `Download not found in slskd after ${Math.round(minutesElapsed)} minutes`,
              minutesElapsed: Math.round(minutesElapsed),
            });
            await db.write();
            await this.handleFailedDownload(trackedDownload);
          } else if (minutesElapsed > 10) {
            // Too many retries or too old - mark as failed
            if (trackedDownload.type === 'weekly-flow') {
              console.log(`[WEEKLY FLOW] Marking as failed: ${trackedDownload.artistName} - ${trackedDownload.trackName} (max retries reached)`);
            }
            console.log(
              `Download ${trackedDownload.id} not found after ${Math.round(minutesElapsed)} minutes and max retries reached, marking as failed`,
            );
            this.logDownloadEvent(trackedDownload, 'failed', {
              error: `Download not found after ${Math.round(minutesElapsed)} minutes and max retries reached`,
              minutesElapsed: Math.round(minutesElapsed),
              retryCount: trackedDownload.retryCount || 0,
            });
            await db.write();
          }
        } else {
          // Check download state with normalized state handling
          const state = slskdDownload.state || slskdDownload.status;
          const normalizedState = this.normalizeState(state);
          
          if (normalizedState === 'completed') {
            // Download is completed but we haven't processed it yet - handle it
            console.log(`Found completed download in tracked list: ${trackedDownload.id}, state: ${state}`);
            this.logDownloadEvent(trackedDownload, 'completed', {
              slskdState: state,
              filename: slskdDownload.filename,
            });
            await db.write();
            await this.handleCompletedDownload(slskdDownload);
          } else if (normalizedState === 'failed' || normalizedState === 'cancelled') {
            console.log(`Download ${trackedDownload.id} failed with state: ${state}`);
            const errorMsg = slskdDownload.error || slskdDownload.errorMessage || state;
            this.logDownloadEvent(trackedDownload, normalizedState === 'cancelled' ? 'cancelled' : 'failed', {
              error: errorMsg,
              slskdState: state,
            });
            await db.write();
            await this.handleFailedDownload(trackedDownload, slskdDownload);
          } else if (normalizedState === 'downloading' || normalizedState === 'queued') {
            // Update progress if available
            const progress = slskdDownload.percentComplete || 
                           slskdDownload.progress || 
                           slskdDownload.percentComplete || 
                           0;
            
            // Update status to queued if it was requested
            if (trackedDownload.status === 'requested' && normalizedState === 'queued') {
              this.logDownloadEvent(trackedDownload, 'queued', {
                slskdState: state,
              });
            } else if (trackedDownload.status === 'queued' && normalizedState === 'downloading') {
              this.logDownloadEvent(trackedDownload, 'started', {
                slskdState: state,
              });
            }
            
            // Update progress tracking
            if (trackedDownload.progress !== progress) {
              this.logDownloadEvent(trackedDownload, 'progress', {
                progress,
                slskdState: state,
              });
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
              this.logDownloadEvent(trackedDownload, 'stalled', {
                progress,
                minutesSinceUpdate: Math.round(minutesSinceUpdate),
                slskdState: state,
              });
              trackedDownload.lastProgress = progress;
              await db.write();
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
      
      // ALWAYS get the full download details from slskd API - it contains the actual file path
      let fullDownload = download;
      let sourcePath = null;
      
      if (download.id) {
        try {
          const detailedDownload = await slskdClient.getDownload(download.id);
          if (detailedDownload) {
            fullDownload = { ...download, ...detailedDownload };
            
            // slskd API returns the actual file path - try all possible field names
            sourcePath = detailedDownload.filePath || 
                        detailedDownload.destinationPath || 
                        detailedDownload.path || 
                        detailedDownload.file || 
                        detailedDownload.localPath || 
                        detailedDownload.completedPath ||
                        detailedDownload.file?.path ||
                        detailedDownload.destination?.path ||
                        detailedDownload.destinationPath ||
                        detailedDownload.completedFilePath;
            
            if (sourcePath) {
              console.log(`✓ Got file path from slskd API for ${download.id}: ${sourcePath}`);
            } else {
              console.log(`⚠ No file path in detailed download. Available fields:`, Object.keys(detailedDownload).join(', '));
              // Log the full object structure for debugging
              console.log(`Full download object:`, JSON.stringify(detailedDownload, null, 2));
            }
          }
        } catch (e) {
          console.warn(`Could not get detailed download info for ${download.id}: ${e.message}`);
        }
      }
      
      // If we still don't have a path, try from the basic download object
      if (!sourcePath) {
        sourcePath = download.filePath || 
                     download.destinationPath || 
                     download.path || 
                     download.file || 
                     download.localPath || 
                     download.completedPath;
      }
      
      // If path not in download object, try to construct it from filename
      // slskd typically stores completed downloads in a "complete" or "downloads" folder
      if (!sourcePath && download.filename) {
        // Get slskd download directory - try API first, then environment, then defaults
        let slskdDownloadDir = this.slskdDownloadDir;
        
        if (!slskdDownloadDir) {
          // Try to get it from API if we haven't cached it yet
          try {
            const dir = await slskdClient.getDownloadDirectory();
            if (dir) {
              // Check if the directory ends with 'complete' - if not, append it
              if (dir.endsWith('complete') || dir.endsWith('complete/')) {
                slskdDownloadDir = dir;
              } else {
                // API returned base directory, append /complete
                slskdDownloadDir = path.join(dir, 'complete');
              }
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
    
    // If not in process.env, try loading .env file directly
    if (!completeDir) {
      try {
        const dotenv = await import('dotenv');
        const envPath = path.join(__dirname, '..', '.env');
        const envConfig = dotenv.config({ path: envPath });
        if (envConfig.parsed?.SLSKD_COMPLETE_DIR) {
          completeDir = envConfig.parsed.SLSKD_COMPLETE_DIR;
          // Also set it in process.env for future use
          process.env.SLSKD_COMPLETE_DIR = completeDir;
          console.log(`Loaded SLSKD_COMPLETE_DIR from .env: ${completeDir}`);
        }
      } catch (err) {
        // Ignore
      }
    }
    
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
          
          // Final fallback: default to /downloads for Docker compatibility
          if (!completeDir) {
            const homeDir = process.env.HOME || process.env.USERPROFILE || '';
            if (homeDir) {
              // Local development: use home directory
              const defaultDownloadsDir = path.join(homeDir, '.slskd', 'downloads');
              completeDir = path.join(defaultDownloadsDir, 'complete');
            } else {
              // Docker/production: default to /downloads
              completeDir = '/downloads';
            }
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
        
        // Also extract potential track-only filename (common pattern: "## - Track Name.ext")
        // If filename contains " - " pattern, try to extract just the track part
        let trackOnlyFilename = null;
        const trackMatch = justFilename.match(/(\d+\s*-\s*.+)$/); // Match "## - Track Name.ext" at the end
        if (trackMatch) {
          trackOnlyFilename = trackMatch[1].trim();
        } else {
          // Try to extract last part after " - " if it exists
          const parts = justFilename.split(' - ');
          if (parts.length > 1) {
            // Take the last part which is usually the track name
            trackOnlyFilename = parts[parts.length - 1];
          }
        }
        
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
          // Track-only filename (e.g., "08 - Sobercoaster.flac" from "Beddy Rays - 2022 Beddy Rays - 08 - Sobercoaster.flac")
          trackOnlyFilename ? path.join(slskdDownloadDir, trackOnlyFilename) : null,
          // With username: {username}/{filename} in complete dir
          download.username ? path.join(slskdDownloadDir, download.username, justFilename) : null,
          download.username && trackOnlyFilename ? path.join(slskdDownloadDir, download.username, trackOnlyFilename) : null,
          // With username and full path in complete dir
          download.username ? path.join(slskdDownloadDir, download.username, cleanPath) : null,
          // If filename has path structure, try preserving just the filename
          filename.includes('/') ? path.join(slskdDownloadDir, filename.split(/[\\/]/).pop()) : null,
          // Also try incomplete directory (slskd may store completed files there)
          incompleteDir ? path.join(incompleteDir, cleanPath) : null,
          incompleteDir ? path.join(incompleteDir, filename) : null,
          incompleteDir ? path.join(incompleteDir, justFilename) : null,
          incompleteDir && trackOnlyFilename ? path.join(incompleteDir, trackOnlyFilename) : null,
          incompleteDir && download.username ? path.join(incompleteDir, download.username, justFilename) : null,
          incompleteDir && download.username && trackOnlyFilename ? path.join(incompleteDir, download.username, trackOnlyFilename) : null,
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
            // Try searching for the full filename first
            console.log(`Attempting recursive search for: ${justFilename} in ${slskdDownloadDir}`);
            let foundFile = await this.findFileRecursively(slskdDownloadDir, justFilename);
            
            // If not found and we have a track-only filename, try that too
            if (!foundFile && trackOnlyFilename && trackOnlyFilename !== justFilename) {
              console.log(`Trying recursive search for track-only filename: ${trackOnlyFilename}`);
              foundFile = await this.findFileRecursively(slskdDownloadDir, trackOnlyFilename);
            }
            
            // Also try with normalized separators (period vs dash)
            if (!foundFile) {
              const normalizedFilename = justFilename.replace(/\./g, ' - ').replace(/\s+/g, ' ').trim();
              if (normalizedFilename !== justFilename) {
                console.log(`Trying recursive search with normalized filename: ${normalizedFilename}`);
                foundFile = await this.findFileRecursively(slskdDownloadDir, normalizedFilename);
              }
            }
            
            if (foundFile) {
              sourcePath = foundFile;
              console.log(`✓ Found file via recursive search: ${foundFile}`);
            } else {
              console.log(`✗ Recursive search did not find: ${justFilename}${trackOnlyFilename ? ` or ${trackOnlyFilename}` : ''}`);
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
        
        // If still not found, log warning with helpful message
        if (!sourcePath) {
          console.warn(`Could not locate downloaded file: ${justFilename}`);
          console.warn(`Original filename from slskd: ${download.filename}`);
          if (!this.slskdDownloadDir) {
            console.warn('SLSKD_COMPLETE_DIR not set. For Docker, map slskd downloads and set: -e SLSKD_COMPLETE_DIR=/downloads');
            console.warn('Example: docker run -v /your/slskd/downloads/complete:/downloads -e SLSKD_COMPLETE_DIR=/downloads ...');
          } else {
            console.warn(`Searched in: ${this.slskdDownloadDir}`);
            console.warn(`Tried ${possiblePaths.length} possible paths`);
            console.warn('If file exists elsewhere, set SLSKD_COMPLETE_DIR to the correct path');
            // Try to help debug - list what's actually in the directory
            try {
              const dirContents = await fs.readdir(slskdDownloadDir);
              console.warn(`Directory contains ${dirContents.length} items (first 10):`, dirContents.slice(0, 10));
            } catch (e) {
              // Ignore
            }
          }
        }
      }
      
      if (!sourcePath) {
        console.warn('Download completed but no file path available.');
        console.warn('Set SLSKD_COMPLETE_DIR environment variable to the path where slskd stores completed downloads.');
        console.warn('For Docker: docker run -v /your/slskd/downloads/complete:/downloads -e SLSKD_COMPLETE_DIR=/downloads ...');
        console.warn('Download object:', JSON.stringify({
          id: download.id,
          filename: download.filename,
          username: download.username,
          state: download.state,
        }, null, 2));
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
      
      // Extract just the filename for matching
      const downloadFilename = download.filename ? download.filename.split(/[\\/]/).pop() : null;
      const sourceFilename = sourcePath ? path.basename(sourcePath) : null;
      
      // Try multiple matching strategies
      let downloadRecord = (db.data.downloads || []).find(
        d => {
          const recordIdStr = d.slskdDownloadId?.toString();
          const recordId = d.slskdDownloadId;
          
          // Try exact ID matches first
          if (recordIdStr === downloadIdStr) return true;
          if (recordId === downloadId) return true;
          if (recordId === downloadIdStr) return true;
          if (recordIdStr === downloadId) return true;
          
          return false;
        }
      );
      
      // If no match by ID, try matching by filename (for orphaned downloads or weekly-flow)
      if (!downloadRecord && (downloadFilename || sourceFilename)) {
        const searchFilename = sourceFilename || downloadFilename;
        downloadRecord = (db.data.downloads || []).find(
          d => {
            if (!d.filename && !d.trackName) return false;
            
            const recordFilename = d.filename ? d.filename.split(/[\\/]/).pop() : null;
            const recordTrackName = d.trackName;
            
            // Match by filename
            if (recordFilename && searchFilename && 
                recordFilename.toLowerCase() === searchFilename.toLowerCase()) {
              return true;
            }
            
            // Match by track name (for weekly-flow downloads)
            if (recordTrackName && searchFilename) {
              const trackOnly = searchFilename.match(/(\d+\s*-\s*.+)$/);
              if (trackOnly) {
                const trackPart = trackOnly[1].toLowerCase();
                if (recordTrackName.toLowerCase().includes(trackPart) || 
                    trackPart.includes(recordTrackName.toLowerCase())) {
                  return true;
                }
              }
              // Direct track name match
              if (searchFilename.toLowerCase().includes(recordTrackName.toLowerCase()) ||
                  recordTrackName.toLowerCase().includes(searchFilename.toLowerCase())) {
                return true;
              }
            }
            
            // For weekly-flow type, also match by artist and track
            if (d.type === 'weekly-flow' && d.artistName && d.trackName && searchFilename) {
              // Check if filename contains both artist and track name
              const filenameLower = searchFilename.toLowerCase();
              const artistLower = d.artistName.toLowerCase();
              const trackLower = d.trackName.toLowerCase();
              
              // Try to extract track part from filename
              const trackPattern = filenameLower.match(/(\d+\s*-\s*.+)$/);
              if (trackPattern) {
                const extractedTrack = trackPattern[1].toLowerCase();
                if (extractedTrack.includes(trackLower) || trackLower.includes(extractedTrack.replace(/\.[^.]+$/, ''))) {
                  return true;
                }
              }
            }
            
            return false;
          }
        );
        
        if (downloadRecord) {
          console.log(`Matched download record by filename instead of ID: ${downloadRecord.id} (type: ${downloadRecord.type})`);
        }
      }
      
      if (!downloadRecord) {
        console.warn(`No download record found for slskd download ID: ${download.id} (${typeof download.id})`);
        console.warn(`Filename: ${download.filename || 'unknown'}`);
        console.warn(`Source file: ${sourcePath || 'not found'}`);
        console.warn(`Available download records (${(db.data.downloads || []).length} total, ${(db.data.downloads || []).filter(d => d.status === 'downloading').length} downloading):`, 
          (db.data.downloads || []).slice(0, 10).map(d => ({
            id: d.id,
            slskdDownloadId: d.slskdDownloadId,
            type: d.type || 'unknown',
            filename: d.filename?.split(/[\\/]/).pop() || 'unknown',
            trackName: d.trackName,
            status: d.status,
            trackTitle: d.trackTitle,
          })));
        
        // For weekly-flow downloads, we might want to create a record if file exists but no record
        // But for now, just return - QueueCleaner might handle it
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
                this.logDownloadEvent(downloadRecord, 'completed', {
                  tempFilePath: sourcePath,
                  trackTitle: downloadRecord.trackTitle,
                });
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
                  this.logDownloadEvent(downloadRecord, 'moved', {
                    destinationPath,
                    from: sourcePath,
                  });
                  this.logDownloadEvent(downloadRecord, 'added_to_library', {
                    destinationPath,
                    albumId: album.id,
                    trackId: track.id,
                  });
                  moved = true;
                }
              }
            } else if (downloadRecord.type === 'weekly-flow') {
              // Move weekly flow tracks to Weekly Flow folder
              if (sourcePath) {
                destinationPath = await this.moveFileToWeeklyFlow(sourcePath, downloadRecord);
                this.logDownloadEvent(downloadRecord, 'moved', {
                  destinationPath,
                  from: sourcePath,
                  location: 'weekly-flow',
                });
                moved = true;
                console.log(`✓ Moved weekly flow track to: ${destinationPath}`);
              } else {
                console.warn(`No source path found for weekly-flow download ${downloadRecord.id}`);
              }
            }
          }
        } catch (error) {
          console.error(`Error moving file for download ${download.id}:`, error.message);
        }

        // Store the file path from slskd API in the download record for future reference
        if (sourcePath && !downloadRecord.slskdFilePath) {
          downloadRecord.slskdFilePath = sourcePath;
        }
        
        // Only update download record if it wasn't already updated (for album downloads that are waiting)
        // For album downloads, we set status and tempFilePath above, so skip this update
        const isAlbumWaiting = downloadRecord.type === 'album' && downloadRecord.albumId && downloadRecord.tempFilePath;
        if (!isAlbumWaiting) {
          // Log completion if not already logged
          if (downloadRecord.status !== 'completed') {
            this.logDownloadEvent(downloadRecord, 'completed', {
              sourcePath,
              destinationPath,
            });
          }
          if (destinationPath && !downloadRecord.destinationPath) {
            downloadRecord.destinationPath = destinationPath;
          }
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
          // Clean up empty directories after deleting file
          await this.removeEmptyDirectories(sourcePath);
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
      // Rename succeeded - file is moved, source is automatically gone
      // Clean up empty directories after moving file
      await this.removeEmptyDirectories(sourcePath);
    } catch (error) {
      // If rename fails (different filesystems), copy and delete
      if (error.code === 'EXDEV') {
        // Copy file to destination
        await fs.copyFile(sourcePath, destinationPath);
        
        // Verify copy succeeded before deleting source
        try {
          const destStats = await fs.stat(destinationPath);
          const sourceStats = await fs.stat(sourcePath);
          if (destStats.size === sourceStats.size) {
            // Copy verified - safe to delete source
            await fs.unlink(sourcePath);
            // Clean up empty directories after deleting file
            await this.removeEmptyDirectories(sourcePath);
          } else {
            throw new Error(`Copy verification failed: destination size (${destStats.size}) doesn't match source (${sourceStats.size})`);
          }
        } catch (deleteError) {
          console.error(`Failed to delete source file from slskd directory after copy: ${sourcePath}`, deleteError.message);
          // Don't throw - file is copied successfully, we'll try to clean up later if needed
        }
      } else {
        throw error;
      }
    }

    return destinationPath;
  }

  async moveFileToWeeklyFlow(sourcePath, downloadRecord) {
    const rootFolder = libraryManager.getRootFolder(); // Always /data
    const weeklyFlowFolder = path.join(rootFolder, 'Weekly Flow');
    
    // Create folder structure: Weekly Flow/Artist Name - Track Name.ext
    const artistName = downloadRecord.artistName || 'Unknown Artist';
    const trackName = downloadRecord.trackName || 'Unknown Track';
    const sourceExt = path.extname(sourcePath);
    
    // Sanitize names for filesystem
    const sanitizedArtist = artistName.replace(/[<>:"/\\|?*]/g, '_').trim();
    const sanitizedTrack = trackName.replace(/[<>:"/\\|?*]/g, '_').trim();
    const fileName = `${sanitizedArtist} - ${sanitizedTrack}${sourceExt}`;
    const destinationPath = path.join(weeklyFlowFolder, fileName);

    // Create weekly flow directory
    try {
      await fs.mkdir(weeklyFlowFolder, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw new Error(`Failed to create weekly flow directory "${weeklyFlowFolder}": ${error.message}`);
      }
    }

    // If destination already exists, add a number suffix
    let finalDestination = destinationPath;
    let counter = 1;
    while (true) {
      try {
        await fs.access(finalDestination);
        // File exists, try with counter
        const nameWithoutExt = path.basename(fileName, sourceExt);
        finalDestination = path.join(weeklyFlowFolder, `${nameWithoutExt} (${counter})${sourceExt}`);
        counter++;
      } catch (error) {
        // File doesn't exist, we can use this path
        break;
      }
    }

    // Move file
    try {
      await fs.rename(sourcePath, finalDestination);
      // Rename succeeded - file is moved, source is automatically gone
      // Clean up empty directories after moving file
      await this.removeEmptyDirectories(sourcePath);
    } catch (error) {
      // If rename fails (different filesystems), copy and delete
      if (error.code === 'EXDEV') {
        // Copy file to destination
        await fs.copyFile(sourcePath, finalDestination);
        
        // Verify copy succeeded before deleting source
        try {
          const destStats = await fs.stat(finalDestination);
          const sourceStats = await fs.stat(sourcePath);
          if (destStats.size === sourceStats.size) {
            // Copy verified - safe to delete source
            await fs.unlink(sourcePath);
            // Clean up empty directories after deleting file
            await this.removeEmptyDirectories(sourcePath);
          } else {
            throw new Error(`Copy verification failed: destination size (${destStats.size}) doesn't match source (${sourceStats.size})`);
          }
        } catch (deleteError) {
          console.error(`Failed to delete source file from slskd directory after copy: ${sourcePath}`, deleteError.message);
          // Don't throw - file is copied successfully, we'll try to clean up later if needed
        }
      } else {
        throw error;
      }
    }

    console.log(`Moved weekly flow track to: ${finalDestination}`);
    return finalDestination;
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
      // Rename succeeded - file is moved, source is automatically gone
      // Clean up empty directories after moving file
      await this.removeEmptyDirectories(sourcePath);
    } catch (error) {
      // If rename fails (different filesystems), copy and delete
      if (error.code === 'EXDEV') {
        // Copy file to destination
        await fs.copyFile(sourcePath, finalDestination);
        
        // Verify copy succeeded before deleting source
        try {
          const destStats = await fs.stat(finalDestination);
          const sourceStats = await fs.stat(sourcePath);
          if (destStats.size === sourceStats.size) {
            // Copy verified - safe to delete source
            await fs.unlink(sourcePath);
            // Clean up empty directories after deleting file
            await this.removeEmptyDirectories(sourcePath);
          } else {
            throw new Error(`Copy verification failed: destination size (${destStats.size}) doesn't match source (${sourceStats.size})`);
          }
        } catch (deleteError) {
          console.error(`Failed to delete source file from slskd directory after copy: ${sourcePath}`, deleteError.message);
          // Don't throw - file is copied successfully, we'll try to clean up later if needed
        }
      } else {
        throw error;
      }
    }

    return finalDestination;
  }

  /**
   * Queue an album for download (uses global queue system)
   */
  async queueAlbumDownload(artistId, albumId) {
    const artist = libraryManager.getArtistById(artistId);
    const album = libraryManager.getAlbumById(albumId);
    
    if (!artist || !album) {
      throw new Error('Artist or album not found');
    }

    // Create download record
    const downloadRecord = {
      id: this.generateId(),
      type: 'album',
      artistId,
      albumId,
      artistName: artist.artistName,
      albumName: album.albumName,
      status: 'requested',
      retryCount: 0,
      requeueCount: 0,
      progress: 0,
      events: [],
    };

    // Log requested event
    this.logDownloadEvent(downloadRecord, 'requested', {
      albumName: album.albumName,
      artistName: artist.artistName,
    });

    // Add to global queue
    await downloadQueue.enqueue(downloadRecord);

    return downloadRecord;
  }

  /**
   * Download album (internal method - called by queue system)
   */
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
      
      // Get the album's tracklist from MusicBrainz for matching (optional - download will proceed without it)
      let tracklist = [];
      if (album.mbid) {
        try {
          // First try to get tracks from database (fastest, no API call)
          const tracks = libraryManager.getTracks(albumId);
          if (tracks && tracks.length > 0) {
            // Use existing tracks from database
            tracklist = tracks.map(t => ({
              title: t.trackName,
              position: t.trackNumber || 0,
              mbid: t.mbid,
            }));
          } else {
            // Try to fetch tracklist from MusicBrainz if not in database
            // Use a timeout to avoid blocking if MusicBrainz is slow/unavailable
            const { musicbrainzRequest } = await import('./apiClients.js');
            const tracklistPromise = (async () => {
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
            })();
            
            // Wait max 5 seconds for tracklist, then proceed without it
            try {
              await Promise.race([
                tracklistPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
              ]);
            } catch (timeoutError) {
              // Timeout or error - proceed without tracklist
              console.warn(`Tracklist fetch timed out or failed for album ${album.mbid}, proceeding without it`);
            }
          }
        } catch (error) {
          // MusicBrainz unavailable - proceed without tracklist matching
          console.warn(`Could not fetch tracklist for album ${album.mbid}:`, error.message);
          console.warn('Proceeding with download - files will be selected without tracklist matching');
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
          status: 'requested',
          slskdDownloadId: downloadId,
          username: downloadObj.username || download.username,
          filename: downloadObj.filename || download.filename,
          retryCount: 0,
          requeueCount: 0,
          progress: 0,
          events: [],
          trackTitle: download.track?.title,
          trackPosition: download.track?.position,
        };
        
        // Log initial requested event
        this.logDownloadEvent(downloadRecord, 'requested', {
          trackTitle: download.track?.title,
          filename: downloadObj.filename || download.filename,
        });
        
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
    
    const downloadRecord = {
      id: download.id || this.generateId(),
      type: 'track',
      artistId,
      trackId,
      status: 'requested',
      slskdDownloadId: download.id,
      username: download.username,
      filename: download.filename,
      retryCount: 0,
      requeueCount: 0,
      progress: 0,
      events: [],
    };
    
    // Log initial requested event
    this.logDownloadEvent(downloadRecord, 'requested', {
      filename: download.filename,
      username: download.username,
    });
    
    db.data.downloads.push(downloadRecord);
    
    await db.write();
    
    return download;
  }

  /**
   * Queue a weekly flow track for download (uses global queue system)
   */
  async queueWeeklyFlowTrack(artistId, trackName, artistMbid) {
    const artist = libraryManager.getArtistById(artistId);
    
    if (!artist) {
      throw new Error('Artist not found');
    }

    // Create download record
    const downloadRecord = {
      id: this.generateId(),
      type: 'weekly-flow',
      artistId,
      artistMbid,
      artistName: artist.artistName,
      trackName,
      status: 'requested',
      retryCount: 0,
      requeueCount: 0,
      progress: 0,
      events: [],
    };

    // Log requested event
    this.logDownloadEvent(downloadRecord, 'requested', {
      trackName,
      artistName: artist.artistName,
    });

    // Add to global queue (weekly flow gets lower priority automatically)
    await downloadQueue.enqueue(downloadRecord);

    return downloadRecord;
  }

  /**
   * Download weekly flow track (internal method - called by queue system)
   */
  async downloadWeeklyFlowTrack(artistId, trackName, artistMbid) {
    const artist = libraryManager.getArtistById(artistId);
    
    if (!artist) {
      throw new Error('Artist not found');
    }

    if (!slskdClient.isConfigured()) {
      throw new Error('slskd not configured');
    }

    // Search and download - same as regular track download
    let download;
    try {
      download = await slskdClient.downloadTrack(artist.artistName, trackName);
      
      if (!download || !download.id) {
        throw new Error(`Download failed: slskd did not return a download ID for ${artist.artistName} - ${trackName}`);
      }
    } catch (error) {
      // Log the error with more context
      console.error(`[WEEKLY FLOW] Failed to initiate download for ${artist.artistName} - ${trackName}:`, error.message);
      throw error;
    }
    
    // Store download reference - same structure as regular downloads
    if (!db.data.downloads) {
      db.data.downloads = [];
    }
    
    // Store the full download response from slskd for later reference
    const downloadRecord = {
      id: download.id || this.generateId(),
      type: 'weekly-flow',
      artistId,
      artistMbid,
      artistName: artist.artistName,
      trackName,
      status: 'downloading', // Start as downloading since it's queued in slskd
      slskdDownloadId: download.id,
      username: download.username,
      filename: download.filename,
      slskdFilePath: download.filePath || download.destinationPath || download.path || download.file || download.localPath,
      retryCount: 0,
      requeueCount: 0,
      progress: 0,
      events: [],
    };
    
    // Log initial requested and queued events
    this.logDownloadEvent(downloadRecord, 'requested', {
      trackName,
      artistName: artist.artistName,
      filename: download.filename,
    });
    this.logDownloadEvent(downloadRecord, 'queued', {
      slskdDownloadId: download.id,
      username: download.username,
    });
    
    db.data.downloads.push(downloadRecord);
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
      
      const maxRetries = 3;
      if (downloadRecord.retryCount >= maxRetries) {
        // Max retries reached, mark as failed
        this.logDownloadEvent(downloadRecord, 'failed', {
          error: errorMessage,
          retryCount: downloadRecord.retryCount,
          maxRetries,
          reason: 'max_retries_reached',
        });
        downloadRecord.queueCleaned = false; // Let QueueCleaner handle it
        console.log(
          `Download ${downloadRecord.id} failed after ${maxRetries} retries. Last error: ${errorMessage}. Marking as failed for QueueCleaner.`,
        );
        await db.write();
        return;
      }
      
      // Log failure but will retry
      this.logDownloadEvent(downloadRecord, 'failed', {
        error: errorMessage,
        retryCount: downloadRecord.retryCount,
        willRetry: true,
      });
      
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
      this.logDownloadEvent(downloadRecord, 'requeued', {
        retryCount: downloadRecord.retryCount,
        reason: 'failed_download_retry',
      });
      await db.write();
      await this.retryDownload(downloadRecord);
    } catch (error) {
      console.error(`Error handling failed download ${downloadRecord.id}:`, error.message);
      // Mark as failed if retry itself fails
      this.logDownloadEvent(downloadRecord, 'failed', {
        error: `Retry failed: ${error.message}`,
        retryCount: downloadRecord.retryCount,
        reason: 'retry_operation_failed',
      });
      await db.write();
    }
  }

  async handleStalledDownload(downloadRecord, slskdDownload) {
    try {
      // Similar to failed download, but for stalled ones
      downloadRecord.retryCount = (downloadRecord.retryCount || 0) + 1;
      const errorMessage = `Download stalled - no progress for extended period (${downloadRecord.progress || 0}% complete)`;
      
      const maxRetries = 3;
      if (downloadRecord.retryCount >= maxRetries) {
        this.logDownloadEvent(downloadRecord, 'failed', {
          error: errorMessage,
          retryCount: downloadRecord.retryCount,
          maxRetries,
          reason: 'stalled_max_retries',
        });
        console.log(
          `Download ${downloadRecord.id} stalled after ${maxRetries} retries. Marking as failed.`,
        );
        await db.write();
        return;
      }
      
      // Log stalled event (already logged in checkCompletedDownloads, but ensure it's here too)
      if (!downloadRecord.stalledAt) {
        this.logDownloadEvent(downloadRecord, 'stalled', {
          progress: downloadRecord.progress || 0,
          retryCount: downloadRecord.retryCount,
        });
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
      this.logDownloadEvent(downloadRecord, 'requeued', {
        retryCount: downloadRecord.retryCount,
        reason: 'stalled_download_retry',
      });
      await db.write();
      await this.retryDownload(downloadRecord);
    } catch (error) {
      console.error(`Error handling stalled download ${downloadRecord.id}:`, error.message);
      // Mark as failed if retry itself fails
      this.logDownloadEvent(downloadRecord, 'failed', {
        error: `Stalled retry failed: ${error.message}`,
        retryCount: downloadRecord.retryCount,
        reason: 'stalled_retry_operation_failed',
      });
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
            this.logDownloadEvent(downloadRecord, 'requeued', {
              reason: 'retry_failed_track',
              trackTitle,
              retryCount: downloadRecord.retryCount,
            });
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
              
              const downloadObj = download.enqueued && download.enqueued.length > 0 
                ? download.enqueued[0] 
                : download;
              
              // Track which usernames we've tried
              if (!downloadRecord.triedUsernames) {
                downloadRecord.triedUsernames = [];
              }
              if (downloadRecord.username) {
                downloadRecord.triedUsernames.push(downloadRecord.username);
              }
              if (downloadObj?.username) {
                downloadRecord.triedUsernames.push(downloadObj.username);
                downloadRecord.username = downloadObj.username;
              }
              
              // Log requeue event
              this.logDownloadEvent(downloadRecord, 'requeued', {
                newSlskdDownloadId: downloadId,
                newUsername: downloadObj?.username,
                retryCount: downloadRecord.retryCount,
                reason: 'retry_failed_track',
              });
              
              // Log queued event
              this.logDownloadEvent(downloadRecord, 'queued', {
                slskdDownloadId: downloadId,
              });
              
              await db.write();
              console.log(`Retry initiated for track "${trackTitle}" with new download ID: ${downloadId}`);
            } else {
              console.error(`Failed to get download ID from retry result for track "${trackTitle}"`);
              this.logDownloadEvent(downloadRecord, 'failed', {
                error: 'Failed to get download ID from retry result',
                retryCount: downloadRecord.retryCount,
              });
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
          this.logDownloadEvent(downloadRecord, 'requeued', {
            reason: 'retry_failed_track',
            retryCount: downloadRecord.retryCount,
          });
          downloadRecord.retryStartedAt = new Date().toISOString();
          await db.write();
          
          const download = await slskdClient.downloadTrack(artist.artistName, track.trackName, {
            excludeUsernames: downloadRecord.triedUsernames || [],
          });
          
          downloadRecord.slskdDownloadId = download.id;
          downloadRecord.username = download.username;
          downloadRecord.filename = download.filename;
          
          // Log queued and started events
          this.logDownloadEvent(downloadRecord, 'queued', {
            slskdDownloadId: download.id,
          });
          this.logDownloadEvent(downloadRecord, 'started', {
            slskdDownloadId: download.id,
            username: download.username,
          });
          
          await db.write();
        }
      }
    } catch (error) {
      console.error(`Error retrying download ${downloadRecord.id}:`, error.message);
      this.logDownloadEvent(downloadRecord, 'failed', {
        error: `Retry operation failed: ${error.message}`,
        retryCount: downloadRecord.retryCount,
        reason: 'retry_operation_exception',
      });
      await db.write();
    }
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}

export const downloadManager = new DownloadManager();
