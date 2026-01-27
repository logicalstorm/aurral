// Lazy imports to avoid circular dependencies
let slskdClient, libraryManager, downloadManager, libraryMonitor;
import { dbOps } from '../config/db-helpers.js';

async function getDependencies() {
  if (!slskdClient) {
    const mod = await import('./slskdClient.js');
    slskdClient = mod.slskdClient;
  }
  if (!libraryManager) {
    const mod = await import('./libraryManager.js');
    libraryManager = mod.libraryManager;
  }
  if (!downloadManager) {
    const mod = await import('./downloadManager.js');
    downloadManager = mod.downloadManager;
  }
  if (!libraryMonitor) {
    const mod = await import('./libraryMonitor.js');
    libraryMonitor = mod.libraryMonitor;
  }
  return { slskdClient, libraryManager, downloadManager, libraryMonitor };
}

/**
 * Global Download Queue System
 * 
 * Manages all downloads (user albums/tracks, weekly flow, future features)
 * in a unified, robust queue with prioritization, rate limiting, and retries.
 */
export class DownloadQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.paused = false;
    this.maxConcurrent = 3; // Max concurrent downloads
    this.currentDownloads = new Set(); // Track active downloads
    this.rateLimitDelay = 2000; // Base delay between downloads (ms)
    this.processInterval = null;
    this.initialized = false;
    
    // Initialize queue from database (async, but don't block)
    this.initialize();
  }

  async initialize() {
    await this.loadQueueFromDb();
    this.initialized = true;
    // Start processing queue
    this.start();
  }

  /**
   * Load queue from database on startup
   */
  async loadQueueFromDb() {
    await getDependencies();
    
    // Load pending downloads from database
    const allDownloads = dbOps.getDownloads();
    const pendingDownloads = allDownloads.filter(
      d => d.status === 'requested' || 
           d.status === 'queued' || 
           d.status === 'downloading' ||
           (d.status === 'failed' && (d.retryCount || 0) < 3)
    );
    
    this.queue = pendingDownloads.map(d => ({
      id: d.id,
      type: d.type || 'unknown',
      priority: this.getPriority(d),
      downloadRecord: d,
      retryCount: d.retryCount || 0,
      createdAt: d.startedAt || d.requestedAt || new Date().toISOString(),
    }));
    
    // Sort by priority (higher priority first)
    this.queue.sort((a, b) => b.priority - a.priority);
    
    console.log(`[Download Queue] Loaded ${this.queue.length} pending downloads from database`);
  }

  /**
   * Get priority for a download
   * Higher number = higher priority
   */
  getPriority(downloadRecord) {
    // Weekly flow downloads get lower priority (user requests first)
    if (downloadRecord.type === 'weekly-flow') {
      return 1;
    }
    
    // User-requested albums get highest priority
    if (downloadRecord.type === 'album') {
      return 10;
    }
    
    // User-requested tracks get high priority
    if (downloadRecord.type === 'track') {
      return 8;
    }
    
    // Failed downloads that are retrying get lower priority
    if (downloadRecord.status === 'failed' && downloadRecord.retryCount > 0) {
      return 2;
    }
    
    return 5; // Default priority
  }

  /**
   * Add item to queue
   */
  async enqueue(downloadRecord) {
    await getDependencies();
    
    if (!downloadRecord || !downloadRecord.id) {
      throw new Error('Invalid download record');
    }

    // Check if already in queue
    const existing = this.queue.find(q => q.id === downloadRecord.id);
    if (existing) {
      console.log(`[Download Queue] Download ${downloadRecord.id} already in queue`);
      return existing;
    }

    const queueItem = {
      id: downloadRecord.id,
      type: downloadRecord.type || 'unknown',
      priority: this.getPriority(downloadRecord),
      downloadRecord,
      retryCount: downloadRecord.retryCount || 0,
      createdAt: downloadRecord.startedAt || downloadRecord.requestedAt || new Date().toISOString(),
    };

    this.queue.push(queueItem);
    this.queue.sort((a, b) => b.priority - a.priority);

    // Ensure download record is in database
    const existingRecord = dbOps.getDownloadById(downloadRecord.id);
    if (!existingRecord) {
      dbOps.insertDownload(downloadRecord);
    } else {
      // Update existing record
      dbOps.updateDownload(downloadRecord.id, downloadRecord);
    }

    console.log(`[Download Queue] Enqueued: ${downloadRecord.type} - ${downloadRecord.artistName || 'Unknown'} - ${downloadRecord.trackName || downloadRecord.albumName || 'Unknown'} (Priority: ${queueItem.priority})`);
    
    return queueItem;
  }

  /**
   * Remove item from queue
   */
  async dequeue(downloadId) {
    await getDependencies();
    
    const index = this.queue.findIndex(q => q.id === downloadId);
    if (index === -1) {
      return null;
    }

    const item = this.queue.splice(index, 1)[0];
    
    // Update database record
    const downloadRecord = dbOps.getDownloadById(downloadId);
    if (downloadRecord) {
      const events = downloadRecord.events || [];
      events.push({
        timestamp: new Date().toISOString(),
        event: 'cancelled',
        reason: 'removed_from_queue',
      });
      dbOps.updateDownload(downloadId, {
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        events,
      });
    }

    console.log(`[Download Queue] Dequeued: ${downloadId}`);
    return item;
  }

  /**
   * Clear queue
   */
  async clear(options = {}) {
    const { type, status } = options;
    
    let cleared = 0;
    const toRemove = [];
    
    for (const item of this.queue) {
      if (type && item.type !== type) continue;
      if (status && item.downloadRecord.status !== status) continue;
      
      toRemove.push(item.id);
    }
    
    for (const id of toRemove) {
      await this.dequeue(id);
      cleared++;
    }
    
    console.log(`[Download Queue] Cleared ${cleared} items from queue`);
    return { cleared };
  }

  /**
   * Get queue status
   */
  getStatus() {
    const byType = {};
    const byStatus = {};
    
    for (const item of this.queue) {
      byType[item.type] = (byType[item.type] || 0) + 1;
      byStatus[item.downloadRecord.status] = (byStatus[item.downloadRecord.status] || 0) + 1;
    }
    
    return {
      total: this.queue.length,
      processing: this.currentDownloads.size,
      paused: this.paused,
      byType,
      byStatus,
      queue: this.queue.map(q => ({
        id: q.id,
        type: q.type,
        priority: q.priority,
        status: q.downloadRecord.status,
        artistName: q.downloadRecord.artistName,
        trackName: q.downloadRecord.trackName,
        albumName: q.downloadRecord.albumName,
        retryCount: q.retryCount,
        createdAt: q.createdAt,
      })),
    };
  }

  /**
   * Get queue statistics
   */
  async getStats() {
    await getDependencies();
    const allDownloads = dbOps.getDownloads();
    
    const stats = {
      total: allDownloads.length,
      byType: {},
      byStatus: {},
      recent: {
        last24h: 0,
        last7d: 0,
        last30d: 0,
      },
      failures: {
        total: 0,
        byType: {},
      },
    };
    
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    
    for (const download of allDownloads) {
      // Count by type
      stats.byType[download.type || 'unknown'] = (stats.byType[download.type || 'unknown'] || 0) + 1;
      
      // Count by status
      stats.byStatus[download.status || 'unknown'] = (stats.byStatus[download.status || 'unknown'] || 0) + 1;
      
      // Count failures
      if (download.status === 'failed') {
        stats.failures.total++;
        stats.failures.byType[download.type || 'unknown'] = (stats.failures.byType[download.type || 'unknown'] || 0) + 1;
      }
      
      // Count recent
      const createdAt = download.startedAt || download.requestedAt;
      if (createdAt) {
        const age = now - new Date(createdAt).getTime();
        if (age < dayMs) stats.recent.last24h++;
        if (age < dayMs * 7) stats.recent.last7d++;
        if (age < dayMs * 30) stats.recent.last30d++;
      }
    }
    
    return stats;
  }

  /**
   * Pause queue processing
   */
  pause() {
    this.paused = true;
    console.log('[Download Queue] Paused');
  }

  /**
   * Resume queue processing
   */
  resume() {
    this.paused = false;
    console.log('[Download Queue] Resumed');
  }

  /**
   * Start processing queue
   */
  start() {
    if (this.processInterval) {
      return; // Already started
    }

    // Process queue every 5 seconds
    this.processInterval = setInterval(() => {
      this.processQueue();
    }, 5000);

    // Also process immediately
    this.processQueue();
    
    console.log('[Download Queue] Started');
  }

  /**
   * Stop processing queue
   */
  stop() {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
    console.log('[Download Queue] Stopped');
  }

  /**
   * Process queue - attempt to start downloads
   */
  async processQueue() {
    if (!this.initialized) {
      return; // Not initialized yet
    }
    
    if (this.paused || this.processing) {
      return;
    }

    if (this.currentDownloads.size >= this.maxConcurrent) {
      return; // At max concurrent downloads
    }

    if (this.queue.length === 0) {
      return; // Nothing to process
    }

    this.processing = true;

    try {
      // Get next items to process (respecting max concurrent)
      const slotsAvailable = this.maxConcurrent - this.currentDownloads.size;
      const toProcess = this.queue
        .filter(q => !this.currentDownloads.has(q.id))
        .slice(0, slotsAvailable);

      for (const item of toProcess) {
        // Add delay between starting downloads to avoid rate limiting
        const delay = this.currentDownloads.size * this.rateLimitDelay;
        
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        this.processItem(item).catch(error => {
          console.error(`[Download Queue] Error processing item ${item.id}:`, error.message);
        });
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Process a single queue item
   */
  async processItem(item) {
    await getDependencies();
    
    if (this.currentDownloads.has(item.id)) {
      return; // Already processing
    }

    this.currentDownloads.add(item.id);

    try {
      const { downloadRecord } = item;

      // Update status to downloading
      if (downloadRecord.status !== 'downloading') {
        downloadRecord.status = 'downloading';
        downloadRecord.startedAt = downloadRecord.startedAt || new Date().toISOString();
        downloadManager.logDownloadEvent(downloadRecord, 'started', {
          queued: true,
        });
        dbOps.updateDownload(downloadRecord.id, {
          status: 'downloading',
          startedAt: downloadRecord.startedAt,
          events: downloadRecord.events,
        });
      }

      // Execute download based on type
      let result;
      switch (downloadRecord.type) {
        case 'album':
          result = await downloadManager.downloadAlbum(
            downloadRecord.artistId,
            downloadRecord.albumId
          );
          break;
        
        case 'track':
          result = await downloadManager.downloadTrack(
            downloadRecord.artistId,
            downloadRecord.trackId
          );
          break;
        
        case 'weekly-flow':
          result = await downloadManager.downloadWeeklyFlowTrack(
            downloadRecord.artistId,
            downloadRecord.trackName,
            downloadRecord.artistMbid
          );
          break;
        
        default:
          throw new Error(`Unknown download type: ${downloadRecord.type}`);
      }

      // Download initiated successfully
      // The downloadManager will handle completion tracking
      console.log(`[Download Queue] Started download: ${downloadRecord.type} - ${downloadRecord.artistName || 'Unknown'} - ${downloadRecord.trackName || downloadRecord.albumName || 'Unknown'}`);

      // Remove from queue (it's now being tracked by downloadManager)
      const index = this.queue.findIndex(q => q.id === item.id);
      if (index > -1) {
        this.queue.splice(index, 1);
      }

    } catch (error) {
      console.error(`[Download Queue] Failed to process ${item.id}:`, error.message);
      
      // Handle failure using downloadManager's smart error handling
      const { downloadRecord } = item;
      
      // Use downloadManager's error classification and retry strategy
      await downloadManager.handleFailedDownload(downloadRecord, null, error);
      
      // Check if download should be removed from queue (permanent error or max retries)
      const errorType = downloadManager.classifyError(error);
      const strategy = downloadManager.getRetryStrategy(errorType, downloadRecord.retryCount);
      
      if (!strategy.shouldRetry || downloadRecord.retryCount >= strategy.maxRetries) {
        // Remove from queue
        const index = this.queue.findIndex(q => q.id === item.id);
        if (index > -1) {
          this.queue.splice(index, 1);
        }
      } else {
        // Requeue with lower priority
        item.priority = Math.max(1, item.priority - 2);
        item.downloadRecord.retryCount = downloadRecord.retryCount;
        this.queue.sort((a, b) => b.priority - a.priority);
      }
    } finally {
      this.currentDownloads.delete(item.id);
    }
  }

  /**
   * Search queue
   */
  search(query) {
    const lowerQuery = query.toLowerCase();
    
    return this.queue.filter(item => {
      const record = item.downloadRecord;
      return (
        (record.artistName && record.artistName.toLowerCase().includes(lowerQuery)) ||
        (record.trackName && record.trackName.toLowerCase().includes(lowerQuery)) ||
        (record.albumName && record.albumName.toLowerCase().includes(lowerQuery)) ||
        (record.id && record.id.toLowerCase().includes(lowerQuery))
      );
    }).map(item => ({
      id: item.id,
      type: item.type,
      priority: item.priority,
      status: item.downloadRecord.status,
      artistName: item.downloadRecord.artistName,
      trackName: item.downloadRecord.trackName,
      albumName: item.downloadRecord.albumName,
    }));
  }
}

// Export singleton instance
export const downloadQueue = new DownloadQueue();
