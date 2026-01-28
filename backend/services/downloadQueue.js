import { dbOps } from '../config/db-helpers.js';
import { DOWNLOAD_STATES, STALLED_TIMEOUT_MS } from '../config/constants.js';
import { downloadStateMachine } from './downloadStateMachine.js';
import { sourceManager } from './sourceManager.js';
import fs from 'fs';
import path from 'path';

let slskdClient, libraryManager, downloadManager, libraryMonitor;

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
    this.maxConcurrent = 3;
    this.currentDownloads = new Set();
    this.rateLimitDelay = 2000;
    this.processInterval = null;
    this.stalledCheckInterval = null;
    this.initialized = false;
    
    this.schedule = {
      enabled: false,
      startHour: 0,
      endHour: 24,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      timezone: 'local',
    };
    
    this.initialize();
  }

  async initialize() {
    await this.loadQueueFromDb();
    this.initialized = true;
    this.start();
    this.startStalledDetection();
    downloadStateMachine.startMetricsCollection();
    sourceManager.startSpeedMonitoring();
  }

  startStalledDetection() {
    if (this.stalledCheckInterval) {
      clearInterval(this.stalledCheckInterval);
    }

    this.stalledCheckInterval = setInterval(async () => {
      await this.checkAndHandleStalledDownloads();
    }, 60000);

    console.log('[Download Queue] Started stalled detection');
  }

  async checkAndHandleStalledDownloads() {
    try {
      const stalledDownloads = dbOps.getStalledDownloads(STALLED_TIMEOUT_MS);
      
      for (const download of stalledDownloads) {
        console.log(`[Download Queue] Handling stalled download: ${download.id}`);
        
        this.currentDownloads.delete(download.id);
        
        const result = downloadStateMachine.handleDownloadFailure(
          download, 
          new Error('Download stalled - no progress for 30+ minutes'),
          'timeout'
        );

        if (result.success && result.download.status === DOWNLOAD_STATES.QUEUED) {
          await this.enqueue(result.download);
        }
      }

      if (stalledDownloads.length > 0) {
        console.log(`[Download Queue] Processed ${stalledDownloads.length} stalled downloads`);
      }
      
      const slowTransfers = await sourceManager.checkSlowTransfers();
      for (const slow of slowTransfers) {
        const download = dbOps.getDownloadById(slow.downloadId);
        if (download && download.status === DOWNLOAD_STATES.DOWNLOADING) {
          console.log(`[Download Queue] Aborting slow transfer: ${slow.downloadId} (${Math.round(slow.averageSpeed)} B/s)`);
          
          await sourceManager.abortSlowTransfer(slow.downloadId, 'Slow transfer speed');
          
          const result = downloadStateMachine.handleDownloadFailure(
            download,
            new Error(`Transfer too slow: ${Math.round(slow.averageSpeed)} B/s`),
            'slow_transfer'
          );

          if (result.success && result.download.status === DOWNLOAD_STATES.QUEUED) {
            await this.enqueue(result.download);
          }
        }
      }
      
      await sourceManager.cleanupExpiredBlocks();
    } catch (error) {
      console.error('[Download Queue] Error checking stalled downloads:', error.message);
    }
  }

  async loadQueueFromDb() {
    await getDependencies();
    
    const allDownloads = dbOps.getDownloads();
    
    const terminalStates = [
      DOWNLOAD_STATES.ADDED, 
      DOWNLOAD_STATES.COMPLETED, 
      DOWNLOAD_STATES.DEAD_LETTER, 
      DOWNLOAD_STATES.CANCELLED
    ];
    
    const activeStates = [
      DOWNLOAD_STATES.REQUESTED,
      DOWNLOAD_STATES.QUEUED,
      DOWNLOAD_STATES.SEARCHING,
      DOWNLOAD_STATES.DOWNLOADING,
      DOWNLOAD_STATES.PROCESSING,
      DOWNLOAD_STATES.MOVING,
    ];
    
    const pendingDownloads = allDownloads.filter(d => {
      if (terminalStates.includes(d.status)) {
        if (d.type === 'album' && d.albumId && d.status !== DOWNLOAD_STATES.DEAD_LETTER) {
          const album = libraryManager.getAlbumById(d.albumId);
          if (album && album.path) {
            try {
              if (fs.existsSync(album.path)) {
                const files = fs.readdirSync(album.path);
                const audioExtensions = ['.flac', '.mp3', '.m4a', '.aac', '.ogg', '.wav', '.opus'];
                const audioFiles = files.filter(f => {
                  const ext = path.extname(f).toLowerCase();
                  return audioExtensions.includes(ext);
                });
                const albumTracks = libraryManager.getTracks(d.albumId);
                const expectedTrackCount = albumTracks.length > 0 ? albumTracks.length : 12;
                if (audioFiles.length >= Math.ceil(expectedTrackCount * 0.8)) {
                  dbOps.updateDownload(d.id, { status: DOWNLOAD_STATES.ADDED, completedAt: d.completedAt || new Date().toISOString() });
                  return false;
                }
              }
            } catch {
            }
            
            const albumTracks = libraryManager.getTracks(d.albumId);
            if (albumTracks.length > 0) {
              const tracksWithFiles = albumTracks.filter(t => t.hasFile && t.path);
              if (tracksWithFiles.length === albumTracks.length) {
                return false;
              }
            }
          }
        }
        return false;
      }
      
      if (d.type === 'album' && d.albumId && activeStates.includes(d.status)) {
        const album = libraryManager.getAlbumById(d.albumId);
        if (album && album.path) {
          try {
            if (fs.existsSync(album.path)) {
              const files = fs.readdirSync(album.path);
              const audioExtensions = ['.flac', '.mp3', '.m4a', '.aac', '.ogg', '.wav', '.opus'];
              const audioFiles = files.filter(f => {
                const ext = path.extname(f).toLowerCase();
                return audioExtensions.includes(ext);
              });
              const albumTracks = libraryManager.getTracks(d.albumId);
              const expectedTrackCount = albumTracks.length > 0 ? albumTracks.length : 12;
              if (audioFiles.length >= Math.ceil(expectedTrackCount * 0.8)) {
                dbOps.updateDownload(d.id, { status: DOWNLOAD_STATES.ADDED, completedAt: new Date().toISOString() });
                return false;
              }
            }
          } catch {
          }
        }
      }
      
      if (activeStates.includes(d.status)) {
        return true;
      }
      
      if ((d.status === DOWNLOAD_STATES.FAILED || d.status === DOWNLOAD_STATES.STALLED) && (d.retryCount || 0) < 5) {
        return true;
      }
      
      return false;
    });
    
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

  stop() {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
    if (this.stalledCheckInterval) {
      clearInterval(this.stalledCheckInterval);
      this.stalledCheckInterval = null;
    }
    downloadStateMachine.stopMetricsCollection();
    sourceManager.stopSpeedMonitoring();
    console.log('[Download Queue] Stopped');
  }

  /**
   * Process queue - attempt to start downloads
   */
  isWithinSchedule() {
    if (!this.schedule.enabled) {
      return true;
    }

    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDay();

    if (!this.schedule.daysOfWeek.includes(currentDay)) {
      return false;
    }

    if (this.schedule.startHour <= this.schedule.endHour) {
      return currentHour >= this.schedule.startHour && currentHour < this.schedule.endHour;
    } else {
      return currentHour >= this.schedule.startHour || currentHour < this.schedule.endHour;
    }
  }

  setSchedule(scheduleConfig) {
    this.schedule = {
      ...this.schedule,
      ...scheduleConfig,
    };
    console.log(`[Download Queue] Schedule updated:`, this.schedule);
    return this.schedule;
  }

  getSchedule() {
    return {
      ...this.schedule,
      isActive: this.isWithinSchedule(),
      currentTime: new Date().toISOString(),
    };
  }

  async processQueue() {
    if (!this.initialized) {
      return;
    }
    
    if (this.paused || this.processing) {
      return;
    }

    if (!this.isWithinSchedule()) {
      return;
    }

    if (this.currentDownloads.size >= this.maxConcurrent) {
      return;
    }

    if (this.queue.length === 0) {
      return;
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

  async processItem(item) {
    await getDependencies();
    
    if (this.currentDownloads.has(item.id)) {
      return;
    }

    const freshDownloadRecord = dbOps.getDownloadById(item.id);
    if (!freshDownloadRecord) {
      console.log(`[Download Queue] Download ${item.id} not found in database, removing from queue`);
      const index = this.queue.findIndex(q => q.id === item.id);
      if (index > -1) {
        this.queue.splice(index, 1);
      }
      return;
    }

    const finalStates = [DOWNLOAD_STATES.ADDED, DOWNLOAD_STATES.COMPLETED, DOWNLOAD_STATES.CANCELLED];
    if (finalStates.includes(freshDownloadRecord.status)) {
      console.log(`[Download Queue] Download ${item.id} already ${freshDownloadRecord.status}, removing from queue`);
      const index = this.queue.findIndex(q => q.id === item.id);
      if (index > -1) {
        this.queue.splice(index, 1);
      }
      return;
    }

    this.currentDownloads.add(item.id);
    
    const attemptNumber = (freshDownloadRecord.retryCount || 0) + 1;
    const attemptStartTime = Date.now();
    let attemptRecord = null;
    
    const excludeUsernames = sourceManager.getExcludedUsernames(item.id);
    
    try {
      attemptRecord = dbOps.insertDownloadAttempt({
        downloadId: item.id,
        attemptNumber,
        username: null,
        startedAt: new Date().toISOString(),
        status: 'started',
      });
    } catch (err) {
      console.warn('[Download Queue] Could not record attempt:', err.message);
    }

    const downloadRecord = freshDownloadRecord;

    try {

      downloadStateMachine.transition(downloadRecord, DOWNLOAD_STATES.SEARCHING, {
        attemptNumber,
        excludedSources: excludeUsernames.length,
      });

      let result;
      switch (downloadRecord.type) {
        case 'album':
          result = await downloadManager.downloadAlbum(
            downloadRecord.artistId,
            downloadRecord.albumId,
            downloadRecord.id,
            { excludeUsernames }
          );
          break;
        
        case 'track':
          result = await downloadManager.downloadTrack(
            downloadRecord.artistId,
            downloadRecord.trackId,
            { excludeUsernames }
          );
          break;
        
        case 'weekly-flow':
          result = await downloadManager.downloadWeeklyFlowTrack(
            downloadRecord.artistId,
            downloadRecord.trackName,
            downloadRecord.artistMbid,
            { excludeUsernames }
          );
          break;
        
        default:
          throw new Error(`Unknown download type: ${downloadRecord.type}`);
      }

      if (result === null) {
        downloadStateMachine.transition(downloadRecord, DOWNLOAD_STATES.ADDED, {
          reason: 'Already exists',
        });
        
        if (downloadRecord.type === 'album' && downloadRecord.albumId) {
          const activeStates = [
            DOWNLOAD_STATES.REQUESTED,
            DOWNLOAD_STATES.QUEUED,
            DOWNLOAD_STATES.SEARCHING,
            DOWNLOAD_STATES.DOWNLOADING,
          ];
          
          const allAlbumDownloads = dbOps.getDownloads().filter(
            d => d.albumId === downloadRecord.albumId && 
                 d.id !== downloadRecord.id &&
                 activeStates.includes(d.status)
          );
          
          for (const relatedDownload of allAlbumDownloads) {
            downloadStateMachine.transition(relatedDownload, DOWNLOAD_STATES.ADDED, {
              reason: 'Album already complete',
            });
          }
          
          this.queue = this.queue.filter(q => {
            if (q.downloadRecord.albumId === downloadRecord.albumId && q.downloadRecord.type === 'album') {
              return false;
            }
            return true;
          });
        }
        
        console.log(`[Download Queue] Skipped ${downloadRecord.type} - ${downloadRecord.artistName || 'Unknown'} - ${downloadRecord.trackName || downloadRecord.albumName || 'Unknown'} (already exists)`);
        
        const index = this.queue.findIndex(q => q.id === item.id);
        if (index > -1) {
          this.queue.splice(index, 1);
        }
        
        if (attemptRecord) {
          dbOps.updateDownloadAttempt(attemptRecord.id, {
            endedAt: new Date().toISOString(),
            durationMs: Date.now() - attemptStartTime,
            status: 'skipped',
          });
        }
        
        return;
      }

      downloadStateMachine.transition(downloadRecord, DOWNLOAD_STATES.DOWNLOADING);
      
      console.log(`[Download Queue] Started download: ${downloadRecord.type} - ${downloadRecord.artistName || 'Unknown'} - ${downloadRecord.trackName || downloadRecord.albumName || 'Unknown'}`);

      const index = this.queue.findIndex(q => q.id === item.id);
      if (index > -1) {
        this.queue.splice(index, 1);
      }

    } catch (error) {
      console.error(`[Download Queue] Failed to process ${item.id}:`, error.message);
      
      const errorType = downloadStateMachine.classifyError(error);
      
      const lastUsername = downloadRecord.username;
      if (lastUsername) {
        sourceManager.recordSourceFailure(lastUsername, error.message);
      }
      
      if (attemptRecord) {
        dbOps.updateDownloadAttempt(attemptRecord.id, {
          endedAt: new Date().toISOString(),
          durationMs: Date.now() - attemptStartTime,
          status: 'failed',
          errorType,
          errorMessage: error.message,
          username: lastUsername,
        });
      }
      
      const altSourceInfo = await sourceManager.findAlternativeSource(item.id, lastUsername);
      
      const result = downloadStateMachine.handleDownloadFailure(downloadRecord, error, errorType);
      
      if (result.download.status === DOWNLOAD_STATES.DEAD_LETTER) {
        const index = this.queue.findIndex(q => q.id === item.id);
        if (index > -1) {
          this.queue.splice(index, 1);
        }
        console.log(`[Download Queue] Moved ${item.id} to dead letter queue after ${downloadRecord.retryCount} retries`);
      } else if (result.download.status === DOWNLOAD_STATES.QUEUED) {
        item.priority = Math.max(1, item.priority - 2);
        item.downloadRecord = result.download;
        this.queue.sort((a, b) => b.priority - a.priority);
        console.log(`[Download Queue] Requeued ${item.id} with priority ${item.priority} (excluding ${altSourceInfo.excludeUsernames.length} sources)`);
      } else {
        const index = this.queue.findIndex(q => q.id === item.id);
        if (index > -1) {
          this.queue.splice(index, 1);
        }
      }
    } finally {
      this.currentDownloads.delete(item.id);
    }
  }

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

  getDeadLetterQueue(filters = {}) {
    return dbOps.getDeadLetterQueue(filters);
  }

  async retryFromDeadLetter(dlqItemId) {
    const result = downloadStateMachine.retryFromDeadLetter(dlqItemId);
    
    if (result.success && result.download) {
      await this.enqueue(result.download);
    }
    
    return result;
  }

  async retryAllFromDeadLetter(filters = {}) {
    const dlqItems = dbOps.getDeadLetterQueue({ ...filters, canRetry: true });
    const results = { success: 0, failed: 0 };
    
    for (const item of dlqItems) {
      const result = await this.retryFromDeadLetter(item.id);
      if (result.success) {
        results.success++;
      } else {
        results.failed++;
      }
    }
    
    return results;
  }

  clearDeadLetterQueue() {
    return dbOps.clearDeadLetterQueue();
  }

  getBlockedSources() {
    return dbOps.getBlockedSources();
  }

  unblockSource(username) {
    return dbOps.unblockSource(username);
  }

  clearBlockedSources() {
    return dbOps.clearBlockedSources();
  }

  getHealthMetrics() {
    const stateMachineMetrics = downloadStateMachine.getHealthMetrics();
    const sourceStats = sourceManager.getSourceStats();
    
    return {
      ...stateMachineMetrics,
      sources: sourceStats,
    };
  }

  getSourceStats() {
    return sourceManager.getSourceStats();
  }

  updateTransferProgress(downloadId, bytesTransferred, totalBytes) {
    return sourceManager.updateTransferProgress(downloadId, bytesTransferred, totalBytes);
  }

  trackTransferStart(downloadId, username, expectedBytes) {
    return sourceManager.trackTransferStart(downloadId, username, expectedBytes);
  }

  trackTransferComplete(downloadId, success) {
    return sourceManager.trackTransferComplete(downloadId, success);
  }

  exportQueueState() {
    const queueItems = this.queue.map(item => ({
      id: item.id,
      type: item.type,
      priority: item.priority,
      createdAt: item.createdAt,
      retryCount: item.retryCount,
      downloadRecord: item.downloadRecord,
    }));

    const pendingDownloads = dbOps.getDownloads().filter(d => {
      const activeStates = [
        DOWNLOAD_STATES.REQUESTED,
        DOWNLOAD_STATES.QUEUED,
        DOWNLOAD_STATES.SEARCHING,
        DOWNLOAD_STATES.DOWNLOADING,
        DOWNLOAD_STATES.PROCESSING,
        DOWNLOAD_STATES.MOVING,
        DOWNLOAD_STATES.FAILED,
        DOWNLOAD_STATES.STALLED,
      ];
      return activeStates.includes(d.status);
    });

    return {
      exportedAt: new Date().toISOString(),
      version: 1,
      queue: {
        items: queueItems,
        count: queueItems.length,
        paused: this.paused,
        processing: this.currentDownloads.size,
      },
      database: {
        pendingDownloads,
        count: pendingDownloads.length,
      },
      deadLetterQueue: dbOps.getDeadLetterQueue(),
      blockedSources: dbOps.getBlockedSources(),
    };
  }

  async importQueueState(state) {
    if (!state || !state.version || state.version !== 1) {
      throw new Error('Invalid queue state format');
    }

    const results = { imported: 0, skipped: 0, errors: [] };

    for (const item of state.database?.pendingDownloads || []) {
      try {
        const existing = dbOps.getDownloadById(item.id);
        if (!existing) {
          dbOps.insertDownload(item);
          results.imported++;
        } else {
          results.skipped++;
        }
      } catch (error) {
        results.errors.push({ id: item.id, error: error.message });
      }
    }

    await this.loadQueueFromDb();

    return results;
  }

  async verifyQueueIntegrity() {
    await getDependencies();
    
    const issues = [];
    const allDownloads = dbOps.getDownloads();

    for (const download of allDownloads) {
      if (download.status === DOWNLOAD_STATES.DOWNLOADING || download.status === DOWNLOAD_STATES.SEARCHING) {
        const inQueue = this.queue.find(q => q.id === download.id);
        const isProcessing = this.currentDownloads.has(download.id);
        
        if (!inQueue && !isProcessing) {
          issues.push({
            type: 'orphaned_active_download',
            downloadId: download.id,
            status: download.status,
            message: 'Download marked as active but not in queue or processing',
          });
          
          const result = downloadStateMachine.transition(download, DOWNLOAD_STATES.QUEUED, {
            reason: 'Recovered from orphaned state during integrity check',
          });
          
          if (result.success) {
            await this.enqueue(result.download);
          }
        }
      }

      if (download.type === 'album' && download.albumId && 
          [DOWNLOAD_STATES.DOWNLOADING, DOWNLOAD_STATES.SEARCHING, DOWNLOAD_STATES.QUEUED].includes(download.status)) {
        const album = libraryManager.getAlbumById(download.albumId);
        if (album && album.path) {
          try {
            if (fs.existsSync(album.path)) {
              const files = fs.readdirSync(album.path);
              const audioExtensions = ['.flac', '.mp3', '.m4a', '.aac', '.ogg', '.wav', '.opus'];
              const audioFiles = files.filter(f => audioExtensions.includes(path.extname(f).toLowerCase()));
              
              if (audioFiles.length > 0) {
                const tracks = libraryManager.getTracks(download.albumId);
                const expectedCount = tracks.length > 0 ? tracks.length : 12;
                
                if (audioFiles.length >= Math.ceil(expectedCount * 0.8)) {
                  issues.push({
                    type: 'download_already_complete',
                    downloadId: download.id,
                    albumId: download.albumId,
                    message: 'Album appears complete but download still active',
                  });
                  
                  downloadStateMachine.transition(download, DOWNLOAD_STATES.ADDED, {
                    reason: 'Album found complete during integrity check',
                  });
                  
                  const idx = this.queue.findIndex(q => q.id === download.id);
                  if (idx > -1) {
                    this.queue.splice(idx, 1);
                  }
                }
              }
            }
          } catch (err) {
          }
        }
      }
    }

    for (const queueItem of this.queue) {
      const dbRecord = dbOps.getDownloadById(queueItem.id);
      if (!dbRecord) {
        issues.push({
          type: 'queue_item_missing_db_record',
          downloadId: queueItem.id,
          message: 'Queue item has no corresponding database record',
        });
        
        dbOps.insertDownload(queueItem.downloadRecord);
      }
    }

    return {
      healthy: issues.length === 0,
      issuesFound: issues.length,
      issuesFixed: issues.length,
      issues,
    };
  }
}

// Export singleton instance
export const downloadQueue = new DownloadQueue();
