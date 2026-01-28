import { slskdClient } from './slskdClient.js';
import { libraryManager } from './libraryManager.js';
import { fileScanner } from './fileScanner.js';
import { dbOps } from '../config/db-helpers.js';
import { dbHelpers } from '../config/db-sqlite.js';
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
    this.downloadCheckInterval = null; // Track interval so we can clear it
    this.startDownloadMonitor();
    this.initializeDownloadDirectory();
    this.recoveryCompleted = false; // Track if startup recovery has run
  }

  /**
   * Classify error type for smart retry strategies
   * Returns: 'rate_limit', 'network', 'server_error', 'not_found', 'permanent', 'unknown'
   */
  classifyError(error) {
    if (!error) return 'unknown';

    // Rate limit errors (429)
    if (error.response?.status === 429 || 
        error.message?.toLowerCase().includes('rate limit') ||
        error.message?.toLowerCase().includes('too many requests') ||
        error.response?.data?.error?.toLowerCase().includes('rate limit')) {
      return 'rate_limit';
    }

    // Network errors (connection refused, timeout, etc.)
    if (error.code === 'ECONNREFUSED' || 
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.message?.toLowerCase().includes('connect') ||
        error.message?.toLowerCase().includes('timeout') ||
        error.message?.toLowerCase().includes('network')) {
      return 'network';
    }

    // Not found errors (404) - usually permanent
    if (error.response?.status === 404 ||
        error.message?.toLowerCase().includes('not found') ||
        error.message?.toLowerCase().includes('404')) {
      return 'not_found';
    }

    // Server errors (500-503) - usually transient
    if (error.response?.status >= 500 && error.response?.status < 504) {
      return 'server_error';
    }

    // Permanent client errors (400, 401, 403) - don't retry
    if (error.response?.status >= 400 && error.response?.status < 500) {
      return 'permanent';
    }

    return 'unknown';
  }

  /**
   * Get retry strategy based on error type
   * Returns: { maxRetries, backoffMs, shouldRetry }
   */
  getRetryStrategy(errorType, retryCount = 0) {
    const strategies = {
      rate_limit: {
        maxRetries: 5,
        backoffMs: (attempt) => {
          // Exponential backoff with jitter: 5min, 10min, 15min, 20min, 25min
          const baseDelay = 5 * 60 * 1000; // 5 minutes
          const jitter = Math.random() * 2 * 60 * 1000; // 0-2 minutes jitter
          return baseDelay * attempt + jitter;
        },
        shouldRetry: true,
      },
      network: {
        maxRetries: 10,
        backoffMs: (attempt) => {
          // Linear backoff: 30s, 1min, 2min, 3min, etc.
          return Math.min(attempt * 30 * 1000, 5 * 60 * 1000); // Cap at 5 minutes
        },
        shouldRetry: true,
      },
      server_error: {
        maxRetries: 3,
        backoffMs: (attempt) => {
          // Exponential backoff: 2min, 4min, 8min
          return Math.pow(2, attempt) * 60 * 1000;
        },
        shouldRetry: true,
      },
      not_found: {
        maxRetries: 0,
        backoffMs: () => 0,
        shouldRetry: false,
      },
      permanent: {
        maxRetries: 0,
        backoffMs: () => 0,
        shouldRetry: false,
      },
      unknown: {
        maxRetries: 3,
        backoffMs: (attempt) => {
          // Default exponential backoff: 1min, 2min, 4min
          return Math.pow(2, attempt) * 60 * 1000;
        },
        shouldRetry: true,
      },
    };

    return strategies[errorType] || strategies.unknown;
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
    // Check downloads every 30 seconds - don't spam slskd API
    // Downloads are also checked when files are found, so this is just a backup
    if (this.downloadCheckInterval) {
      clearInterval(this.downloadCheckInterval);
    }
    this.downloadCheckInterval = setInterval(() => {
      this.checkCompletedDownloads();
    }, 30000); // 30 seconds instead of 10
    
    // Check for failed downloads that should be requeued every 5 minutes
    setInterval(() => {
      this.checkFailedDownloadsForRequeue();
    }, 5 * 60 * 1000);
  }

  /**
   * Recover download state on startup
   * Reconciles database state with slskd state to handle crashes and inconsistencies
   */
  async recoverDownloadState() {
    if (this.recoveryCompleted) {
      return; // Already recovered
    }

    if (!slskdClient.isConfigured()) {
      console.log('[Download Recovery] slskd not configured, skipping recovery');
      this.recoveryCompleted = true;
      return;
    }

    console.log('[Download Recovery] Starting download state recovery...');
    libraryMonitor.log('info', 'download', 'Starting download state recovery');

    try {
      // Get all downloads from database that are in progress
      const dbDownloads = dbOps.getDownloads().filter(
        d => d.status === 'downloading' || 
             d.status === 'queued' || 
             d.status === 'requested' ||
             (d.status === 'failed' && (d.retryCount || 0) < 3)
      );

      console.log(`[Download Recovery] Found ${dbDownloads.length} in-progress downloads in database`);

      // Get all downloads from slskd
      let slskdDownloads = [];
      try {
        slskdDownloads = await slskdClient.getDownloads();
        
        // Flatten if nested structure
        if (Array.isArray(slskdDownloads) && slskdDownloads.length > 0) {
          const firstItem = slskdDownloads[0];
          if (firstItem && typeof firstItem === 'object' && firstItem.directories && !firstItem.id) {
            const flattened = [];
            for (const userObj of slskdDownloads) {
              if (userObj.directories && Array.isArray(userObj.directories)) {
                for (const dir of userObj.directories) {
                  if (dir.files && Array.isArray(dir.files)) {
                    flattened.push(...dir.files);
                  }
                }
              }
            }
            if (flattened.length > 0) {
              slskdDownloads = flattened;
            }
          }
        }
      } catch (error) {
        console.warn('[Download Recovery] Could not fetch downloads from slskd:', error.message);
      }

      console.log(`[Download Recovery] Found ${slskdDownloads.length} downloads in slskd`);

      let recovered = 0;
      let orphaned = 0;
      let completed = 0;
      let failed = 0;

      // Reconcile database downloads with slskd downloads
      for (const dbDownload of dbDownloads) {
        try {
          // Find matching slskd download by ID
          const slskdDownload = slskdDownloads.find(
            d => {
              const dbId = dbDownload.slskdDownloadId?.toString();
              const slskdId = d.id?.toString();
              return dbId && slskdId && dbId === slskdId;
            }
          );

          if (slskdDownload) {
            // Download exists in slskd - check its state
            const state = slskdDownload.state || slskdDownload.status;
            const normalizedState = this.normalizeState(state);

            if (normalizedState === 'completed') {
              // DB says downloading but slskd says completed - process completion
              console.log(`[Download Recovery] Found completed download: ${dbDownload.id} (slskd ID: ${slskdDownload.id})`);
              this.logDownloadEvent(dbDownload, 'recovered', {
                action: 'process_completion',
                slskdState: state,
              });
              await this.handleCompletedDownload(slskdDownload);
              completed++;
            } else if (normalizedState === 'failed' || normalizedState === 'cancelled') {
              // DB says downloading but slskd says failed - handle failure
              console.log(`[Download Recovery] Found failed download: ${dbDownload.id} (slskd ID: ${slskdDownload.id}, state: ${state})`);
              const errorMsg = slskdDownload.error || slskdDownload.errorMessage || state;
              const error = { message: errorMsg, response: { status: 500 } };
              await this.handleFailedDownload(dbDownload, slskdDownload, error);
              failed++;
            } else {
              // Still downloading/queued - update progress if available
              const progress = slskdDownload.percentComplete || slskdDownload.progress || 0;
              if (progress !== dbDownload.progress) {
                this.logDownloadEvent(dbDownload, 'recovered', {
                  action: 'update_progress',
                  progress,
                  slskdState: state,
                });
                dbDownload.progress = progress;
                dbOps.updateDownload(dbDownload.id, dbDownload);
              }
              recovered++;
            }
          } else {
            // Download not found in slskd - check if file exists (might have completed)
            const startedAt = new Date(dbDownload.startedAt || dbDownload.requestedAt || new Date());
            const minutesElapsed = (new Date() - startedAt) / (1000 * 60);

            if (minutesElapsed > 5) {
              // Been more than 5 minutes - likely completed or failed
              // Check if file exists in download directory
              if (dbDownload.destinationPath || dbDownload.filename) {
                try {
                  const filePath = dbDownload.destinationPath || 
                                 (this.slskdDownloadDir && path.join(this.slskdDownloadDir, dbDownload.filename));
                  
                  if (filePath) {
                    try {
                      await fs.access(filePath);
                      // File exists - download completed but wasn't processed
                      console.log(`[Download Recovery] Found completed file for orphaned download: ${dbDownload.id}`);
                      this.logDownloadEvent(dbDownload, 'recovered', {
                        action: 'process_orphaned_file',
                        filePath,
                      });
                      // Create a mock slskd download object for processing
                      const mockDownload = {
                        id: dbDownload.slskdDownloadId,
                        filename: dbDownload.filename,
                        state: 'completed',
                        filePath: filePath,
                      };
                      await this.handleCompletedDownload(mockDownload);
                      completed++;
                      continue;
                    } catch (fileError) {
                      // File doesn't exist
                    }
                  }
                } catch (error) {
                  // Ignore errors checking file
                }
              }

              // File doesn't exist and not in slskd - likely failed or timed out
              if (minutesElapsed > 30) {
                console.log(`[Download Recovery] Orphaned download (not in slskd, no file): ${dbDownload.id} (${Math.round(minutesElapsed)}m old)`);
                const error = { message: 'Download not found in slskd and file does not exist', response: { status: 404 } };
                await this.handleFailedDownload(dbDownload, null, error);
                orphaned++;
              } else {
                // Too recent - might still be processing, keep as is
                recovered++;
              }
            } else {
              // Too recent - might still be queued
              recovered++;
            }
          }
        } catch (error) {
          console.error(`[Download Recovery] Error processing download ${dbDownload.id}:`, error.message);
        }
      }

      // Check for downloads in slskd that aren't in our database (orphaned in slskd)
      for (const slskdDownload of slskdDownloads) {
        const existsInDb = dbDownloads.some(
          d => {
            const dbId = d.slskdDownloadId?.toString();
            const slskdId = slskdDownload.id?.toString();
            return dbId && slskdId && dbId === slskdId;
          }
        );

        if (!existsInDb) {
          const state = slskdDownload.state || slskdDownload.status;
          const normalizedState = this.normalizeState(state);
          
          if (normalizedState === 'completed') {
            // Orphaned completed download - try to process it
            console.log(`[Download Recovery] Found orphaned completed download in slskd: ${slskdDownload.id}`);
            try {
              await this.handleCompletedDownload(slskdDownload);
            } catch (error) {
              console.warn(`[Download Recovery] Could not process orphaned download ${slskdDownload.id}:`, error.message);
            }
          }
        }
      }

      console.log(`[Download Recovery] Recovery complete:`);
      console.log(`  - Recovered: ${recovered}`);
      console.log(`  - Completed: ${completed}`);
      console.log(`  - Failed: ${failed}`);
      console.log(`  - Orphaned: ${orphaned}`);

      libraryMonitor.log('info', 'download', 'Download state recovery complete', {
        recovered,
        completed,
        failed,
        orphaned,
      });

      this.recoveryCompleted = true;
    } catch (error) {
      console.error('[Download Recovery] Error during recovery:', error.message);
      libraryMonitor.log('error', 'download', 'Download state recovery failed', {
        error: error.message,
      });
      this.recoveryCompleted = true; // Mark as completed even on error to prevent retries
    }
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

      const allDownloads = dbOps.getDownloads();
      const failedDownloads = allDownloads.filter(
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
          
          dbOps.updateDownload(download.id, {
            lastRequeueAttempt: new Date().toISOString(),
          });
          
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
    // Check for errored/failed states FIRST before checking completed
    // This handles "Completed, Errored" correctly (treats as failed, not completed)
    if (stateStr.includes('errored') || stateStr.includes('error') || stateStr.includes('failed')) return 'failed';
    if (stateStr.includes('completed') || stateStr === 'complete') return 'completed';
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
      const trackedDownloads = dbOps.getDownloads({ status: 'downloading' })
        .concat(dbOps.getDownloads({ status: 'requested' }));
      
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
        const weeklyFlowRecord = dbOps.getDownloads().find(
          d => d.type === 'weekly-flow' && 
               (d.slskdDownloadId?.toString() === downloadIdStr || d.slskdDownloadId === download.id ||
                d.id?.toString() === downloadIdStr || d.id === download.id)
        );
        
        if (normalizedState === 'completed') {
          completedCount++;
          // Check if we've already processed this download
          const downloadRecord = dbOps.getDownloads().find(
            d => {
              const recordIdStr = d.slskdDownloadId?.toString();
              const recordDbIdStr = d.id?.toString();
              return (recordIdStr === downloadIdStr || 
                      d.slskdDownloadId === download.id ||
                      recordDbIdStr === downloadIdStr ||
                      d.id === download.id) && 
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
            const existingRecord = weeklyFlowRecord || dbOps.getDownloads().find(
              d => {
                const recordIdStr = d.slskdDownloadId?.toString();
                const recordDbIdStr = d.id?.toString();
                return recordIdStr === downloadIdStr || d.slskdDownloadId === download.id ||
                       recordDbIdStr === downloadIdStr || d.id === download.id;
              }
            );
            
            if (existingRecord) {
              // Update existing record
              this.logDownloadEvent(existingRecord, 'completed', {
                slskdState: state,
                filename: download.filename,
              });
              // Download record updated via dbOps.updateDownload
              await this.handleCompletedDownload(download);
            } else {
              // New download we weren't tracking - handle it
              await this.handleCompletedDownload(download);
            }
            processedCount++;
          }
        } else if (normalizedState === 'failed') {
          // Handle failed/errored downloads
          const downloadRecord = dbOps.getDownloads().find(
            d => {
              const recordIdStr = d.slskdDownloadId?.toString();
              const recordDbIdStr = d.id?.toString();
              return (recordIdStr === downloadIdStr || 
                      d.slskdDownloadId === download.id ||
                      recordDbIdStr === downloadIdStr ||
                      d.id === download.id) && 
                      d.status !== 'failed';
            }
          );
          
          if (downloadRecord) {
            const errorMsg = download.error || download.errorMessage || state || 'Download failed';
            const error = { message: errorMsg, response: { status: 500 } };
            console.log(`Found failed download: ${downloadRecord.id} (slskd ID: ${download.id}, state: ${state})`);
            
            // For album tracks, immediately retry the failed track (don't wait for backoff)
            // This ensures we get the complete album as quickly as possible
            // We do this BEFORE handleFailedDownload to bypass backoff timing
            if (downloadRecord.type === 'album' && downloadRecord.albumId && 
                (downloadRecord.retryCount || 0) < 3) {
              console.log(`Immediately retrying failed album track "${downloadRecord.trackTitle || downloadRecord.id}" (bypassing backoff)...`);
              try {
                // Mark as failed first so handleFailedDownload doesn't try to retry again
                downloadRecord.status = 'failed';
                downloadRecord.failedAt = new Date().toISOString();
                downloadRecord.retryCount = (downloadRecord.retryCount || 0) + 1;
                this.logDownloadEvent(downloadRecord, 'failed', {
                  error: errorMsg,
                  errorType: 'transient',
                  retryCount: downloadRecord.retryCount,
                  willRetry: true,
                  immediateRetry: true,
                });
                dbOps.updateDownload(downloadRecord.id, downloadRecord);
                
                // Now immediately retry just this specific track
                downloadRecord.status = 'requested';
                downloadRecord.slskdDownloadId = null; // Clear old ID
                await this.retryDownload(downloadRecord);
                processedCount++;
                continue; // Skip handleFailedDownload since we already handled it
              } catch (retryError) {
                console.error(`Error immediately retrying failed track:`, retryError.message);
                // Fall through to handleFailedDownload for proper error handling
              }
            }
            
            // For non-album downloads or if immediate retry failed, use normal flow
            await this.handleFailedDownload(downloadRecord, download, error);
            processedCount++;
          }
        } else if (weeklyFlowRecord && (normalizedState === 'downloading' || normalizedState === 'queued' || state?.toLowerCase().includes('queued'))) {
          // Update download ID if we didn't have it before
          if (!weeklyFlowRecord.slskdDownloadId && download.id) {
            weeklyFlowRecord.slskdDownloadId = download.id;
            this.logDownloadEvent(weeklyFlowRecord, 'matched', {
              slskdDownloadId: download.id,
              matchedBy: 'slskd_check',
              slskdState: state,
            });
            // Download record updated via dbOps.updateDownload
            console.log(`[WEEKLY FLOW] ✓ Found download ID: ${weeklyFlowRecord.artistName} - ${weeklyFlowRecord.trackName} (ID: ${download.id}, state: ${state})`);
          }
          
          // Log progress for weekly-flow downloads
          const progress = download.percentComplete || download.progress || 0;
          if (progress > 0 && progress !== weeklyFlowRecord.progress) {
            weeklyFlowRecord.progress = progress;
            this.logDownloadEvent(weeklyFlowRecord, 'progress', {
              progress,
              slskdState: state,
            });
            console.log(`[WEEKLY FLOW] Download progress: ${weeklyFlowRecord.artistName} - ${weeklyFlowRecord.trackName} (${progress}%)`);
            // Download record updated via dbOps.updateDownload
          } else if (state?.toLowerCase().includes('queued')) {
            // Log when download is queued (especially "Queued, Remotely")
            console.log(`[WEEKLY FLOW] Download queued: ${weeklyFlowRecord.artistName} - ${weeklyFlowRecord.trackName} (state: ${state})`);
          }
        }
        
        // Also try to match downloads without IDs by filename/artist-track
        // This handles cases where download.id was undefined when queued
        if (download.id) {
          // Look for weekly-flow downloads without IDs that might match this slskd download
          const unmatchedWeeklyFlow = trackedDownloads.filter(
            d => d.type === 'weekly-flow' && (!d.slskdDownloadId || d.slskdDownloadId === undefined)
          );
          
          for (const unmatched of unmatchedWeeklyFlow) {
            const downloadFilename = download.filename || '';
            const downloadFilenameLower = downloadFilename.toLowerCase();
            const artistName = unmatched.artistName?.toLowerCase() || '';
            const trackName = unmatched.trackName?.toLowerCase() || '';
            
            // Check if this slskd download matches our unmatched record
            let matches = false;
            let matchReason = '';
            
            // Match by exact filename if we stored it
            if (unmatched.filename && downloadFilenameLower.includes(unmatched.filename.toLowerCase())) {
              matches = true;
              matchReason = 'exact_filename';
            }
            // Match by artist and track name in filename
            else if (artistName && trackName && downloadFilenameLower.includes(artistName) && downloadFilenameLower.includes(trackName)) {
              matches = true;
              matchReason = 'artist_track_in_filename';
            }
            // Match by track name only (for cases like "15 - The Hanging Tree" containing "The Hanging Tree")
            else if (trackName) {
              const trackWords = trackName.split(/\s+/).filter(w => w.length > 2);
              if (trackWords.length > 0 && trackWords.every(word => downloadFilenameLower.includes(word))) {
                // Also verify artist is somewhere (in path or username)
                const downloadPath = download.filePath || download.destinationPath || download.path || downloadFilename;
                const downloadPathLower = downloadPath.toLowerCase();
                if (downloadPathLower.includes(artistName) || download.username?.toLowerCase().includes(artistName)) {
                  matches = true;
                  matchReason = 'track_words_with_artist';
                }
              }
            }
            
            if (matches) {
              unmatched.slskdDownloadId = download.id;
              unmatched.filename = unmatched.filename || download.filename;
              unmatched.username = unmatched.username || download.username;
              this.logDownloadEvent(unmatched, 'matched', {
                slskdDownloadId: download.id,
                matchedBy: matchReason,
                filename: download.filename,
                slskdState: state,
              });
              // Download record updated via dbOps.updateDownload
              console.log(`[WEEKLY FLOW] ✓ Matched download: ${unmatched.artistName} - ${unmatched.trackName} (ID: ${download.id}, state: ${state}, matched by: ${matchReason})`);
              break; // Only match one per slskd download
            }
          }
        }
      }
      
      
      // Check for failed/stalled downloads and handle retries
      for (const trackedDownload of trackedDownloads) {
        // Find the corresponding slskd download
        let slskdDownload = downloads.find(
          d => d.id === trackedDownload.slskdDownloadId || d.id?.toString() === trackedDownload.slskdDownloadId
        );
        
        // If no match by ID and we don't have an ID, try matching by filename/artist-track
        if (!slskdDownload && !trackedDownload.slskdDownloadId && trackedDownload.type === 'weekly-flow') {
          const downloadFilename = trackedDownload.filename;
          const artistName = trackedDownload.artistName;
          const trackName = trackedDownload.trackName;
          
          // Try to match by filename or artist-track combination
          slskdDownload = downloads.find(d => {
            const dFilename = d.filename || '';
            const dFilenameLower = dFilename.toLowerCase();
            
            // Match by exact filename
            if (downloadFilename && dFilenameLower.includes(downloadFilename.toLowerCase())) {
              return true;
            }
            
            // Match by artist-track in filename
            if (artistName && trackName) {
              const artistLower = artistName.toLowerCase();
              const trackLower = trackName.toLowerCase();
              
              // Check if filename contains both artist and track
              if (dFilenameLower.includes(artistLower) && dFilenameLower.includes(trackLower)) {
                return true;
              }
              
              // Check for track name variations (e.g., "15 - The Hanging Tree" contains "The Hanging Tree")
              const trackWords = trackLower.split(/\s+/).filter(w => w.length > 2);
              if (trackWords.length > 0 && trackWords.every(word => dFilenameLower.includes(word))) {
                // Also check if artist name is in the path/filename
                if (dFilenameLower.includes(artistLower) || d.username?.toLowerCase().includes(artistLower)) {
                  return true;
                }
              }
            }
            
            return false;
          });
          
          // If we found a match, update the download record with the ID
          if (slskdDownload && slskdDownload.id) {
            trackedDownload.slskdDownloadId = slskdDownload.id;
            this.logDownloadEvent(trackedDownload, 'matched', {
              slskdDownloadId: slskdDownload.id,
              matchedBy: 'filename',
              filename: slskdDownload.filename,
            });
            // Download record updated via dbOps.updateDownload
            console.log(`[WEEKLY FLOW] Matched download by filename: ${artistName} - ${trackName} (ID: ${slskdDownload.id})`);
          }
        }
        
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
            // Download record updated via dbOps.updateDownload
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
            // Download record updated via dbOps.updateDownload
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
            // Download record updated via dbOps.updateDownload
            await this.handleCompletedDownload(slskdDownload);
          } else if (normalizedState === 'failed' || normalizedState === 'cancelled') {
            console.log(`Download ${trackedDownload.id} failed with state: ${state}`);
            const errorMsg = slskdDownload.error || slskdDownload.errorMessage || state;
            const error = { 
              message: errorMsg, 
              response: { status: 500 },
              ...(slskdDownload.error ? { response: { status: 500, data: { error: slskdDownload.error } } } : {})
            };
            this.logDownloadEvent(trackedDownload, normalizedState === 'cancelled' ? 'cancelled' : 'failed', {
              error: errorMsg,
              slskdState: state,
            });
            // Download record updated via dbOps.updateDownload
            await this.handleFailedDownload(trackedDownload, slskdDownload, error);
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
              // Download record updated via dbOps.updateDownload
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
              // Download record updated via dbOps.updateDownload
              await this.handleStalledDownload(trackedDownload, slskdDownload);
            } else if (progress !== lastProgress) {
              // Progress changed, update last progress
              trackedDownload.lastProgress = progress;
              // Download record updated via dbOps.updateDownload
            }
          } else {
            // Unknown state - log for debugging
            if (state !== trackedDownload.lastState) {
              console.log(`Download ${trackedDownload.id} state changed: ${state}`);
              trackedDownload.lastState = state;
              // Download record updated via dbOps.updateDownload
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
      
      // After processing all downloads, check for any albums that should be moved
      // This catches cases where all tracks are complete but the per-track check missed it
      await this.checkForCompletedAlbums();
    }
  }

  /**
   * Check for albums where all tracks are completed and move them to library
   * This is called after processing downloads to catch any albums that should be moved
   */
  async checkForCompletedAlbums() {
    try {
      const allDownloads = dbOps.getDownloads();
      
      // Group downloads by albumId and sessionId (only current/active sessions)
      // For records without session IDs, find the most recent active parent session
      const albumGroups = {};
      const albumSessions = {}; // Track active sessions per album
      
      // First, find all active parent sessions per album
      for (const download of allDownloads) {
        if (download.type === 'album' && download.albumId && download.isParent && !download.stale) {
          if (!albumSessions[download.albumId]) {
            albumSessions[download.albumId] = [];
          }
          albumSessions[download.albumId].push({
            id: download.id,
            requestedAt: download.requestedAt || download.startedAt || '0',
            status: download.status
          });
        }
      }
      
      // Sort sessions by date (most recent first) and get the active one
      for (const albumId in albumSessions) {
        albumSessions[albumId].sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
      }
      
      // Group track downloads by session
      for (const download of allDownloads) {
        if (download.type === 'album' && download.albumId && !download.isParent && !download.stale && !download.destinationPath) {
          let sessionId = download.downloadSessionId || download.parentDownloadId;
          
          // If no session ID, try to find the most recent active session for this album
          if (!sessionId && albumSessions[download.albumId] && albumSessions[download.albumId].length > 0) {
            const activeSession = albumSessions[download.albumId].find(s => 
              s.status === 'requested' || s.status === 'downloading' || s.status === 'searching' || s.status === 'adding'
            );
            if (activeSession) {
              sessionId = activeSession.id;
            } else {
              // No active session - use most recent one (backward compat)
              sessionId = albumSessions[download.albumId][0].id;
            }
          }
          
          const key = `${download.albumId}:${sessionId || 'legacy'}`;
          if (!albumGroups[key]) {
            albumGroups[key] = {
              albumId: download.albumId,
              sessionId: sessionId,
              downloads: []
            };
          }
          albumGroups[key].downloads.push(download);
        }
      }
      
      // Check each album group (by session) - prioritize active sessions
      const sortedGroups = Object.entries(albumGroups).sort(([keyA, groupA], [keyB, groupB]) => {
        // Prioritize groups with session IDs over legacy ones
        if (groupA.sessionId && !groupB.sessionId) return -1;
        if (!groupA.sessionId && groupB.sessionId) return 1;
        // If both have sessions, prefer the one with more recent downloads
        const aLatest = Math.max(...groupA.downloads.map(d => new Date(d.requestedAt || 0).getTime()));
        const bLatest = Math.max(...groupB.downloads.map(d => new Date(d.requestedAt || 0).getTime()));
        return bLatest - aLatest;
      });
      
      for (const [key, group] of sortedGroups) {
        const { albumId, sessionId, downloads: albumDownloads } = group;
        const completedCount = albumDownloads.filter(d => 
          d.status === 'completed' || d.tempFilePath
        ).length;
        const failedCount = albumDownloads.filter(d => 
          d.status === 'failed'
        ).length;
        const totalCount = albumDownloads.length;
        
        // If all tracks are complete and none failed, move them
        if (completedCount === totalCount && totalCount > 0 && failedCount === 0) {
          // Check if already moved (has destinationPath)
          const alreadyMoved = albumDownloads.every(d => d.destinationPath);
          if (!alreadyMoved) {
            const album = libraryManager.getAlbumById(albumId);
            if (album) {
              const artist = libraryManager.getArtistById(album.artistId);
              if (artist) {
                console.log(`[Album Completion Check] Found completed album "${album.albumName}" (${completedCount}/${totalCount} tracks) - moving to library...`);
                await this.moveCompletedAlbumTracks(album, artist, albumDownloads);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('[Album Completion Check] Error checking for completed albums:', error.message);
    }
  }

  /**
   * Move all completed tracks for an album to the library
   */
  async moveCompletedAlbumTracks(album, artist, albumDownloads) {
    try {
      console.log(`✓ Moving all ${albumDownloads.length} tracks for album "${album.albumName}" to library...`);
      
      for (const trackDownload of albumDownloads) {
        // Track is complete if it has tempFilePath (file was found) OR status is completed
        if (trackDownload.tempFilePath || trackDownload.status === 'completed') {
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
            trackDownload.status = 'added';
            dbOps.updateDownload(trackDownload.id, trackDownload);
          } catch (error) {
            console.error(`Error moving track "${trackDownload.trackTitle}" from ${trackDownload.tempFilePath}:`, error.message);
            // Keep tempFilePath so we can retry later
          }
        } else if (!trackDownload.tempFilePath) {
          console.warn(`Track "${trackDownload.trackTitle}" is marked completed but has no tempFilePath - may need to be re-found`);
        }
      }
      
      // Match all files to tracks and update track records directly
      const albumTracks = libraryManager.getTracks(album.id);
      for (const trackDownload of albumDownloads) {
        if (trackDownload.destinationPath) {
          try {
            // First, try to directly match by trackTitle
            let matchingTrack = null;
            if (trackDownload.trackTitle) {
              matchingTrack = albumTracks.find(t => 
                t.trackName && trackDownload.trackTitle &&
                (t.trackName.toLowerCase() === trackDownload.trackTitle.toLowerCase() ||
                 t.trackName.toLowerCase().includes(trackDownload.trackTitle.toLowerCase()) ||
                 trackDownload.trackTitle.toLowerCase().includes(t.trackName.toLowerCase()))
              );
            }
            
            // If no direct match, try by track position
            if (!matchingTrack && trackDownload.trackPosition) {
              matchingTrack = albumTracks.find(t => t.trackNumber === trackDownload.trackPosition);
            }
            
            // If we found a matching track, update it directly
            if (matchingTrack) {
              const stats = await fs.stat(trackDownload.destinationPath);
              await libraryManager.updateTrack(matchingTrack.id, {
                path: trackDownload.destinationPath,
                hasFile: true,
                size: stats.size,
              });
              console.log(`✓ Directly updated track "${matchingTrack.trackName}" with file path`);
            } else {
              // Fall back to fileScanner matching
              const wasMatched = await fileScanner.matchFileToTrack(
                {
                  path: trackDownload.destinationPath,
                  name: path.basename(trackDownload.destinationPath),
                  size: 0,
                },
                libraryManager.getAllArtists()
              );
              
              if (!wasMatched) {
                console.log(`File not matched: ${trackDownload.destinationPath}`);
              }
            }
          } catch (error) {
            console.error(`Error matching file ${trackDownload.destinationPath}:`, error.message);
          }
        }
      }
      
      // Force update album statistics after all tracks are updated
      await libraryManager.updateAlbumStatistics(album.id).catch(err => {
        console.error(`Failed to update album statistics:`, err.message);
      });
      
      // Update album request status - refresh tracks after updates
      const updatedAlbumTracks = libraryManager.getTracks(album.id);
      const tracksWithFiles = updatedAlbumTracks.filter(t => t.hasFile && t.path);
      const isComplete = updatedAlbumTracks.length > 0 && tracksWithFiles.length === updatedAlbumTracks.length;
      
      if (isComplete) {
        const albumRequests = dbOps.getAlbumRequests();
        const albumRequest = albumRequests.find(r => r.albumId === album.id);
        if (albumRequest && albumRequest.status !== 'available') {
          dbOps.updateAlbumRequest(album.id, { status: 'available' });
          libraryMonitor.log('info', 'request', 'Album request marked as available', {
            albumId: album.id,
            albumName: album.albumName,
          });
        }
      }
      
      console.log(`✓ Successfully moved all tracks for album "${album.albumName}" to library`);
    } catch (error) {
      console.error(`Error moving completed album tracks for "${album.albumName}":`, error.message);
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
      let downloadRecord = dbOps.getDownloads().find(
        d => {
          const recordIdStr = d.slskdDownloadId?.toString();
          const recordId = d.slskdDownloadId;
          const recordDbIdStr = d.id?.toString();
          const recordDbId = d.id;
          
          // Try exact ID matches first (check both slskdDownloadId and id fields)
          if (recordIdStr === downloadIdStr) return true;
          if (recordId === downloadId) return true;
          if (recordId === downloadIdStr) return true;
          if (recordIdStr === downloadId) return true;
          
          // Also check the record's id field (in case slskdDownloadId wasn't persisted)
          if (recordDbIdStr === downloadIdStr) return true;
          if (recordDbId === downloadId) return true;
          if (recordDbId === downloadIdStr) return true;
          if (recordDbIdStr === downloadId) return true;
          
          return false;
        }
      );
      
      // If no match by ID, try matching by filename (for orphaned downloads or weekly-flow)
      if (!downloadRecord && (downloadFilename || sourceFilename)) {
        const searchFilename = sourceFilename || downloadFilename;
        downloadRecord = dbOps.getDownloads().find(
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
        const allDownloads = dbOps.getDownloads();
        const downloadingCount = allDownloads.filter(d => d.status === 'downloading').length;
        console.warn(`Available download records (${allDownloads.length} total, ${downloadingCount} downloading):`, 
          allDownloads.slice(0, 10).map(d => ({
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
      
      // Extract track title from filename if not already set
      if (!downloadRecord.trackTitle && downloadFilename) {
        // Try to extract track name from filename (e.g., "04 - Does He Really Care.flac" -> "Does He Really Care")
        const trackMatch = downloadFilename.match(/(\d+\s*[-.]?\s*)(.+?)(\.\w+)?$/i);
        if (trackMatch && trackMatch[2]) {
          downloadRecord.trackTitle = trackMatch[2].trim();
        } else {
          // Fallback: use filename without extension
          downloadRecord.trackTitle = downloadFilename.replace(/\.\w+$/, '').trim();
        }
      }
      
      libraryMonitor.log('info', 'download', `Found download record for completed download`, {
        downloadId: download.id,
        trackTitle: downloadRecord.trackTitle || 'unknown',
        status: downloadRecord.status,
        albumId: downloadRecord.albumId,
        artistId: downloadRecord.artistId,
      });
      console.log(`✓ Found download record for ${download.id}: track "${downloadRecord.trackTitle || 'unknown'}", status: ${downloadRecord.status}`);

      // Skip tracks that are already moved to library (both status AND destinationPath must exist)
      // If status is "added" but no destinationPath, the move might have failed - process it again
      if (downloadRecord.status === 'added' && downloadRecord.destinationPath) {
        // Verify the file actually exists at destinationPath
        try {
          await fs.access(downloadRecord.destinationPath);
          console.log(`Skipping track "${downloadRecord.trackTitle || downloadRecord.id}" - already moved to library at ${downloadRecord.destinationPath}`);
          return; // Already moved and file exists, nothing to do
        } catch (error) {
          // File doesn't exist at destinationPath - move might have failed, process it again
          console.log(`Track "${downloadRecord.trackTitle || downloadRecord.id}" marked as added but file not found at ${downloadRecord.destinationPath} - reprocessing...`);
          downloadRecord.status = 'completed'; // Reset to completed so we can move it
          downloadRecord.destinationPath = null; // Clear invalid destinationPath
        }
      }

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
                // Verify sourcePath exists before storing it
                if (!sourcePath) {
                  console.error(`[ERROR] Cannot store tempFilePath for track "${downloadRecord.trackTitle || downloadRecord.id}" - sourcePath is undefined!`);
                  console.error(`Download ID: ${download.id}, Filename: ${download.filename}`);
                  return; // Can't proceed without sourcePath
                }
                
                // Store the file path but don't move yet - wait for all tracks
                downloadRecord.tempFilePath = sourcePath;
                downloadRecord.status = 'completed'; // Update status
                downloadRecord.completedAt = new Date().toISOString();
                
                console.log(`[DEBUG] Storing tempFilePath for track "${downloadRecord.trackTitle}": ${sourcePath}`);
                
                // Update trackTitle if we extracted it from filename
                if (downloadRecord.trackTitle && downloadRecord.trackTitle !== 'unknown') {
                  // Track title was extracted, keep it
                }
                
                this.logDownloadEvent(downloadRecord, 'completed', {
                  tempFilePath: sourcePath,
                  trackTitle: downloadRecord.trackTitle,
                });
                
                // Persist status update to database (CRITICAL - was missing!)
                dbOps.updateDownload(downloadRecord.id, {
                  status: 'completed',
                  completedAt: downloadRecord.completedAt,
                  tempFilePath: sourcePath,
                  trackTitle: downloadRecord.trackTitle,
                  events: downloadRecord.events,
                });
                
                const trackInfo = downloadRecord.trackTitle 
                  ? ` (track: "${downloadRecord.trackTitle}")` 
                  : '';
                console.log(
                  `✓ Album track${trackInfo} completed, waiting for remaining tracks...`,
                );
                
                // Check if all tracks for this album are now complete
                // Only count tracks from the CURRENT download session (not stale ones)
                const sessionId = downloadRecord.downloadSessionId || downloadRecord.parentDownloadId;
                
                // If no session ID, find the most recent active session for this album
                let activeSessionId = sessionId;
                if (!activeSessionId) {
                  // Find the most recent parent download record (session) for this album
                  const parentRecords = dbOps.getDownloads().filter(
                    d => d.albumId === downloadRecord.albumId && 
                         d.type === 'album' && 
                         d.isParent &&
                         (d.status === 'requested' || d.status === 'downloading' || d.status === 'searching' || d.status === 'adding')
                  ).sort((a, b) => {
                    const aTime = new Date(a.requestedAt || a.startedAt || 0);
                    const bTime = new Date(b.requestedAt || b.startedAt || 0);
                    return bTime - aTime; // Most recent first
                  });
                  
                  if (parentRecords.length > 0) {
                    activeSessionId = parentRecords[0].id;
                    console.log(`[Album Completion Check] Found active session: ${activeSessionId} for album "${album.albumName}"`);
                  } else {
                    // No parent record found - try to find the most recent session (even if not active)
                    // This handles cases where downloads completed but parent record status changed
                    const allParentRecords = dbOps.getDownloads().filter(
                      d => d.albumId === downloadRecord.albumId && 
                           d.type === 'album' && 
                           d.isParent &&
                           !d.stale
                    ).sort((a, b) => {
                      const aTime = new Date(a.requestedAt || a.startedAt || 0);
                      const bTime = new Date(b.requestedAt || b.startedAt || 0);
                      return bTime - aTime; // Most recent first
                    });
                    
                    if (allParentRecords.length > 0) {
                      activeSessionId = allParentRecords[0].id;
                      console.log(`[Album Completion Check] Found most recent session: ${activeSessionId} for album "${album.albumName}" (may not be active)`);
                    } else {
                      console.log(`[Album Completion Check] No session found - using backward compatibility mode for album "${album.albumName}"`);
                    }
                  }
                }
                
                // Refresh from database to get latest status, but also include the just-updated record
                // CRITICAL: Only count actual track records (not parent records, not stale)
                // For backward compatibility, if no session ID, get ALL track records for this album
                let allAlbumDownloads = dbOps.getDownloads().filter(
                  d => d.albumId === downloadRecord.albumId && 
                       d.type === 'album' && 
                       !d.isParent && // Exclude parent records (they're not tracks!)
                       !d.stale && // Exclude stale records
                       d.trackTitle // Must have a track title (parent records don't have this)
                );
                
                // If we have a session ID, filter by it. Otherwise, include all tracks (backward compat)
                if (activeSessionId) {
                  allAlbumDownloads = allAlbumDownloads.filter(d =>
                    d.downloadSessionId === activeSessionId || d.parentDownloadId === activeSessionId
                  );
                }
                
                // Ensure the just-updated downloadRecord is included with latest data
                const existingIndex = allAlbumDownloads.findIndex(d => d.id === downloadRecord.id);
                if (existingIndex >= 0) {
                  // Update the record in the array with the latest in-memory data
                  allAlbumDownloads[existingIndex] = { ...allAlbumDownloads[existingIndex], ...downloadRecord };
                } else if (downloadRecord.trackTitle && !downloadRecord.isParent) {
                  // If somehow not found but it's a valid track record, add it
                  allAlbumDownloads.push(downloadRecord);
                }
                
                // Separate tracks that are actually moved (have destinationPath AND file exists there) 
                // vs tracks still being downloaded or need to be moved
                const actuallyMovedTracks = [];
                const tracksToProcess = [];
                
                for (const d of allAlbumDownloads) {
                  if (d.destinationPath) {
                    // Check if file actually exists at destination
                    try {
                      await fs.access(d.destinationPath);
                      actuallyMovedTracks.push(d); // File exists, truly moved
                    } catch {
                      // File doesn't exist - treat as not moved, needs processing
                      tracksToProcess.push(d);
                    }
                  } else {
                    // No destinationPath - needs to be moved
                    tracksToProcess.push(d);
                  }
                }
                
                // Only count tracks that need processing (not actually moved)
                let albumDownloads = tracksToProcess;
                
                console.log(`[Album Completion Check] Total tracks: ${allAlbumDownloads.length}, Already moved: ${actuallyMovedTracks.length}, To process: ${tracksToProcess.length}`);
                
                // Debug: Show all tracks found
                if (allAlbumDownloads.length > 0) {
                  console.log(`[Album Completion Check] All tracks found:`, allAlbumDownloads.map(d => ({
                    id: d.id,
                    trackTitle: d.trackTitle,
                    status: d.status,
                    hasTempPath: !!d.tempFilePath,
                    hasDestPath: !!d.destinationPath,
                    sessionId: d.downloadSessionId || d.parentDownloadId || 'none'
                  })));
                }
                
                // If no active tracks found but we have already-moved tracks, that means the album is complete
                // But we still need to check if all tracks were moved
                if (albumDownloads.length === 0 && actuallyMovedTracks.length > 0) {
                  console.log(`[Album Completion Check] All tracks appear to be already moved (${alreadyMovedTracks.length} tracks with status 'added')`);
                  // Check if all tracks in the album have files
                  const albumTracks = libraryManager.getTracks(downloadRecord.albumId);
                  const tracksWithFiles = albumTracks.filter(t => t.hasFile && t.path);
                  if (tracksWithFiles.length === albumTracks.length && albumTracks.length > 0) {
                    console.log(`[Album Completion Check] Album "${album.albumName}" is already complete in library (${tracksWithFiles.length}/${albumTracks.length} tracks have files)`);
                    return; // Album is already complete, nothing to do
                  }
                }
                
                // Count completed: either status is 'completed' OR has tempFilePath (file found)
                const completedCount = albumDownloads.filter(d => 
                  d.status === 'completed' || d.tempFilePath
                ).length;
                // Count failed tracks - only count failures from CURRENT session (not stale ones)
                // Stale failed records shouldn't block completion
                const failedCount = albumDownloads.filter(d => 
                  d.status === 'failed' && !d.stale && 
                  (activeSessionId ? (d.downloadSessionId === activeSessionId || d.parentDownloadId === activeSessionId) : true)
                ).length;
                // Total count includes ALL tracks - we need the complete album
                const totalCount = albumDownloads.length;
                
                // Debug: Log what we're counting
                console.log(`[Album Completion Check] Album: "${album.albumName}", Session: ${activeSessionId || 'no-session'}, Track records: ${totalCount} (${completedCount} completed, ${failedCount} failed)`);
                if (totalCount !== 12 && totalCount > 0) {
                  console.log(`[Album Completion Check] WARNING: Expected 12 tracks but found ${totalCount}. Track IDs:`, albumDownloads.map(d => ({ id: d.id, trackTitle: d.trackTitle, isParent: d.isParent, stale: d.stale, status: d.status })));
                }
                
                // Update status to show progress
                this.updateDownloadStatus(downloadRecord.albumId, 'downloading', {
                  tracksCompleted: completedCount,
                  totalTracks: totalCount,
                  failedTracks: failedCount,
                });
                
                // Debug logging - show what's happening
                if (completedCount !== totalCount || failedCount > 0) {
                  const incompleteTracks = albumDownloads.filter(d => 
                    d.status !== 'completed' && !d.tempFilePath && d.status !== 'failed'
                  );
                  const failedTracks = albumDownloads.filter(d => d.status === 'failed');
                  if (incompleteTracks.length > 0) {
                    console.log(`[Album Completion Check] Incomplete tracks: ${incompleteTracks.map(t => `"${t.trackTitle || t.id}" (status: ${t.status})`).join(', ')}`);
                  }
                  if (failedTracks.length > 0) {
                    console.log(`[Album Completion Check] Failed tracks (will block completion): ${failedTracks.map(t => `"${t.trackTitle || t.id}" (stale: ${t.stale}, session: ${t.downloadSessionId || t.parentDownloadId || 'none'})`).join(', ')}`);
                  }
                }
                
                // If all tracks are complete (no failed tracks), move them all at once
                // Note: Tracks may be in different folders (from different users), but we move each
                // from its stored tempFilePath location to the final album folder
                // We require ALL tracks to be successful before importing - no partial albums
                if (completedCount === totalCount && totalCount > 0 && failedCount === 0) {
                  console.log(`✓ All ${totalCount} tracks completed for album "${album.albumName}" - moving all tracks to library...`);
                  
                  // Refresh from database one more time to get latest tempFilePath values
                  // Use the same filtering logic as above to get all tracks that need processing
                  const finalAlbumDownloads = dbOps.getDownloads().filter(
                    d => d.albumId === downloadRecord.albumId && 
                         d.type === 'album' && 
                         !d.isParent && 
                         !d.stale && 
                         d.trackTitle &&
                         !d.destinationPath // Only tracks that haven't been moved
                  );
                  
                  // Log what we found
                  console.log(`[Move Check] Found ${finalAlbumDownloads.length} tracks to move. tempFilePath status:`, 
                    finalAlbumDownloads.map(d => ({ track: d.trackTitle, hasTempPath: !!d.tempFilePath, tempPath: d.tempFilePath, status: d.status }))
                  );
                  
                  // Move all completed tracks (each may be from a different user/location)
                  for (const trackDownload of finalAlbumDownloads) {
                    // Track is complete if it has tempFilePath (file was found)
                    // Don't try to move tracks that don't have tempFilePath
                    if (trackDownload.tempFilePath) {
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
                  
                  // Download record updated via dbOps.updateDownload
                  
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
                  
                  if (isComplete) {
                    const albumRequests = dbOps.getAlbumRequests();
                    const albumRequest = albumRequests.find(r => r.albumId === downloadRecord.albumId);
                    if (albumRequest && albumRequest.status !== 'available') {
                      dbOps.updateAlbumRequest(downloadRecord.albumId, { status: 'available' });
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
              const track = libraryManager.getTracks(libraryManager.getAlbums(downloadRecord.artistId).find(a => 
                libraryManager.getTracks(a.id).some(t => t.id === downloadRecord.trackId)
              )?.id || '').find(t => t.id === downloadRecord.trackId);
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
                
                // Incrementally update Navidrome playlist when track is moved
                try {
                  const { playlistManager } = await import('./playlistManager.js');
                  const item = {
                    mbid: downloadRecord.artistMbid,
                    artistName: downloadRecord.artistName,
                    trackName: downloadRecord.trackName,
                  };
                  await playlistManager.addToNavidromePlaylist(item);
                } catch (e) {
                  console.warn(`Failed to update Navidrome playlist for completed download: ${e.message}`);
                }
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
                dbOps.updateDownload(downloadRecord.id, downloadRecord);
          
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

    // Check if source file exists before attempting move
    let sourceExists = false;
    try {
      await fs.access(sourcePath);
      sourceExists = true;
    } catch {
      // Source file doesn't exist - check if it was already moved
      try {
        await fs.access(destinationPath);
        console.log(`Source file not found but destination exists - file already moved: ${destinationPath}`);
        return destinationPath;
      } catch {
        throw new Error(`Source file does not exist and destination not found: ${sourcePath}`);
      }
    }

    // Check if file already exists at destination - if it does and is the same, skip moving
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
      // Destination doesn't exist, proceed with move
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

    // Check if source file exists before attempting move
    try {
      await fs.access(sourcePath);
    } catch {
      // Source file doesn't exist - check if it was already moved to any destination
      // Try to find it at the expected destination or with number suffixes
      let checkPath = destinationPath;
      let counter = 0;
      while (counter <= 10) {
        try {
          await fs.access(checkPath);
          console.log(`Source file not found but destination exists - file already moved: ${checkPath}`);
          return checkPath;
        } catch {
          if (counter === 0) {
            checkPath = destinationPath;
          } else {
            const nameWithoutExt = path.basename(trackFileName, sourceExt);
            checkPath = path.join(album.path, `${nameWithoutExt} (${counter})${sourceExt}`);
          }
          counter++;
        }
      }
      throw new Error(`Source file does not exist: ${sourcePath}`);
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

    // Check if album is already complete (all tracks have files)
    const albumTracks = libraryManager.getTracks(albumId);
    if (albumTracks.length > 0) {
      const tracksWithFiles = albumTracks.filter(t => t.hasFile && t.path);
      if (tracksWithFiles.length === albumTracks.length) {
        console.log(`[DownloadManager] Album "${album.albumName}" is already complete (${tracksWithFiles.length}/${albumTracks.length} tracks have files). Skipping queue.`);
        // Update album request status if needed
        const albumRequests = dbOps.getAlbumRequests();
        const albumRequest = albumRequests.find(r => r.albumId === albumId);
        if (albumRequest && albumRequest.status !== 'available') {
          dbOps.updateAlbumRequest(albumId, { status: 'available' });
        }
        // Return a mock record indicating it's already complete
        return {
          id: this.generateId(),
          type: 'album',
          artistId,
          albumId,
          status: 'added',
          message: 'Album already complete',
        };
      }
    }

    // Check if there are already active downloads for this album
    // But verify they actually have track downloads associated with them
    const existingDownloads = dbOps.getDownloads().filter(
      d => d.albumId === albumId && 
           d.type === 'album' && 
           (d.status === 'downloading' || d.status === 'requested' || d.status === 'searching' || d.status === 'adding' || d.status === 'queued')
    );
    
    if (existingDownloads.length > 0) {
      // Check if any of these downloads actually have track downloads (slskdDownloadId)
      // A valid album download should have created individual track download records
      const allAlbumDownloads = dbOps.getDownloads().filter(
        d => d.albumId === albumId && d.type === 'album'
      );
      
      // Check if there are any track downloads with slskdDownloadId (actual downloads in slskd)
      const hasActiveTrackDownloads = allAlbumDownloads.some(
        d => d.slskdDownloadId && (d.status === 'downloading' || d.status === 'requested' || d.status === 'completed')
      );
      
      if (hasActiveTrackDownloads) {
        const activeCount = existingDownloads.length;
        console.log(`[DownloadManager] Album "${album.albumName}" already has ${activeCount} active download(s) with track downloads queued or in progress. Skipping duplicate queue.`);
        console.log(`[DownloadManager] Active download statuses:`, existingDownloads.map(d => ({ id: d.id, status: d.status, trackTitle: d.trackTitle, slskdDownloadId: d.slskdDownloadId })));
        // Return the first existing download instead of creating a new one
        return existingDownloads[0];
      } else {
        // Existing download record exists but has no actual track downloads - it's stale
        console.warn(`[DownloadManager] Album "${album.albumName}" has stale download record(s) with no active track downloads. Clearing and queueing fresh download.`);
        console.warn(`[DownloadManager] Stale download IDs:`, existingDownloads.map(d => d.id));
        
        // Mark stale downloads as failed so they don't block new downloads
        for (const staleDownload of existingDownloads) {
          staleDownload.status = 'failed';
          staleDownload.lastError = 'Stale download - no track downloads found';
          dbOps.updateDownload(staleDownload.id, {
            status: 'failed',
            lastError: 'Stale download - no track downloads found',
          });
        }
        
        // Continue with new download queue
        console.log(`[DownloadManager] Proceeding with fresh download queue for "${album.albumName}"`);
      }
    }

    // Mark old download sessions as stale before creating new one
    // This ensures we only track the current/latest download attempt
    const oldDownloads = dbOps.getDownloads().filter(
      d => d.albumId === albumId && 
           d.type === 'album' && 
           d.status !== 'failed' && 
           d.status !== 'added' && 
           d.status !== 'completed'
    );
    
    if (oldDownloads.length > 0) {
      console.log(`[DownloadManager] Marking ${oldDownloads.length} old download record(s) as stale for album "${album.albumName}"`);
      for (const oldDownload of oldDownloads) {
        // Mark as stale but keep for history
        oldDownload.status = 'failed';
        oldDownload.lastError = 'Stale - superseded by new download request';
        oldDownload.stale = true;
        dbOps.updateDownload(oldDownload.id, {
          status: 'failed',
          lastError: 'Stale - superseded by new download request',
          stale: true,
        });
      }
    }

    // Create download record (parent/session record)
    const downloadSessionId = this.generateId();
    const downloadRecord = {
      id: downloadSessionId,
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
      isParent: true, // Mark as parent record
      downloadSessionId: downloadSessionId, // Self-reference for consistency
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
   * @param {string} artistId - Artist ID
   * @param {string} albumId - Album ID
   * @param {string} parentDownloadId - Optional parent download record ID (download session ID)
   */
  async downloadAlbum(artistId, albumId, parentDownloadId = null) {
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
    
    // FIRST: Check if album already exists in library root folder
    if (album.path) {
      const fs = await import('fs/promises');
      try {
        const albumDirExists = await fs.access(album.path).then(() => true).catch(() => false);
        
        if (albumDirExists) {
          const files = await fs.readdir(album.path);
          const audioExtensions = ['.flac', '.mp3', '.m4a', '.aac', '.ogg', '.wav', '.opus'];
          const audioFiles = files.filter(f => {
            const ext = path.extname(f).toLowerCase();
            return audioExtensions.includes(ext);
          });
          
          // Get expected track count
          const albumTracks = libraryManager.getTracks(albumId);
          const expectedTrackCount = albumTracks.length > 0 ? albumTracks.length : 12; // Default to 12 if no tracks in DB yet
          
          // If we have enough audio files (at least 80% of expected tracks), album is complete
          if (audioFiles.length >= Math.ceil(expectedTrackCount * 0.8)) {
            console.log(`[DownloadManager] Album "${album.albumName}" already exists in library (${audioFiles.length} audio files found in ${album.path}). Skipping download.`);
            const albumRequests = dbOps.getAlbumRequests();
            const albumRequest = albumRequests.find(r => r.albumId === albumId);
            if (albumRequest && albumRequest.status !== 'available') {
              dbOps.updateAlbumRequest(albumId, { status: 'available' });
            }
            return null; // Album already exists in library
          }
        }
      } catch (error) {
        // Album directory doesn't exist or can't be accessed, continue with download check
      }
    }
    
    // Second, check if download records show files were already moved
    const trackDownloadsWithPath = dbOps.getDownloads().filter(
      d => d.albumId === albumId && d.type !== 'album' && d.destinationPath
    );
    
    if (trackDownloadsWithPath.length > 0) {
      const fs = await import('fs/promises');
      let existingFiles = 0;
      for (const download of trackDownloadsWithPath) {
        try {
          await fs.access(download.destinationPath);
          existingFiles++;
        } catch {
          // File doesn't exist at destinationPath
        }
      }
      
      // If we have destination paths for most/all tracks and files exist, album is complete
      const albumTracks = libraryManager.getTracks(albumId);
      const expectedTrackCount = albumTracks.length > 0 ? albumTracks.length : trackDownloadsWithPath.length;
      
      if (existingFiles >= Math.max(expectedTrackCount * 0.9, trackDownloadsWithPath.length * 0.9)) {
        console.log(`[DownloadManager] Album "${album.albumName}" is already complete (${existingFiles} files found at destination paths). Skipping download.`);
        const albumRequests = dbOps.getAlbumRequests();
        const albumRequest = albumRequests.find(r => r.albumId === albumId);
        if (albumRequest && albumRequest.status !== 'available') {
          dbOps.updateAlbumRequest(albumId, { status: 'available' });
        }
        return null; // Album already complete
      }
    }
    
    // Also check if files exist in the album directory even if download records aren't updated
    const albumTracksForCheck = libraryManager.getTracks(albumId);
    if (albumTracksForCheck.length > 0 && album.path) {
      const fs = await import('fs/promises');
      try {
        const files = await fs.readdir(album.path);
        const audioFiles = files.filter(f => {
          const ext = path.extname(f).toLowerCase();
          return ['.flac', '.mp3', '.m4a', '.ogg', '.wav'].includes(ext);
        });
        
        // If we have audio files matching or exceeding track count, album is likely complete
        if (audioFiles.length >= albumTracksForCheck.length) {
          console.log(`[DownloadManager] Album "${album.albumName}" appears complete (${audioFiles.length} audio files found in album directory). Skipping download.`);
          const albumRequests = dbOps.getAlbumRequests();
          const albumRequest = albumRequests.find(r => r.albumId === albumId);
          if (albumRequest && albumRequest.status !== 'available') {
            dbOps.updateAlbumRequest(albumId, { status: 'available' });
          }
          return null; // Album already complete
        }
      } catch {
        // Album directory doesn't exist or can't be read, continue with download check
      }
    }
    
    // Check if album is already complete (all tracks have files)
    const albumTracks = libraryManager.getTracks(albumId);
    if (albumTracks.length > 0) {
      const tracksWithFiles = albumTracks.filter(t => t.hasFile && t.path);
      
      // If library scanner hasn't updated hasFile yet, verify files exist directly
      if (tracksWithFiles.length < albumTracks.length) {
        const fs = await import('fs/promises');
        let verifiedCount = tracksWithFiles.length;
        for (const track of albumTracks) {
          if (!track.hasFile && track.path) {
            try {
              await fs.access(track.path);
              verifiedCount++;
            } catch {
              // File doesn't exist
            }
          }
        }
        
        if (verifiedCount === albumTracks.length) {
          console.log(`[DownloadManager] Album "${album.albumName}" is already complete (${verifiedCount}/${albumTracks.length} tracks verified). Skipping download.`);
          const albumRequests = dbOps.getAlbumRequests();
          const albumRequest = albumRequests.find(r => r.albumId === albumId);
          if (albumRequest && albumRequest.status !== 'available') {
            dbOps.updateAlbumRequest(albumId, { status: 'available' });
          }
          return null; // Album already complete
        }
      } else if (tracksWithFiles.length === albumTracks.length) {
        console.log(`[DownloadManager] Album "${album.albumName}" is already complete (${tracksWithFiles.length}/${albumTracks.length} tracks have files). Skipping download.`);
        // Update album request status if needed
        const albumRequests = dbOps.getAlbumRequests();
        const albumRequest = albumRequests.find(r => r.albumId === albumId);
        if (albumRequest && albumRequest.status !== 'available') {
          dbOps.updateAlbumRequest(albumId, { status: 'available' });
        }
        return null; // Album already complete
      }
    }
    
    // Check if there are already active downloads for this album
    // But verify they actually have track downloads associated with them
    const existingDownloads = dbOps.getDownloads().filter(
      d => d.albumId === albumId && 
           d.type === 'album' && 
           (d.status === 'downloading' || d.status === 'requested' || d.status === 'searching' || d.status === 'adding')
    );
    
    if (existingDownloads.length > 0) {
      // Check if any of these downloads actually have track downloads (slskdDownloadId)
      // A valid album download should have created individual track download records
      const allAlbumDownloads = dbOps.getDownloads().filter(
        d => d.albumId === albumId && d.type === 'album'
      );
      
      // Check if there are any track downloads with slskdDownloadId (actual downloads in slskd)
      const hasActiveTrackDownloads = allAlbumDownloads.some(
        d => d.slskdDownloadId && (d.status === 'downloading' || d.status === 'requested' || d.status === 'completed')
      );
      
      // Also check if files were already moved (have destinationPath) - these are complete, not stale
      const trackDownloads = dbOps.getDownloads().filter(
        d => d.albumId === albumId && d.type !== 'album' && d.destinationPath
      );
      
      // Verify that moved files actually exist
      let hasMovedFiles = false;
      if (trackDownloads.length > 0) {
        const fs = await import('fs/promises');
        let existingCount = 0;
        for (const trackDownload of trackDownloads) {
          try {
            await fs.access(trackDownload.destinationPath);
            existingCount++;
          } catch {
            // File doesn't exist, ignore
          }
        }
        // If most files exist, consider the album as having moved files
        if (existingCount >= Math.min(trackDownloads.length, albumTracks.length * 0.8)) {
          hasMovedFiles = true;
        }
      }
      
      if (hasActiveTrackDownloads) {
        const activeCount = existingDownloads.length;
        console.log(`[DownloadManager] Album "${album.albumName}" already has ${activeCount} active download(s) with track downloads in progress. Skipping duplicate download.`);
        console.log(`[DownloadManager] Active download statuses:`, existingDownloads.map(d => ({ id: d.id, status: d.status, trackTitle: d.trackTitle, slskdDownloadId: d.slskdDownloadId })));
        return existingDownloads[0]; // Return existing download - it has active track downloads
      } else if (hasMovedFiles) {
        // Files were moved but library scanner might not have updated hasFile yet
        // Re-check album completion by verifying files exist
        const fs = await import('fs/promises');
        let verifiedTracks = 0;
        for (const track of albumTracks) {
          if (track.path) {
            try {
              await fs.access(track.path);
              verifiedTracks++;
            } catch {
              // File doesn't exist
            }
          }
        }
        
        if (verifiedTracks === albumTracks.length && albumTracks.length > 0) {
          console.log(`[DownloadManager] Album "${album.albumName}" is complete (${verifiedTracks}/${albumTracks.length} tracks verified). Skipping download.`);
          const albumRequests = dbOps.getAlbumRequests();
          const albumRequest = albumRequests.find(r => r.albumId === albumId);
          if (albumRequest && albumRequest.status !== 'available') {
            dbOps.updateAlbumRequest(albumId, { status: 'available' });
          }
          return null;
        }
      } else {
        // Existing download record exists but has no actual track downloads - it's stale
        console.warn(`[DownloadManager] Album "${album.albumName}" has stale download record(s) with no active track downloads. Clearing and starting fresh.`);
        console.warn(`[DownloadManager] Stale download IDs:`, existingDownloads.map(d => d.id));
        
        // Mark stale downloads as failed so they don't block new downloads
        for (const staleDownload of existingDownloads) {
          staleDownload.status = 'failed';
          staleDownload.lastError = 'Stale download - no track downloads found';
          dbOps.updateDownload(staleDownload.id, {
            status: 'failed',
            lastError: 'Stale download - no track downloads found',
          });
        }
        
        // Continue with new download
        console.log(`[DownloadManager] Proceeding with fresh download for "${album.albumName}"`);
      }
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
      const settings = dbOps.getSettings();
      const quality = artist.quality || settings.quality || 'standard';
      const downloadResults = await slskdClient.downloadAlbum(artist.artistName, album.albumName, {
        tracklist: tracklist,
        albumMbid: album.mbid,
        quality: quality,
      });
      
      // Store download references for tracking
      // downloadAlbum returns an array of download results (one per track)
      const downloadRecords = [];
      
      // Handle both single result (backward compatibility) and array of results
      const results = Array.isArray(downloadResults) ? downloadResults : [downloadResults];
      
      // Check if we got any results
      if (!results || results.length === 0 || (results.length === 1 && !results[0])) {
        console.error(`[DownloadManager] No download results returned for album "${album.albumName}" by "${artist.artistName}"`);
        console.error(`[DownloadManager] This usually means no files were found in the search or the search failed`);
        throw new Error(`No files found for album "${album.albumName}" by "${artist.artistName}". The search may have returned no results or all files were filtered out.`);
      }
      
      // Find the parent download record (session) if not provided
      if (!parentDownloadId) {
        const parentRecord = dbOps.getDownloads().find(
          d => d.albumId === albumId && 
               d.type === 'album' && 
               d.isParent && 
               (d.status === 'requested' || d.status === 'downloading' || d.status === 'searching' || d.status === 'adding')
        );
        if (parentRecord) {
          parentDownloadId = parentRecord.id;
          console.log(`[DownloadManager] Found parent download session: ${parentDownloadId} for album "${album.albumName}"`);
        } else {
          // Create a parent record if one doesn't exist (backward compatibility)
          console.warn(`[DownloadManager] No parent download record found for album "${album.albumName}", creating one...`);
          parentDownloadId = this.generateId();
          const parentRecord = {
            id: parentDownloadId,
            type: 'album',
            artistId,
            albumId,
            artistName: artist.artistName,
            albumName: album.albumName,
            status: 'downloading',
            isParent: true,
            downloadSessionId: parentDownloadId,
            requestedAt: new Date().toISOString(),
            startedAt: new Date().toISOString(),
            events: [],
          };
          dbOps.insertDownload(parentRecord);
        }
      }

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
        
        // Extract track information from download result
        // For album downloads, track info is in download.track
        const trackTitle = download.track?.title || 
                          (downloadObj.filename ? this.extractTrackTitleFromFilename(downloadObj.filename) : null) ||
                          null;
        const trackPosition = download.track?.position || 
                             (downloadObj.filename ? this.extractTrackNumberFromFilename(downloadObj.filename) : null);
        
        const downloadRecord = {
          id: downloadId || this.generateId(),
          type: 'album',
          artistId,
          albumId,
          artistMbid: artist.mbid,
          albumMbid: album.mbid,
          artistName: artist.artistName,
          albumName: album.albumName,
          status: 'requested',
          requestedAt: new Date().toISOString(),
          slskdDownloadId: downloadId,
          username: downloadObj.username || download.username,
          filename: downloadObj.filename || download.filename,
          retryCount: 0,
          requeueCount: 0,
          progress: 0,
          events: [],
          trackTitle: trackTitle,
          trackPosition: trackPosition,
          parentDownloadId: parentDownloadId, // Link to parent download session
          downloadSessionId: parentDownloadId, // Same as parent for easy filtering
        };
        
        // Log initial requested event
        this.logDownloadEvent(downloadRecord, 'requested', {
          trackTitle: download.track?.title,
          filename: downloadObj.filename || download.filename,
        });
        
        downloadRecords.push(downloadRecord);
        dbOps.insertDownload(downloadRecord);
      }
      
      // Check if we actually created any download records
      if (downloadRecords.length === 0) {
        console.error(`[DownloadManager] Failed to create any download records for album "${album.albumName}"`);
        console.error(`[DownloadManager] Results received: ${results.length}, but no valid download records created`);
        throw new Error(`Failed to initiate downloads for album "${album.albumName}". No valid download results were returned.`);
      }
      
      console.log(
        `Album download initiated: ${downloadRecords.length}/${tracklist.length || 'unknown'} tracks started`,
      );
      
      // Update status to "downloading" now that downloads are initiated
      this.updateDownloadStatus(albumId, 'downloading', {
        tracksStarted: downloadRecords.length,
        totalTracks: tracklist.length || downloadRecords.length,
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
    const track = libraryManager.getTracks(libraryManager.getAlbums(artistId).find(a => 
      libraryManager.getTracks(a.id).some(t => t.id === trackId)
    )?.id || '').find(t => t.id === trackId);
    
    if (!artist || !track) {
      throw new Error('Artist or track not found');
    }

    if (!slskdClient.isConfigured()) {
      throw new Error('slskd not configured');
    }

    // Fetch MusicBrainz recording metadata to validate downloads
    let trackMetadata = null;
    if (track.mbid) {
      try {
        const { musicbrainzRequest } = await import('./apiClients.js');
        const recordingData = await musicbrainzRequest(`/recording/${track.mbid}`, {});
        
        if (recordingData) {
          trackMetadata = {
            mbid: recordingData.id,
            title: recordingData.title,
            length: recordingData.length || null, // Duration in milliseconds
          };
          console.log(`Found MusicBrainz metadata for "${track.trackName}": duration ${trackMetadata.length ? Math.round(trackMetadata.length / 1000) + 's' : 'unknown'}`);
        }
      } catch (error) {
        // MusicBrainz unavailable - proceed without metadata
        console.warn(`Could not fetch MusicBrainz metadata for "${track.trackName}": ${error.message}`);
      }
    }

    // Search and download with metadata validation
    const download = await slskdClient.downloadTrack(artist.artistName, track.trackName, {
      trackMetadata: trackMetadata,
    });
    
    // Store download reference
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
    
    downloadRecord.requestedAt = new Date().toISOString();
    downloadRecord.artistMbid = artist.mbid;
    downloadRecord.artistName = artist.artistName;
    downloadRecord.trackName = track.trackName;
    dbOps.insertDownload(downloadRecord);
    
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

    // Fetch MusicBrainz recording metadata to validate downloads
    let trackMetadata = null;
    if (artistMbid) {
      try {
        const { musicbrainzRequest } = await import('./apiClients.js');
        const searchResult = await musicbrainzRequest('/recording', {
          query: `recording:"${trackName}" AND arid:${artistMbid}`,
          limit: 1
        });
        
        if (searchResult.recordings && searchResult.recordings.length > 0) {
          const recording = searchResult.recordings[0];
          trackMetadata = {
            mbid: recording.id,
            title: recording.title,
            length: recording.length || null, // Duration in milliseconds
          };
          console.log(`[WEEKLY FLOW] Found MusicBrainz metadata for "${trackName}": duration ${trackMetadata.length ? Math.round(trackMetadata.length / 1000) + 's' : 'unknown'}`);
        }
      } catch (error) {
        // MusicBrainz unavailable - proceed without metadata
        console.warn(`[WEEKLY FLOW] Could not fetch MusicBrainz metadata for "${trackName}": ${error.message}`);
      }
    }

    // Search and download with metadata validation
    let download;
    try {
      download = await slskdClient.downloadTrack(artist.artistName, trackName, {
        trackMetadata: trackMetadata,
      });
      
      // Note: download.id might be undefined initially (especially with API v0)
      // We'll match it later by filename when checking slskd downloads
      if (!download) {
        throw new Error(`Download failed: slskd did not return a download response for ${artist.artistName} - ${trackName}`);
      }
      
      // Log if we don't have an ID (we'll match it later)
      if (!download.id) {
        console.log(`[WEEKLY FLOW] Download queued but no ID yet (will match by filename): ${artist.artistName} - ${trackName}`);
      }
    } catch (error) {
      // Log the error with more context
      console.error(`[WEEKLY FLOW] Failed to initiate download for ${artist.artistName} - ${trackName}:`, error.message);
      throw error;
    }
    
    // Store download reference - same structure as regular downloads
    // Find existing download record (created by queueWeeklyFlowTrack)
    let downloadRecord = dbOps.getDownloads().find(
      d => d.type === 'weekly-flow' && 
           d.artistId === artistId && 
           d.trackName === trackName &&
           (!d.slskdDownloadId || d.status === 'requested') // Match records without ID or still requested
    );
    
    if (!downloadRecord) {
      // Create new record if not found
      downloadRecord = {
        id: this.generateId(),
        type: 'weekly-flow',
        artistId,
        artistMbid,
        artistName: artist.artistName,
        trackName,
        status: 'downloading',
        requestedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        retryCount: 0,
        requeueCount: 0,
        progress: 0,
        events: [],
      };
      dbOps.insertDownload(downloadRecord);
    }
    
    // Update with download info from slskd
    if (download.id) {
      downloadRecord.slskdDownloadId = download.id;
    }
    downloadRecord.username = download.username;
    downloadRecord.filename = download.filename;
    downloadRecord.slskdFilePath = download.filePath || download.destinationPath || download.path || download.file || download.localPath;
    downloadRecord.status = 'downloading';
    
    // Log initial requested and queued events (only if not already logged)
    if (!downloadRecord.events || downloadRecord.events.length === 0) {
      this.logDownloadEvent(downloadRecord, 'requested', {
        trackName,
        artistName: artist.artistName,
        filename: download.filename,
      });
    }
    
    this.logDownloadEvent(downloadRecord, 'queued', {
      slskdDownloadId: download.id || 'pending',
      username: download.username,
      filename: download.filename,
    });
    
                dbOps.updateDownload(downloadRecord.id, downloadRecord);
    
    return download;
  }

  async handleFailedDownload(downloadRecord, slskdDownload = null, error = null) {
    try {
      // Increment retry count
      downloadRecord.retryCount = (downloadRecord.retryCount || 0) + 1;
      
      // Extract error message from slskd download or use default
      const errorMessage = error?.message ||
                          slskdDownload?.error || 
                          slskdDownload?.errorMessage || 
                          slskdDownload?.state || 
                          'Download not found in slskd';
      
      // Classify error for smart retry strategy
      const errorType = this.classifyError(error || { message: errorMessage });
      const strategy = this.getRetryStrategy(errorType, downloadRecord.retryCount);
      
      // Check if we should retry
      if (!strategy.shouldRetry || downloadRecord.retryCount > strategy.maxRetries) {
        // Max retries reached or permanent error, mark as failed
        this.logDownloadEvent(downloadRecord, 'failed', {
          error: errorMessage,
          errorType,
          retryCount: downloadRecord.retryCount,
          maxRetries: strategy.maxRetries,
          reason: strategy.shouldRetry ? 'max_retries_reached' : 'permanent_error',
        });
        downloadRecord.queueCleaned = false; // Let QueueCleaner handle it
        downloadRecord.errorType = errorType; // Store error type for analysis
        console.log(
          `Download ${downloadRecord.id} failed after ${downloadRecord.retryCount} retries (error type: ${errorType}). Last error: ${errorMessage}. Marking as failed for QueueCleaner.`,
        );
        dbOps.updateDownload(downloadRecord.id, downloadRecord);
        return;
      }
      
      // Log failure but will retry
      this.logDownloadEvent(downloadRecord, 'failed', {
        error: errorMessage,
        errorType,
        retryCount: downloadRecord.retryCount,
        maxRetries: strategy.maxRetries,
        willRetry: true,
      });
      
      // Calculate delay before retry using smart backoff
      const backoffMs = strategy.backoffMs(downloadRecord.retryCount);
      const retryDelayMinutes = backoffMs / (1000 * 60);
      const lastFailureTime = downloadRecord.lastFailureAt 
        ? new Date(downloadRecord.lastFailureAt) 
        : new Date();
      const timeSinceFailure = (new Date() - lastFailureTime); // milliseconds
      
      // Only retry if enough time has passed
      if (timeSinceFailure < backoffMs) {
        const remainingMs = backoffMs - timeSinceFailure;
        const remainingMinutes = Math.ceil(remainingMs / (1000 * 60));
        console.log(
          `Download ${downloadRecord.id} will retry in ${remainingMinutes} minutes (error type: ${errorType}, attempt ${downloadRecord.retryCount}/${strategy.maxRetries})...`,
        );
        downloadRecord.errorType = errorType;
        dbOps.updateDownload(downloadRecord.id, downloadRecord);
        return;
      }
      
      // Try to find alternative source and retry
      console.log(
        `Retrying download ${downloadRecord.id} (error type: ${errorType}, attempt ${downloadRecord.retryCount}/${strategy.maxRetries})...`,
      );
      
      // Cancel the failed download in slskd if it exists
      if (slskdDownload && slskdDownload.id) {
        try {
          await slskdClient.cancelDownload(slskdDownload.id);
          console.log(`Cancelled failed download ${slskdDownload.id} in slskd`);
        } catch (cancelError) {
          // Ignore cancel errors (download might already be gone)
          console.warn(`Could not cancel download ${slskdDownload.id}:`, cancelError.message);
        }
      }
      
      // Retry the download with alternative source
      downloadRecord.errorType = errorType;
      this.logDownloadEvent(downloadRecord, 'requeued', {
        retryCount: downloadRecord.retryCount,
        errorType,
        reason: 'failed_download_retry',
      });
      dbOps.updateDownload(downloadRecord.id, downloadRecord);
      await this.retryDownload(downloadRecord);
    } catch (retryError) {
      console.error(`Error handling failed download ${downloadRecord.id}:`, retryError.message);
      // Mark as failed if retry itself fails
      const errorType = this.classifyError(retryError);
      this.logDownloadEvent(downloadRecord, 'failed', {
        error: `Retry failed: ${retryError.message}`,
        errorType,
        retryCount: downloadRecord.retryCount,
        reason: 'retry_operation_failed',
      });
      downloadRecord.errorType = errorType;
      dbOps.updateDownload(downloadRecord.id, downloadRecord);
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
                dbOps.updateDownload(downloadRecord.id, downloadRecord);
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
                dbOps.updateDownload(downloadRecord.id, downloadRecord);
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
                dbOps.updateDownload(downloadRecord.id, downloadRecord);
      await this.retryDownload(downloadRecord);
    } catch (error) {
      console.error(`Error handling stalled download ${downloadRecord.id}:`, error.message);
      // Mark as failed if retry itself fails
      this.logDownloadEvent(downloadRecord, 'failed', {
        error: `Stalled retry failed: ${error.message}`,
        retryCount: downloadRecord.retryCount,
        reason: 'stalled_retry_operation_failed',
      });
                dbOps.updateDownload(downloadRecord.id, downloadRecord);
    }
  }

  updateDownloadStatus(albumId, status, metadata = {}) {
    // Download status is now tracked in downloads table, no separate status object needed
    // Status can be derived from download records for the album
    // This method is kept for API compatibility but doesn't need to store separate status
    
    // However, we can update all download records for this album to reflect the overall status
    // This is useful when marking an album as 'added' after all tracks are moved
    if (status === 'added') {
      const albumDownloads = dbOps.getDownloads().filter(
        d => d.albumId === albumId && d.type === 'album'
      );
      
      // Mark all track downloads as 'added' since the album is now in library
      // Check if files actually exist before updating status
      const album = libraryManager.getAlbumById(albumId);
      if (album) {
        const albumTracks = libraryManager.getTracks(albumId);
        const tracksByTitle = new Map(albumTracks.map(t => [t.trackName?.toLowerCase(), t]));
        
        for (const download of albumDownloads) {
          // Check if there's a matching track in the library with a file
          const trackTitle = download.trackTitle?.toLowerCase() || download.trackName?.toLowerCase();
          const matchingTrack = trackTitle ? tracksByTitle.get(trackTitle) : null;
          
          if (matchingTrack && matchingTrack.hasFile && matchingTrack.path) {
            // Track exists in library, update download status to added
            if (download.status !== 'added') {
              download.status = 'added';
              download.addedAt = download.addedAt || new Date().toISOString();
              download.destinationPath = download.destinationPath || matchingTrack.path;
              dbOps.updateDownload(download.id, {
                status: 'added',
                addedAt: download.addedAt,
                destinationPath: download.destinationPath,
              });
            }
          } else if (download.status === 'completed' || download.tempFilePath) {
            // File was completed but might not be matched yet - still mark as added
            download.status = 'added';
            download.addedAt = download.addedAt || new Date().toISOString();
            dbOps.updateDownload(download.id, {
              status: 'added',
              addedAt: download.addedAt,
            });
          }
        }
      }
    }
  }

  // Public method to update status (for routes)
  updateStatus(albumId, status, metadata = {}) {
    this.updateDownloadStatus(albumId, status, metadata);
  }

  getDownloadStatus(albumId) {
    // Get status from download records for this album
    const albumDownloads = dbOps.getDownloads().filter(d => d.albumId === albumId);
    if (albumDownloads.length === 0) {
      return null;
    }
    
    // Determine overall status from download records
    const hasDownloading = albumDownloads.some(d => d.status === 'downloading');
    const hasAdded = albumDownloads.some(d => d.status === 'added');
    const allAdded = albumDownloads.length > 0 && albumDownloads.every(d => d.status === 'added');
    const hasCompleted = albumDownloads.some(d => d.status === 'completed');
    const hasFailed = albumDownloads.some(d => d.status === 'failed');
    
    // Priority: downloading > all added > has added > completed > failed > requested
    let overallStatus = 'requested';
    if (hasDownloading) {
      overallStatus = 'downloading';
    } else if (allAdded) {
      overallStatus = 'added';
    } else if (hasAdded) {
      overallStatus = 'added';
    } else if (hasCompleted) {
      overallStatus = 'completed';
    } else if (hasFailed) {
      overallStatus = 'failed';
    }
    
    const status = {
      status: overallStatus,
      updatedAt: new Date().toISOString(),
    };
    
    // Check if there are active downloads for this album
    const activeDownloads = albumDownloads.filter(
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
                dbOps.updateDownload(downloadRecord.id, downloadRecord);
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
            // Download record updated via dbOps.updateDownload
            
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
              
              // Download record updated via dbOps.updateDownload
              console.log(`Retry initiated for track "${trackTitle}" with new download ID: ${downloadId}`);
            } else {
              console.error(`Failed to get download ID from retry result for track "${trackTitle}"`);
              this.logDownloadEvent(downloadRecord, 'failed', {
                error: 'Failed to get download ID from retry result',
                retryCount: downloadRecord.retryCount,
              });
              // Download record updated via dbOps.updateDownload
            }
          } else {
            // No track info, can't retry individual track - would need to retry whole album
            console.warn(`Cannot retry download ${downloadRecord.id} - no track information available`);
            downloadRecord.status = 'failed';
            // Download record updated via dbOps.updateDownload
          }
        }
      } else if (downloadRecord.type === 'track' && downloadRecord.trackId) {
        const track = libraryManager.getTracks(libraryManager.getAlbums(downloadRecord.artistId).find(a => 
          libraryManager.getTracks(a.id).some(t => t.id === downloadRecord.trackId)
        )?.id || '').find(t => t.id === downloadRecord.trackId);
        if (track) {
          // Retry track download
          this.logDownloadEvent(downloadRecord, 'requeued', {
            reason: 'retry_failed_track',
            retryCount: downloadRecord.retryCount,
          });
          downloadRecord.retryStartedAt = new Date().toISOString();
                dbOps.updateDownload(downloadRecord.id, downloadRecord);
          
          // Fetch MusicBrainz metadata if available
          let trackMetadata = null;
          if (track.mbid) {
            try {
              const { musicbrainzRequest } = await import('./apiClients.js');
              const recordingData = await musicbrainzRequest(`/recording/${track.mbid}`, {});
              
              if (recordingData) {
                trackMetadata = {
                  mbid: recordingData.id,
                  title: recordingData.title,
                  length: recordingData.length || null,
                };
              }
            } catch (error) {
              // MusicBrainz unavailable - proceed without metadata
            }
          }

          const download = await slskdClient.downloadTrack(artist.artistName, track.trackName, {
            excludeUsernames: downloadRecord.triedUsernames || [],
            trackMetadata: trackMetadata,
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
          
                dbOps.updateDownload(downloadRecord.id, downloadRecord);
        }
      }
    } catch (error) {
      console.error(`Error retrying download ${downloadRecord.id}:`, error.message);
      this.logDownloadEvent(downloadRecord, 'failed', {
        error: `Retry operation failed: ${error.message}`,
        retryCount: downloadRecord.retryCount,
        reason: 'retry_operation_exception',
      });
                dbOps.updateDownload(downloadRecord.id, downloadRecord);
    }
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Extract track title from filename
   * Examples: "04 - Does He Really Care.flac" -> "Does He Really Care"
   *           "01. Alive.flac" -> "Alive"
   */
  extractTrackTitleFromFilename(filename) {
    if (!filename) return null;
    
    // Remove path, get just the filename
    const justFilename = filename.split(/[\\/]/).pop() || filename;
    
    // Remove extension
    const withoutExt = justFilename.replace(/\.\w+$/, '');
    
    // Try patterns: "04 - Track Name", "01. Track Name", "Track Name"
    const patterns = [
      /^\d+\s*[-.]?\s*(.+)$/,  // "04 - Track" or "01. Track"
      /^track\s*\d+\s*[-.]?\s*(.+)$/i,  // "Track 04 - Name"
      /^(.+)$/,  // Just the name
    ];
    
    for (const pattern of patterns) {
      const match = withoutExt.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    
    return withoutExt.trim();
  }

  /**
   * Extract track number from filename
   * Examples: "04 - Does He Really Care.flac" -> 4
   *           "01. Alive.flac" -> 1
   */
  extractTrackNumberFromFilename(filename) {
    if (!filename) return null;
    
    // Remove path, get just the filename
    const justFilename = filename.split(/[\\/]/).pop() || filename;
    
    // Try to match track number at start: "04 -", "01.", "Track 04"
    const patterns = [
      /^(\d+)\s*[-.]/,  // "04 -" or "01."
      /^track\s*(\d+)/i,  // "Track 04"
    ];
    
    for (const pattern of patterns) {
      const match = justFilename.match(pattern);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }
    }
    
    return null;
  }
}

export const downloadManager = new DownloadManager();
