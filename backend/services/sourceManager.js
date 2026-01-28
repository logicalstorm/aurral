import { dbOps } from '../config/db-helpers.js';
import { 
  MIN_TRANSFER_SPEED_BPS, 
  SLOW_TRANSFER_TIMEOUT_MS,
  ERROR_TYPES 
} from '../config/constants.js';

class SourceManager {
  constructor() {
    this.activeTransfers = new Map();
    this.sourceFailureThreshold = 3;
    this.temporaryBlockDurationMs = 2 * 60 * 60 * 1000;
    this.speedCheckIntervalMs = 30000;
    this.speedCheckInterval = null;
  }

  startSpeedMonitoring() {
    if (this.speedCheckInterval) {
      clearInterval(this.speedCheckInterval);
    }

    this.speedCheckInterval = setInterval(() => {
      this.checkSlowTransfers();
    }, this.speedCheckIntervalMs);

    console.log('[SourceManager] Started speed monitoring');
  }

  stopSpeedMonitoring() {
    if (this.speedCheckInterval) {
      clearInterval(this.speedCheckInterval);
      this.speedCheckInterval = null;
    }
  }

  trackTransferStart(downloadId, username, expectedBytes = 0) {
    this.activeTransfers.set(downloadId, {
      username,
      startedAt: Date.now(),
      lastUpdate: Date.now(),
      bytesTransferred: 0,
      expectedBytes,
      speedSamples: [],
      warned: false,
    });
  }

  updateTransferProgress(downloadId, bytesTransferred, totalBytes = null) {
    const transfer = this.activeTransfers.get(downloadId);
    if (!transfer) return null;

    const now = Date.now();
    const elapsed = now - transfer.lastUpdate;
    const bytesDelta = bytesTransferred - transfer.bytesTransferred;
    
    if (elapsed > 0 && bytesDelta > 0) {
      const currentSpeed = (bytesDelta / elapsed) * 1000;
      transfer.speedSamples.push(currentSpeed);
      
      if (transfer.speedSamples.length > 10) {
        transfer.speedSamples.shift();
      }
    }

    transfer.bytesTransferred = bytesTransferred;
    transfer.lastUpdate = now;
    if (totalBytes) {
      transfer.expectedBytes = totalBytes;
    }

    const avgSpeed = this.calculateAverageSpeed(transfer.speedSamples);
    const totalElapsed = now - transfer.startedAt;
    
    return {
      downloadId,
      username: transfer.username,
      bytesTransferred,
      expectedBytes: transfer.expectedBytes,
      currentSpeed: transfer.speedSamples[transfer.speedSamples.length - 1] || 0,
      averageSpeed: avgSpeed,
      elapsedMs: totalElapsed,
      eta: avgSpeed > 0 && transfer.expectedBytes > bytesTransferred 
        ? ((transfer.expectedBytes - bytesTransferred) / avgSpeed) * 1000 
        : null,
    };
  }

  calculateAverageSpeed(samples) {
    if (samples.length === 0) return 0;
    return samples.reduce((a, b) => a + b, 0) / samples.length;
  }

  trackTransferComplete(downloadId, success = true) {
    const transfer = this.activeTransfers.get(downloadId);
    if (!transfer) return;

    const duration = Date.now() - transfer.startedAt;
    const avgSpeed = this.calculateAverageSpeed(transfer.speedSamples);

    try {
      dbOps.recordMetric('transfer_complete', success ? 1 : 0, {
        username: transfer.username,
        duration,
        bytesTransferred: transfer.bytesTransferred,
        averageSpeed: avgSpeed,
        success,
      });

      if (success && transfer.username) {
        const existing = dbOps.getBlockedSource(transfer.username);
        if (existing && !existing.permanent && existing.failureCount < this.sourceFailureThreshold) {
          dbOps.unblockSource(transfer.username);
        }
      }
    } catch (err) {
      console.warn('[SourceManager] Could not record transfer completion:', err.message);
    }

    this.activeTransfers.delete(downloadId);
  }

  async checkSlowTransfers() {
    const now = Date.now();
    const slowTransfers = [];

    for (const [downloadId, transfer] of this.activeTransfers) {
      const elapsed = now - transfer.startedAt;
      const avgSpeed = this.calculateAverageSpeed(transfer.speedSamples);

      if (elapsed > SLOW_TRANSFER_TIMEOUT_MS && avgSpeed < MIN_TRANSFER_SPEED_BPS) {
        slowTransfers.push({
          downloadId,
          username: transfer.username,
          elapsed,
          averageSpeed: avgSpeed,
          bytesTransferred: transfer.bytesTransferred,
        });

        if (!transfer.warned) {
          transfer.warned = true;
          console.warn(`[SourceManager] Slow transfer detected: ${downloadId} from ${transfer.username} - ${Math.round(avgSpeed)} B/s`);
        }
      }
    }

    return slowTransfers;
  }

