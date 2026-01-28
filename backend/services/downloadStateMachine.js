import { dbOps } from '../config/db-helpers.js';
import { 
  DOWNLOAD_STATES, 
  DOWNLOAD_STATE_TRANSITIONS, 
  STALLED_TIMEOUT_MS,
  MAX_RETRY_COUNT,
  MAX_REQUEUE_COUNT,
  ERROR_TYPES
} from '../config/constants.js';
import { v4 as uuidv4 } from 'uuid';

let websocketService = null;

async function getWebSocketService() {
  if (!websocketService) {
    try {
      const mod = await import('./websocketService.js');
      websocketService = mod.websocketService;
    } catch (err) {
    }
  }
  return websocketService;
}

class DownloadStateMachine {
  constructor() {
    this.stalledCheckInterval = null;
    this.metricsInterval = null;
  }

  isValidTransition(fromState, toState) {
    const validTransitions = DOWNLOAD_STATE_TRANSITIONS[fromState];
    if (!validTransitions) return false;
    return validTransitions.includes(toState);
  }

  transition(downloadRecord, toState, metadata = {}) {
    const fromState = downloadRecord.status;
    
    if (fromState === toState) {
      return { success: true, download: downloadRecord };
    }

    if (!this.isValidTransition(fromState, toState)) {
      console.warn(`[StateMachine] Invalid transition: ${fromState} -> ${toState} for download ${downloadRecord.id}`);
      return { 
        success: false, 
        error: `Invalid state transition from ${fromState} to ${toState}`,
        download: downloadRecord 
      };
    }

    const now = new Date().toISOString();
    const events = downloadRecord.events || [];
    
    events.push({
      timestamp: now,
      event: 'state_transition',
      fromState,
      toState,
      ...metadata,
    });

    const updates = {
      status: toState,
      events,
    };

    switch (toState) {
      case DOWNLOAD_STATES.QUEUED:
        updates.queuedAt = now;
        break;
      case DOWNLOAD_STATES.SEARCHING:
        updates.searchingAt = now;
        break;
      case DOWNLOAD_STATES.DOWNLOADING:
        updates.startedAt = updates.startedAt || now;
        updates.lastProgressUpdate = now;
        break;
      case DOWNLOAD_STATES.PROCESSING:
        updates.processingAt = now;
        break;
      case DOWNLOAD_STATES.MOVING:
        updates.movingAt = now;
        break;
      case DOWNLOAD_STATES.COMPLETED:
        updates.completedAt = now;
        break;
      case DOWNLOAD_STATES.ADDED:
        updates.addedAt = now;
        break;
      case DOWNLOAD_STATES.FAILED:
        updates.failedAt = now;
        updates.lastFailureAt = now;
        if (metadata.error) {
          updates.lastError = metadata.error;
        }
        if (metadata.errorType) {
          updates.errorType = metadata.errorType;
        }
        break;
      case DOWNLOAD_STATES.STALLED:
        updates.stalledAt = now;
        break;
      case DOWNLOAD_STATES.DEAD_LETTER:
        updates.deadLetteredAt = now;
        break;
      case DOWNLOAD_STATES.CANCELLED:
        updates.cancelledAt = now;
        break;
    }

    try {
      dbOps.updateDownload(downloadRecord.id, updates);
      const updatedDownload = dbOps.getDownloadById(downloadRecord.id);
      
      console.log(`[StateMachine] ${downloadRecord.id}: ${fromState} -> ${toState}`);
      
      getWebSocketService().then(ws => {
        if (ws) {
          ws.emitDownloadStateChange(downloadRecord.id, fromState, toState, {
            artistName: downloadRecord.artistName,
            albumName: downloadRecord.albumName,
            trackName: downloadRecord.trackName,
            type: downloadRecord.type,
            ...metadata,
          });
          
          if (toState === DOWNLOAD_STATES.COMPLETED || toState === DOWNLOAD_STATES.ADDED) {
            ws.emitDownloadComplete(downloadRecord.id, {
              artistName: downloadRecord.artistName,
              albumName: downloadRecord.albumName,
              type: downloadRecord.type,
            });
          } else if (toState === DOWNLOAD_STATES.FAILED || toState === DOWNLOAD_STATES.DEAD_LETTER) {
            ws.emitDownloadFailed(downloadRecord.id, metadata.error || downloadRecord.lastError);
          }
        }
      });
      
      if (toState === DOWNLOAD_STATES.DEAD_LETTER) {
        this.moveToDeadLetterQueue(updatedDownload, metadata);
      }
      
      return { success: true, download: updatedDownload };
    } catch (error) {
      console.error(`[StateMachine] Failed to transition ${downloadRecord.id}:`, error.message);
      return { success: false, error: error.message, download: downloadRecord };
    }
  }

  moveToDeadLetterQueue(download, metadata = {}) {
    try {
      const dlqItem = {
        id: uuidv4(),
        originalDownloadId: download.id,
        type: download.type,
        artistId: download.artistId,
        albumId: download.albumId,
        trackId: download.trackId,
        artistName: download.artistName,
        albumName: download.albumName,
        trackName: download.trackName,
        errorType: download.errorType || metadata.errorType || ERROR_TYPES.UNKNOWN,
        lastError: download.lastError || metadata.error,
        retryCount: download.retryCount || 0,
        requeueCount: download.requeueCount || 0,
        failedAt: download.failedAt || new Date().toISOString(),
        movedToDlqAt: new Date().toISOString(),
        events: download.events || [],
        canRetry: metadata.canRetry !== false,
        retryAfter: metadata.retryAfter,
      };

      dbOps.insertDeadLetterItem(dlqItem);
      
      dbOps.recordMetric('dead_letter', 1, {
        type: download.type,
        errorType: dlqItem.errorType,
        artistName: download.artistName,
        albumName: download.albumName,
      });

      console.log(`[StateMachine] Moved ${download.id} to dead letter queue: ${dlqItem.lastError || 'Unknown error'}`);
      
      return dlqItem;
    } catch (error) {
      console.error(`[StateMachine] Failed to move ${download.id} to DLQ:`, error.message);
      return null;
    }
  }

  retryFromDeadLetter(dlqItemId) {
    try {
      const dlqItems = dbOps.getDeadLetterQueue();
      const dlqItem = dlqItems.find(item => item.id === dlqItemId);
      
      if (!dlqItem) {
        return { success: false, error: 'Dead letter item not found' };
      }

      if (!dlqItem.canRetry) {
        return { success: false, error: 'This item cannot be retried' };
      }

      const originalDownload = dbOps.getDownloadById(dlqItem.originalDownloadId);
      if (!originalDownload) {
        return { success: false, error: 'Original download record not found' };
      }

      const result = this.transition(originalDownload, DOWNLOAD_STATES.QUEUED, {
        retriedFromDlq: true,
        dlqItemId: dlqItemId,
      });

      if (result.success) {
        dbOps.updateDownload(originalDownload.id, {
          retryCount: 0,
          requeueCount: (originalDownload.requeueCount || 0) + 1,
        });
        
        dbOps.deleteDeadLetterItem(dlqItemId);
        
        console.log(`[StateMachine] Retried ${dlqItem.originalDownloadId} from dead letter queue`);
      }

      return result;
    } catch (error) {
      console.error(`[StateMachine] Failed to retry from DLQ:`, error.message);
      return { success: false, error: error.message };
    }
  }

  shouldMoveToDeadLetter(download) {
    if (download.retryCount >= MAX_RETRY_COUNT) {
      return { shouldMove: true, reason: `Exceeded max retries (${MAX_RETRY_COUNT})` };
    }

    if (download.requeueCount >= MAX_REQUEUE_COUNT) {
      return { shouldMove: true, reason: `Exceeded max requeues (${MAX_REQUEUE_COUNT})` };
    }

    const permanentErrors = [ERROR_TYPES.PERMANENT, ERROR_TYPES.NOT_FOUND];
    if (permanentErrors.includes(download.errorType)) {
      return { shouldMove: true, reason: `Permanent error: ${download.errorType}` };
    }

    return { shouldMove: false };
  }

  handleDownloadFailure(download, error, errorType = null) {
    const classifiedErrorType = errorType || this.classifyError(error);
    const retryCount = (download.retryCount || 0) + 1;
    
    dbOps.updateDownload(download.id, {
      retryCount,
      errorType: classifiedErrorType,
      lastError: error?.message || String(error),
      lastFailureAt: new Date().toISOString(),
    });

    const updatedDownload = dbOps.getDownloadById(download.id);
    const dlqCheck = this.shouldMoveToDeadLetter(updatedDownload);

    if (dlqCheck.shouldMove) {
      return this.transition(updatedDownload, DOWNLOAD_STATES.DEAD_LETTER, {
        error: error?.message || String(error),
        errorType: classifiedErrorType,
        reason: dlqCheck.reason,
      });
    }

    return this.transition(updatedDownload, DOWNLOAD_STATES.FAILED, {
      error: error?.message || String(error),
      errorType: classifiedErrorType,
      retryCount,
    });
  }

  classifyError(error) {
    if (!error) return ERROR_TYPES.UNKNOWN;

    const message = error.message?.toLowerCase() || '';
    const status = error.response?.status;

    if (status === 429 || message.includes('rate limit') || message.includes('too many requests')) {
      return ERROR_TYPES.RATE_LIMIT;
    }

    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND' ||
        message.includes('connect') || message.includes('timeout') || message.includes('network')) {
      return ERROR_TYPES.NETWORK;
    }

    if (status === 404 || message.includes('not found') || message.includes('404')) {
      return ERROR_TYPES.NOT_FOUND;
    }