  async abortSlowTransfer(downloadId, reason = 'Slow transfer') {
    const transfer = this.activeTransfers.get(downloadId);
    if (!transfer) return false;

    console.log(`[SourceManager] Aborting slow transfer ${downloadId} from ${transfer.username}`);

    if (transfer.username) {
      this.recordSourceFailure(transfer.username, reason);
    }

    this.trackTransferComplete(downloadId, false);

    return true;
  }

  recordSourceFailure(username, reason = 'Unknown failure') {
    if (!username) return;

    try {
      const existing = dbOps.getBlockedSource(username);
      const unblockAfter = new Date(Date.now() + this.temporaryBlockDurationMs).toISOString();
      
      if (existing) {
        const newFailureCount = existing.failureCount + 1;
        
        if (newFailureCount >= this.sourceFailureThreshold) {
          dbOps.blockSource(username, reason, { 
            permanent: false,
            unblockAfter: new Date(Date.now() + this.temporaryBlockDurationMs * 2).toISOString(),
          });
          console.log(`[SourceManager] Blocked source ${username} after ${newFailureCount} failures`);
        } else {
          dbOps.blockSource(username, reason, { unblockAfter });
        }
      } else {
        dbOps.blockSource(username, reason, { unblockAfter });
      }
    } catch (err) {
      console.warn('[SourceManager] Could not record source failure:', err.message);
    }
  }

  isSourceBlocked(username) {
    if (!username) return false;
    return dbOps.isSourceBlocked(username);
  }

  getExcludedUsernames(downloadId) {
    const excludeList = [];

    try {
      const failedUsernames = dbOps.getFailedUsernamesForDownload(downloadId);
      excludeList.push(...failedUsernames);
    } catch (err) {
    }

    try {
      const blockedSources = dbOps.getBlockedSources();
      for (const source of blockedSources) {
        if (!excludeList.includes(source.username)) {
          const stillBlocked = dbOps.isSourceBlocked(source.username);
          if (stillBlocked) {
            excludeList.push(source.username);
          }
        }
      }
    } catch (err) {
    }

    return excludeList;
  }

  async findAlternativeSource(downloadId, originalUsername) {
    if (originalUsername) {
      this.recordSourceFailure(originalUsername, 'Download failed, seeking alternative');
    }

    const excludedUsernames = this.getExcludedUsernames(downloadId);
    
    if (originalUsername && !excludedUsernames.includes(originalUsername)) {
      excludedUsernames.push(originalUsername);
    }

    return {
      excludeUsernames: excludedUsernames,
      attemptNumber: excludedUsernames.length + 1,
    };
  }

  getSourceStats() {
    const blockedSources = dbOps.getBlockedSources();
    const activeTransferCount = this.activeTransfers.size;
    
    let totalSpeed = 0;
    let transferCount = 0;
    
    for (const transfer of this.activeTransfers.values()) {
      const avgSpeed = this.calculateAverageSpeed(transfer.speedSamples);
      if (avgSpeed > 0) {
        totalSpeed += avgSpeed;
        transferCount++;
      }
    }

    return {
      activeTransfers: activeTransferCount,
      blockedSources: blockedSources.length,
      permanentlyBlocked: blockedSources.filter(s => s.permanent).length,
      averageTransferSpeed: transferCount > 0 ? totalSpeed / transferCount : 0,
      slowTransferThreshold: MIN_TRANSFER_SPEED_BPS,
    };
  }

  async cleanupExpiredBlocks() {
    try {
      const blockedSources = dbOps.getBlockedSources();
      const now = new Date();
      let cleaned = 0;

      for (const source of blockedSources) {
        if (!source.permanent && source.unblockAfter) {
          if (new Date(source.unblockAfter) <= now) {
            dbOps.unblockSource(source.username);
            cleaned++;
          }
        }
      }

      if (cleaned > 0) {
        console.log(`[SourceManager] Cleaned up ${cleaned} expired blocks`);
      }

      return cleaned;
    } catch (err) {
      console.error('[SourceManager] Cleanup error:', err.message);
      return 0;
    }
  }
}

export const sourceManager = new SourceManager();