    if (status >= 500 && status < 504) {
      return ERROR_TYPES.SERVER_ERROR;
    }

    if (status >= 400 && status < 500) {
      return ERROR_TYPES.PERMANENT;
    }

    if (message.includes('no results') || message.includes('no sources') || message.includes('no matches')) {
      return ERROR_TYPES.NO_SOURCES;
    }

    if (message.includes('slow') || message.includes('speed')) {
      return ERROR_TYPES.SLOW_TRANSFER;
    }

    return ERROR_TYPES.UNKNOWN;
  }

  startStalledDetection(intervalMs = 60000) {
    if (this.stalledCheckInterval) {
      clearInterval(this.stalledCheckInterval);
    }

    this.stalledCheckInterval = setInterval(() => {
      this.checkForStalledDownloads();
    }, intervalMs);

    console.log(`[StateMachine] Started stalled detection (checking every ${intervalMs / 1000}s)`);
  }

  stopStalledDetection() {
    if (this.stalledCheckInterval) {
      clearInterval(this.stalledCheckInterval);
      this.stalledCheckInterval = null;
    }
  }

  async checkForStalledDownloads() {
    try {
      const stalledDownloads = dbOps.getStalledDownloads(STALLED_TIMEOUT_MS);
      
      for (const download of stalledDownloads) {
        console.log(`[StateMachine] Detected stalled download: ${download.id} (${download.artistName} - ${download.albumName || download.trackName})`);
        
        const result = this.transition(download, DOWNLOAD_STATES.STALLED, {
          reason: 'No progress for over 30 minutes',
          stalledDuration: STALLED_TIMEOUT_MS,
        });

        if (result.success) {
          const dlqCheck = this.shouldMoveToDeadLetter(result.download);
          
          if (dlqCheck.shouldMove) {
            this.transition(result.download, DOWNLOAD_STATES.DEAD_LETTER, {
              reason: dlqCheck.reason,
              errorType: ERROR_TYPES.TIMEOUT,
            });
          } else {
            dbOps.updateDownload(download.id, {
              retryCount: (download.retryCount || 0) + 1,
            });
            
            this.transition(result.download, DOWNLOAD_STATES.QUEUED, {
              reason: 'Auto-retry after stall',
            });
          }
        }
      }

      if (stalledDownloads.length > 0) {
        dbOps.recordMetric('stalled_downloads', stalledDownloads.length);
      }
    } catch (error) {
      console.error('[StateMachine] Error checking for stalled downloads:', error.message);
    }
  }

  startMetricsCollection(intervalMs = 5 * 60 * 1000) {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    this.metricsInterval = setInterval(() => {
      this.collectMetrics();
    }, intervalMs);

    console.log(`[StateMachine] Started metrics collection (every ${intervalMs / 1000}s)`);
  }

  stopMetricsCollection() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
  }

  collectMetrics() {
    try {
      const successRate = dbOps.getDownloadSuccessRate(24);
      dbOps.recordMetric('success_rate_24h', successRate.successRate, successRate);

      const dlqItems = dbOps.getDeadLetterQueue();
      dbOps.recordMetric('dlq_size', dlqItems.length);

      const blockedSources = dbOps.getBlockedSources();
      dbOps.recordMetric('blocked_sources', blockedSources.length);
    } catch (error) {
      console.error('[StateMachine] Error collecting metrics:', error.message);
    }
  }

  getDeadLetterQueueStats() {
    const items = dbOps.getDeadLetterQueue();
    const byType = {};
    const byErrorType = {};
    const retryable = items.filter(i => i.canRetry).length;

    for (const item of items) {
      byType[item.type] = (byType[item.type] || 0) + 1;
      byErrorType[item.errorType || 'unknown'] = (byErrorType[item.errorType || 'unknown'] || 0) + 1;
    }

    return {
      total: items.length,
      retryable,
      byType,
      byErrorType,
    };
  }

  getBlockedSourcesStats() {
    const sources = dbOps.getBlockedSources();
    const permanent = sources.filter(s => s.permanent).length;
    const temporary = sources.length - permanent;

    return {
      total: sources.length,
      permanent,
      temporary,
      sources: sources.slice(0, 10),
    };
  }

  getHealthMetrics() {
    const successRate = dbOps.getDownloadSuccessRate(24);
    const dlqStats = this.getDeadLetterQueueStats();
    const blockedStats = this.getBlockedSourcesStats();
    const stalledDownloads = dbOps.getStalledDownloads(STALLED_TIMEOUT_MS);

    return {
      successRate,
      deadLetterQueue: dlqStats,
      blockedSources: blockedStats,
      stalledDownloads: stalledDownloads.length,
      healthy: successRate.successRate >= 50 && stalledDownloads.length === 0,
    };
  }
}

export const downloadStateMachine = new DownloadStateMachine();
